// Lee llaves privadas y públicas pegadas o cargadas de un archivo (PGP, como la de Passbolt; SSH;
// PEM; age) para llenar solos la identidad, la huella, la llave pública y las fechas. Solo se lee la
// parte pública: lo secreto se guarda tal cual, sin descifrarlo ni tocarlo.

export type KeyKind = 'pgp' | 'ssh' | 'pem' | 'age' | 'other'

export interface KeyInfo {
  kind: KeyKind
  // Los bloques privados y públicos que trae el texto, cada uno completo
  privateKey: string
  publicKey: string
  identity: string
  fingerprint: string
  // AAAA-MM-DD
  createdOn: string
  expiresOn: string
  // La llave privada viene protegida con una frase de paso
  encrypted: boolean
}

const BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g

const decode = (b64: string) => Uint8Array.from(atob(b64.replace(/[^A-Za-z0-9+/=]/g, '')), (c) => c.charCodeAt(0))
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const isoDate = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10)

async function digest(algo: 'SHA-1' | 'SHA-256', ...parts: Uint8Array[]): Promise<Uint8Array> {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    all.set(p, at)
    at += p.length
  }
  return new Uint8Array(await crypto.subtle.digest(algo, all))
}

// --- OpenPGP (RFC 9580) ---

interface Packet {
  tag: number
  body: Uint8Array
}

function readPackets(bytes: Uint8Array): Packet[] {
  const packets: Packet[] = []
  let i = 0
  while (i < bytes.length) {
    const head = bytes[i++]!
    if (!(head & 0x80)) throw new Error('pgp')
    let tag: number
    let len: number
    if (head & 0x40) {
      tag = head & 0x3f
      const o = bytes[i++]!
      if (o < 192) len = o
      else if (o < 224) len = ((o - 192) << 8) + bytes[i++]! + 192
      else if (o === 255) {
        len = ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0
        i += 4
      } else throw new Error('pgp') // longitudes parciales: no se usan en llaves
    } else {
      tag = (head >> 2) & 0x0f
      const type = head & 3
      if (type === 0) len = bytes[i++]!
      else if (type === 1) {
        len = (bytes[i]! << 8) | bytes[i + 1]!
        i += 2
      } else if (type === 2) {
        len = ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0
        i += 4
      } else len = bytes.length - i
    }
    if (i + len > bytes.length) throw new Error('pgp')
    packets.push({ tag, body: bytes.subarray(i, i + len) })
    i += len
  }
  return packets
}

// Largo de la parte pública de un paquete de llave (versión 4 o 6); lo que sigue es lo secreto
function publicLength(body: Uint8Array): number {
  const version = body[0]
  if (version === 6 || version === 5) {
    const material = ((body[6]! << 24) | (body[7]! << 16) | (body[8]! << 8) | body[9]!) >>> 0
    return 10 + material
  }
  if (version !== 4) throw new Error('pgp')
  let i = 6
  const mpi = () => {
    const bits = (body[i]! << 8) | body[i + 1]!
    i += 2 + Math.ceil(bits / 8)
  }
  const oid = () => {
    i += 1 + body[i]!
  }
  switch (body[5]) {
    case 1:
    case 2:
    case 3: // RSA
      mpi()
      mpi()
      break
    case 17: // DSA
      mpi()
      mpi()
      mpi()
      mpi()
      break
    case 16: // Elgamal
      mpi()
      mpi()
      mpi()
      break
    case 18: // ECDH
      oid()
      mpi()
      i += 1 + body[i]!
      break
    case 19: // ECDSA
    case 22: // EdDSA (formato anterior)
      oid()
      mpi()
      break
    case 25:
      i += 32 // X25519
      break
    case 26:
      i += 56 // X448
      break
    case 27:
      i += 32 // Ed25519
      break
    case 28:
      i += 57 // Ed448
      break
    default:
      throw new Error('pgp')
  }
  if (i > body.length) throw new Error('pgp')
  return i
}

async function pgpFingerprint(pub: Uint8Array): Promise<string> {
  const version = pub[0]
  const hash =
    version === 4
      ? await digest('SHA-1', new Uint8Array([0x99, pub.length >> 8, pub.length & 0xff]), pub)
      : await digest('SHA-256', new Uint8Array([0x9b, pub.length >>> 24, (pub.length >> 16) & 0xff, (pub.length >> 8) & 0xff, pub.length & 0xff]), pub)
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return hex.replace(/(.{4})(?=.)/g, '$1 ')
}

// Vencimiento: la autofirma más reciente dice cuántos segundos después de creada vence la llave
function signatureExpiry(body: Uint8Array): { created: number; expiresIn: number | null } | null {
  const version = body[0]
  if (version !== 4 && version !== 6) return null
  const sizeBytes = version === 6 ? 4 : 2
  let len = 0
  for (let k = 0; k < sizeBytes; k++) len = (len << 8) | body[4 + k]!
  let i = 4 + sizeBytes
  const end = i + len
  let created = 0
  let expiresIn: number | null = null
  while (i < end) {
    let size = body[i++]!
    if (size >= 192 && size < 255) size = ((size - 192) << 8) + body[i++]! + 192
    else if (size === 255) {
      size = ((body[i]! << 24) | (body[i + 1]! << 16) | (body[i + 2]! << 8) | body[i + 3]!) >>> 0
      i += 4
    }
    const type = body[i]! & 0x7f
    const u32 = () => ((body[i + 1]! << 24) | (body[i + 2]! << 16) | (body[i + 3]! << 8) | body[i + 4]!) >>> 0
    if (type === 2) created = u32()
    if (type === 9) expiresIn = u32() || null
    i += size
  }
  return { created, expiresIn }
}

// Un paquete con encabezado nuevo (el que usa la parte pública que se arma a partir de la privada)
function packet(tag: number, body: Uint8Array): Uint8Array {
  const len = body.length
  const head =
    len < 192
      ? [0xc0 | tag, len]
      : len < 8384
        ? [0xc0 | tag, ((len - 192) >> 8) + 192, (len - 192) & 0xff]
        : [0xc0 | tag, 255, len >>> 24, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]
  const out = new Uint8Array(head.length + len)
  out.set(head)
  out.set(body, head.length)
  return out
}

function crc24(bytes: Uint8Array): number {
  let crc = 0xb704ce
  for (const b of bytes) {
    crc ^= b << 16
    for (let k = 0; k < 8; k++) {
      crc <<= 1
      if (crc & 0x1000000) crc ^= 0x1864cfb
    }
  }
  return crc & 0xffffff
}

export function armor(kind: 'PUBLIC' | 'PRIVATE', bytes: Uint8Array): string {
  const body = encode(bytes).replace(/(.{64})/g, '$1\n').trim()
  const crc = crc24(bytes)
  const sum = encode(new Uint8Array([crc >> 16, (crc >> 8) & 0xff, crc & 0xff]))
  return `-----BEGIN PGP ${kind} KEY BLOCK-----\n\n${body}\n=${sum}\n-----END PGP ${kind} KEY BLOCK-----\n`
}

function dearmor(block: string): Uint8Array {
  const lines = block.split(/\r?\n/).slice(1, -1)
  // Encabezados opcionales ("Version:", "Comment:") hasta la primera línea vacía
  const blank = lines.findIndex((l) => !l.trim())
  const body = (lines.some((l) => /^[A-Za-z-]+: /.test(l)) && blank >= 0 ? lines.slice(blank + 1) : lines).filter(
    (l) => l.trim() && !l.startsWith('=')
  )
  return decode(body.join(''))
}

async function readPgp(bytes: Uint8Array): Promise<Omit<KeyInfo, 'kind' | 'privateKey' | 'publicKey'> & { publicBytes: Uint8Array; secret: boolean }> {
  const packets = readPackets(bytes)
  const primary = packets[0]
  if (!primary || (primary.tag !== 5 && primary.tag !== 6)) throw new Error('pgp')
  const secret = primary.tag === 5
  const pubLen = publicLength(primary.body)
  const pub = primary.body.subarray(0, pubLen)
  const createdAt = ((pub[1]! << 24) | (pub[2]! << 16) | (pub[3]! << 8) | pub[4]!) >>> 0

  let identity = ''
  let latest = -1
  let expiresIn: number | null = null
  let encrypted = false
  let inSubkeys = false
  const publicParts: Uint8Array[] = []
  for (const p of packets) {
    if (p.tag === 5 || p.tag === 7) {
      const len = publicLength(p.body)
      // El byte después de la parte pública dice si lo secreto está cifrado (0 = no)
      if (p.body[len] !== 0) encrypted = true
      publicParts.push(packet(p.tag === 5 ? 6 : 14, p.body.subarray(0, len)))
    } else publicParts.push(packet(p.tag, p.body))
    if (p.tag === 7 || p.tag === 14) inSubkeys = true
    if (p.tag === 13 && !identity) identity = new TextDecoder().decode(p.body)
    if (p.tag === 2 && !inSubkeys) {
      const sig = signatureExpiry(p.body)
      if (sig && sig.created >= latest) {
        latest = sig.created
        expiresIn = sig.expiresIn
      }
    }
  }
  const publicBytes = new Uint8Array(publicParts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of publicParts) {
    publicBytes.set(p, at)
    at += p.length
  }
  return {
    identity,
    fingerprint: await pgpFingerprint(pub),
    createdOn: isoDate(createdAt),
    expiresOn: expiresIn ? isoDate(createdAt + expiresIn) : '',
    encrypted: secret && encrypted,
    publicBytes,
    secret
  }
}

// --- SSH ---

function sshString(bytes: Uint8Array, at: number): [Uint8Array, number] {
  const len = ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  return [bytes.subarray(at + 4, at + 4 + len), at + 4 + len]
}

const sshFingerprint = async (blob: Uint8Array) => `SHA256:${encode(await digest('SHA-256', blob)).replace(/=+$/, '')}`

async function readOpenSsh(block: string) {
  const bytes = dearmor(block)
  const magic = new TextEncoder().encode('openssh-key-v1\0')
  if (!magic.every((b, k) => bytes[k] === b)) throw new Error('ssh')
  let at = magic.length
  const [cipher, a1] = sshString(bytes, at)
  const [, a2] = sshString(bytes, a1)
  const [, a3] = sshString(bytes, a2)
  at = a3 + 4 // número de llaves
  const [blob] = sshString(bytes, at)
  const [type] = sshString(blob, 0)
  return {
    publicKey: `${new TextDecoder().decode(type)} ${encode(blob)}`,
    fingerprint: await sshFingerprint(blob),
    encrypted: new TextDecoder().decode(cipher) !== 'none'
  }
}

const SSH_PUBLIC = /^(ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-nistp\d+|sk-[\w@.-]+)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$/m

// --- Todo junto ---

const empty = (): KeyInfo => ({
  kind: 'other',
  privateKey: '',
  publicKey: '',
  identity: '',
  fingerprint: '',
  createdOn: '',
  expiresOn: '',
  encrypted: false
})

// Devuelve null si el texto no trae ninguna llave reconocible
export async function analyzeKey(input: string | Uint8Array): Promise<KeyInfo | null> {
  const info = empty()
  // Archivo binario de GnuPG (.gpg, .key): se convierte a texto armado
  if (input instanceof Uint8Array) {
    try {
      const pgp = await readPgp(input)
      const { publicBytes, secret, ...rest } = pgp
      return {
        ...info,
        ...rest,
        kind: 'pgp',
        privateKey: secret ? armor('PRIVATE', input) : '',
        publicKey: armor('PUBLIC', secret ? publicBytes : input)
      }
    } catch {
      return null
    }
  }
  const text = input.replace(/\r\n/g, '\n')
  const privates: string[] = []
  const publics: string[] = []
  // La pública que se arma a partir de una privada PGP; solo si el texto no trae la suya
  let derived = ''
  let found = false

  for (const [block, label] of text.matchAll(BLOCK)) {
    try {
      if (label === 'PGP PRIVATE KEY BLOCK' || label === 'PGP PUBLIC KEY BLOCK') {
        const { publicBytes, secret, ...rest } = await readPgp(dearmor(block))
        Object.assign(info, info.fingerprint ? {} : rest, { kind: 'pgp' })
        if (secret) {
          privates.push(block)
          derived ||= armor('PUBLIC', publicBytes).trim()
          if (rest.encrypted) info.encrypted = true
        } else publics.push(block)
        found = true
      } else if (label === 'OPENSSH PRIVATE KEY') {
        const ssh = await readOpenSsh(block)
        Object.assign(info, { kind: 'ssh', fingerprint: info.fingerprint || ssh.fingerprint, encrypted: ssh.encrypted })
        privates.push(block)
        publics.push(ssh.publicKey)
        found = true
      } else if (label!.endsWith('PRIVATE KEY')) {
        info.kind = info.kind === 'other' ? 'pem' : info.kind
        // Las llaves PEM viejas dicen que están cifradas en un encabezado
        info.encrypted ||= label!.startsWith('ENCRYPTED') || /Proc-Type: 4,ENCRYPTED/.test(block)
        privates.push(block)
        found = true
      } else if (label === 'CERTIFICATE' || label === 'PUBLIC KEY' || label === 'RSA PUBLIC KEY') {
        info.kind = info.kind === 'other' ? 'pem' : info.kind
        publics.push(block)
        found = true
      }
    } catch {
      // Un bloque dañado no impide leer los demás
    }
  }

  // age: una línea AGE-SECRET-KEY-1…, con la pública y la fecha en comentarios del archivo
  const age = /^AGE-SECRET-KEY-1[0-9A-Z]+$/m.exec(text)
  if (age) {
    info.kind = 'age'
    privates.push(text.trim())
    const pub = /^#\s*public key:\s*(age1[0-9a-z]+)/m.exec(text)
    if (pub) publics.push(pub[1]!)
    const created = /^#\s*created:\s*(\d{4}-\d{2}-\d{2})/m.exec(text)
    if (created) info.createdOn = created[1]!
    found = true
  }

  // Llave pública SSH en una línea (id_ed25519.pub)
  if (!found) {
    const line = SSH_PUBLIC.exec(text)
    if (line) {
      try {
        const blob = decode(line[2]!)
        Object.assign(info, { kind: 'ssh', fingerprint: await sshFingerprint(blob), identity: line[3]?.trim() ?? '' })
        publics.push(line[0].trim())
        found = true
      } catch {
        // No era base64
      }
    }
  } else if (info.kind === 'ssh') {
    // La pública pegada junto a la privada trae el comentario (usuario@equipo)
    const line = SSH_PUBLIC.exec(text.replace(BLOCK, ''))
    if (line?.[3]) info.identity = line[3].trim()
  }

  if (!found) return null
  info.privateKey = privates.join('\n\n')
  info.publicKey = publics.length ? publics.join('\n') : derived
  return info
}

export const hasPrivateKey = (text: string) =>
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/.test(text) || /^AGE-SECRET-KEY-1/m.test(text)

// Nombre del archivo al descargar la llave
export function keyFileName(name: string, kind: string, which: 'private' | 'public'): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'llave'
  if (kind === 'ssh') return which === 'private' ? `${slug}_id` : `${slug}_id.pub`
  if (kind === 'pgp') return `${slug}-${which}.asc`
  if (kind === 'age') return which === 'private' ? `${slug}.agekey` : `${slug}.age.pub`
  return `${slug}-${which}.pem`
}

// --- Frases de recuperación y códigos de respaldo ---

// "1. palabra 2. palabra" o una por renglón: solo las palabras
export function phraseWords(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((w) => w.replace(/^\d+[.)-]?/, '').trim())
    .filter(Boolean)
}

// Se muestra como cuadrícula numerada si son palabras (no una llave ni un código largo)
export function isWordPhrase(text: string): boolean {
  const words = phraseWords(text)
  return words.length >= 4 && words.every((w) => /^\p{L}+$/u.test(w))
}

// Un código por renglón (o separados por comas); sin numeración
export function parseCodes(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((c) => c.replace(/^\s*\d+[.)]\s+/, '').trim())
    .filter(Boolean)
}

export const normCode = (code: string) => code.replace(/[\s-]/g, '').toLowerCase()

export function codeStatus(codes: string, used: string): { total: number; left: number; used: Set<string> } {
  const all = parseCodes(codes)
  const usedSet = new Set(parseCodes(used).map(normCode))
  return { total: all.length, left: all.filter((c) => !usedSet.has(normCode(c))).length, used: usedSet }
}
