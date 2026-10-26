import { unzipSync } from 'fflate'
import { emptyItem, normalizeItem, type CustomField, type ItemData, type ItemType } from '../crypto/items'
import { parseCsv } from './csv'

// Lee las exportaciones de otros gestores y las convierte a elementos de PassMe. Todo ocurre en el
// navegador: el archivo nunca se manda al servidor, solo los elementos ya cifrados.
//   PassMe (JSON)       copia completa, con todos los tipos y bóvedas
//   Proton Pass         .zip o data.json sin cifrar con PGP
//   Bitwarden (JSON)    sin protección con contraseña
//   CSV                 Passbolt, Bitwarden, LastPass, 1Password, KeePass(XC), Chrome, Edge, Firefox,
//                       Safari, Dashlane, NordPass, Proton Pass… (las columnas se reconocen por nombre)

export interface ImportedItem {
  data: ItemData
  // Carpeta, grupo o bóveda de origen; vacío si no tenía
  folder: string
}

export interface ImportResult {
  source: string
  items: ImportedItem[]
  // Entradas que no se pudieron convertir (vacías o de un tipo sin datos)
  skipped: number
}

export class ImportError extends Error {
  constructor(readonly code: 'unknown_format' | 'encrypted' | 'pgp' | 'empty' | 'too_big') {
    super(code)
  }
}

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024

export async function importFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError('too_big')
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Los .zip empiezan con "PK"
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return importZip(bytes)
  return importText(new TextDecoder().decode(bytes), file.name)
}

function importZip(bytes: Uint8Array): ImportResult {
  const files = unzipSync(bytes, { filter: (f) => /\.json$/i.test(f.name) && f.originalSize < MAX_IMPORT_BYTES })
  // Proton Pass guarda todo en "Proton Pass/data.json"
  const name = Object.keys(files).find((n) => /(^|\/)data\.json$/i.test(n)) ?? Object.keys(files)[0]
  if (!name) throw new ImportError('unknown_format')
  return importText(new TextDecoder().decode(files[name]), name)
}

export function importText(text: string, fileName = ''): ImportResult {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (!trimmed) throw new ImportError('empty')
  if (trimmed.startsWith('-----BEGIN PGP')) throw new ImportError('pgp')
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let json: unknown
    try {
      json = JSON.parse(trimmed)
    } catch {
      throw new ImportError('unknown_format')
    }
    return importJson(json)
  }
  if (/\.(csv|txt)$/i.test(fileName) || trimmed.includes(',') || trimmed.includes(';')) return importCsv(trimmed)
  throw new ImportError('unknown_format')
}

// --- Utilidades ---

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

// "itemUsername" → "Item username", para los campos sin equivalente que se guardan como personalizados
function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function hostname(url: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function build(type: ItemType, name: string, fields: Record<string, string>, extra: Partial<ItemData> = {}): ItemData {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (v && v.trim()) clean[k] = v
  const data = { ...emptyItem(type), ...extra, fields: clean }
  data.urls = data.urls.map((u) => u.trim()).filter(Boolean)
  data.custom = data.custom.filter((c) => c.value.trim() !== '')
  data.name = (name || '').trim() || data.urls.map(hostname).find(Boolean) || clean.username || clean.ssid || clean.fullName || ''
  return data
}

function isEmpty(d: ItemData): boolean {
  return !d.name && !Object.keys(d.fields).length && !d.note.trim() && !d.urls.length && !d.custom.length
}

// "MM/AA" a partir de mes y año en cualquier forma ("3", "03", "2027", "27")
function expiry(month: string, year: string): string {
  const m = Number(month)
  if (!m || m > 12 || !year) return ''
  return `${String(m).padStart(2, '0')}/${year.slice(-2)}`
}

function finish(source: string, items: ImportedItem[], skipped: number): ImportResult {
  const kept = items.filter((i) => !isEmpty(i.data))
  return { source, items: kept, skipped: skipped + items.length - kept.length }
}

// --- JSON ---

function importJson(json: unknown): ImportResult {
  if (isObj(json) && json.format === 'passme') return importPassme(json)
  if (isObj(json) && isObj(json.vaults) && ('userId' in json || 'version' in json)) {
    if (json.encrypted === true) throw new ImportError('encrypted')
    return importProton(json.vaults)
  }
  if (isObj(json) && Array.isArray(json.items)) {
    if (json.encrypted === true) throw new ImportError('encrypted')
    return importBitwarden(json)
  }
  throw new ImportError('unknown_format')
}

function importPassme(json: Obj): ImportResult {
  const items: ImportedItem[] = []
  for (const v of arr(json.vaults)) {
    if (!isObj(v)) continue
    for (const i of arr(v.items)) if (isObj(i)) items.push({ data: normalizeItem(i), folder: str(v.name) })
  }
  return finish('PassMe', items, 0)
}

// --- Proton Pass ---

const PROTON_TRASHED = 2

function protonExtra(list: unknown): CustomField[] {
  return arr(list).flatMap((f) => {
    if (!isObj(f)) return []
    const data = isObj(f.data) ? f.data : {}
    const value = str(data.content) || str(data.totpUri) || str(data.timestamp)
    return [{ label: str(f.fieldName), value, secret: f.type === 'hidden' || f.type === 'totp' }]
  })
}

// Secciones extra de identidades, claves SSH, wifi y elementos personalizados
function protonSections(content: Obj): CustomField[] {
  const out: CustomField[] = []
  for (const key of ['extraPersonalDetails', 'extraAddressDetails', 'extraContactDetails', 'extraWorkDetails', 'extraFields']) {
    out.push(...protonExtra(content[key]))
  }
  for (const s of arr(content.extraSections ?? content.sections)) {
    if (isObj(s)) out.push(...protonExtra(s.sectionFields))
  }
  return out
}

// Lo que no tiene campo propio en PassMe se conserva como campo personalizado
function leftovers(content: Obj, used: string[]): CustomField[] {
  return Object.entries(content)
    .filter(([k, v]) => !used.includes(k) && typeof v === 'string' && v.trim())
    .map(([k, v]) => ({ label: humanize(k), value: v as string, secret: false }))
}

const IDENTITY_USED = [
  'fullName', 'firstName', 'middleName', 'lastName', 'email', 'phoneNumber', 'birthdate', 'streetAddress', 'floor',
  'city', 'stateOrProvince', 'zipOrPostalCode', 'countryOrRegion', 'county', 'socialSecurityNumber'
]

function importProton(vaults: Obj): ImportResult {
  const items: ImportedItem[] = []
  let skipped = 0
  for (const vault of Object.values(vaults)) {
    if (!isObj(vault)) continue
    const folder = str(vault.name)
    for (const raw of arr(vault.items)) {
      if (!isObj(raw) || raw.state === PROTON_TRASHED) continue
      const data = isObj(raw.data) ? raw.data : {}
      const meta = isObj(data.metadata) ? data.metadata : {}
      const content = isObj(data.content) ? data.content : {}
      const base = {
        note: str(meta.note),
        favorite: raw.pinned === true,
        custom: protonExtra(data.extraFields)
      }
      const name = str(meta.name)
      const item = protonItem(str(data.type), name, content, base, raw)
      if (item) items.push({ data: item, folder })
      else skipped++
    }
  }
  return finish('Proton Pass', items, skipped)
}

function protonItem(type: string, name: string, c: Obj, base: Partial<ItemData>, raw: Obj): ItemData | null {
  switch (type) {
    case 'login': {
      const username = str(c.itemUsername) || str(c.username)
      const email = str(c.itemEmail)
      const custom = [...base.custom!]
      if (email && username && email !== username) custom.unshift({ label: 'Email', value: email, secret: false })
      return build(
        'login',
        name,
        { username: username || email, password: str(c.password), totp: str(c.totpUri) },
        { ...base, custom, urls: arr(c.urls).map(str) }
      )
    }
    case 'alias':
      return build('login', name, { username: str(raw.aliasEmail) }, base)
    case 'note':
      return build('note', name, {}, base)
    case 'creditCard': {
      const [year = '', month = ''] = str(c.expirationDate).split('-')
      return build(
        'card',
        name,
        {
          holder: str(c.cardholderName),
          cardNumber: str(c.number),
          expiry: expiry(month, year),
          cvv: str(c.verificationNumber),
          pin: str(c.pin)
        },
        base
      )
    }
    case 'identity': {
      const fullName = str(c.fullName) || [c.firstName, c.middleName, c.lastName].map(str).filter(Boolean).join(' ')
      const address = [
        [str(c.streetAddress), str(c.floor)].filter(Boolean).join(', '),
        [str(c.zipOrPostalCode), str(c.city)].filter(Boolean).join(' '),
        [str(c.county), str(c.stateOrProvince), str(c.countryOrRegion)].filter(Boolean).join(', ')
      ]
        .filter(Boolean)
        .join('\n')
      return build(
        'identity',
        name,
        {
          fullName,
          birthDate: str(c.birthdate),
          email: str(c.email),
          phone: str(c.phoneNumber),
          address,
          nationalId: str(c.socialSecurityNumber)
        },
        { ...base, custom: [...base.custom!, ...leftovers(c, IDENTITY_USED), ...protonSections(c)] }
      )
    }
    case 'sshKey':
      return build(
        'sshKey',
        name,
        { privateKey: str(c.privateKey), publicKey: str(c.publicKey) },
        { ...base, custom: [...base.custom!, ...protonSections(c)] }
      )
    case 'wifi': {
      const security = ['wpa', 'wpa2', 'wpa3', 'wep', 'open'].find((s) => s === str(c.security).toLowerCase())
      return build(
        'wifi',
        name,
        { ssid: str(c.ssid), password: str(c.password), security: security ?? '' },
        { ...base, custom: [...base.custom!, ...protonSections(c)] }
      )
    }
    case 'custom':
      return build('note', name, {}, { ...base, custom: [...base.custom!, ...protonSections(c)] })
    default:
      return null
  }
}

// --- Bitwarden (y los gestores que exportan en su formato) ---

const BW = { login: 1, note: 2, card: 3, identity: 4, sshKey: 5 }

function bitwardenFields(list: unknown): CustomField[] {
  return arr(list).flatMap((f) =>
    isObj(f) ? [{ label: str(f.name), value: str(f.value), secret: f.type === 1 }] : []
  )
}

function importBitwarden(json: Obj): ImportResult {
  const folders = new Map<string, string>()
  for (const f of [...arr(json.folders), ...arr(json.collections)]) {
    if (isObj(f)) folders.set(str(f.id), str(f.name))
  }
  const items: ImportedItem[] = []
  let skipped = 0
  for (const raw of arr(json.items)) {
    if (!isObj(raw) || raw.deletedDate) continue
    const base: Partial<ItemData> = {
      note: str(raw.notes),
      favorite: raw.favorite === true,
      custom: bitwardenFields(raw.fields)
    }
    const name = str(raw.name)
    const folderId = str(raw.folderId) || str(arr(raw.collectionIds)[0])
    let data: ItemData | null = null
    if (raw.type === BW.login && isObj(raw.login)) {
      const l = raw.login
      data = build(
        'login',
        name,
        { username: str(l.username), password: str(l.password), totp: str(l.totp) },
        { ...base, urls: arr(l.uris).map((u) => (isObj(u) ? str(u.uri) : '')) }
      )
    } else if (raw.type === BW.note) {
      data = build('note', name, {}, base)
    } else if (raw.type === BW.card && isObj(raw.card)) {
      const c = raw.card
      data = build(
        'card',
        name,
        {
          holder: str(c.cardholderName),
          cardNumber: str(c.number),
          expiry: expiry(str(c.expMonth), str(c.expYear)),
          cvv: str(c.code)
        },
        base
      )
    } else if (raw.type === BW.identity && isObj(raw.identity)) {
      const i = raw.identity
      const address = [
        [i.address1, i.address2, i.address3].map(str).filter(Boolean).join(', '),
        [str(i.postalCode), str(i.city)].filter(Boolean).join(' '),
        [str(i.state), str(i.country)].filter(Boolean).join(', ')
      ]
        .filter(Boolean)
        .join('\n')
      const used = ['title', 'firstName', 'middleName', 'lastName', 'address1', 'address2', 'address3', 'city', 'state', 'postalCode', 'country', 'email', 'phone', 'ssn']
      data = build(
        'identity',
        name,
        {
          fullName: [i.title, i.firstName, i.middleName, i.lastName].map(str).filter(Boolean).join(' '),
          email: str(i.email),
          phone: str(i.phone),
          address,
          nationalId: str(i.ssn)
        },
        { ...base, custom: [...base.custom!, ...leftovers(i, used)] }
      )
    } else if (raw.type === BW.sshKey && isObj(raw.sshKey)) {
      const k = raw.sshKey
      data = build('sshKey', name, { privateKey: str(k.privateKey), publicKey: str(k.publicKey), fingerprint: str(k.keyFingerprint) }, base)
    }
    if (data) items.push({ data, folder: folders.get(folderId) ?? '' })
    else skipped++
  }
  return finish('Bitwarden', items, skipped)
}

// --- CSV ---

// Nombres de columna de cada gestor, ya en minúsculas y sin espacios, guiones ni guiones bajos
const COLUMNS = {
  name: ['name', 'title', 'nombre', 'titulo', 'itemname', 'account', 'accountname'],
  url: ['url', 'loginuri', 'uri', 'website', 'web', 'loginurl', 'urls', 'sitio'],
  username: ['username', 'loginusername', 'login', 'user', 'usuario', 'loginname', 'username1'],
  email: ['email', 'mail', 'correo', 'emailaddress'],
  password: ['password', 'loginpassword', 'pass', 'contrasena', 'contraseña', 'pwd'],
  note: ['note', 'notes', 'extra', 'comment', 'comments', 'nota', 'notas', 'description'],
  totp: ['totp', 'logintotp', 'otpauth', 'otp', 'otpsecret', 'onetimepassword', 'twofactorsecret', 'otpurl'],
  folder: ['folder', 'group', 'grouping', 'vault', 'collection', 'collections', 'carpeta', 'grupo', 'boveda'],
  favorite: ['favorite', 'fav', 'favorito'],
  type: ['type', 'kind', 'tipo', 'category'],
  fields: ['fields']
}

// Datos internos de cada gestor que no vale la pena conservar
const IGNORED = new Set([
  'createtime', 'modifytime', 'guid', 'timecreated', 'timelastused', 'timepasswordchanged', 'httprealm',
  'formactionorigin', 'reprompt', 'archived', 'icon', 'lastmodified', 'created', 'modified', 'id', 'expirydate'
])

const SOURCES: [string, string[]][] = [
  ['Bitwarden', ['loginuri', 'loginpassword']],
  ['Proton Pass', ['vault', 'createtime']],
  ['LastPass', ['grouping', 'extra']],
  ['Firefox', ['httprealm']],
  ['Dashlane', ['username2']],
  ['1Password', ['otpauth', 'archived']],
  ['Safari', ['otpauth']],
  ['Passbolt / KeePass', ['group', 'title']],
  ['Chrome / Edge', ['name', 'url', 'username', 'password']]
]

const normHeader = (h: string) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_\-./]+/g, '')

function importCsv(text: string): ImportResult {
  const rows = parseCsv(text)
  const header = rows.shift()?.map(normHeader) ?? []
  const col = (key: keyof typeof COLUMNS) => header.findIndex((h) => COLUMNS[key].includes(h))
  const idx = Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, col(k as keyof typeof COLUMNS)])) as Record<keyof typeof COLUMNS, number>
  // Si no hay columna de usuario, el correo hace de usuario
  if (idx.username < 0) {
    idx.username = idx.email
    idx.email = -1
  }
  if (idx.password < 0 && idx.username < 0 && idx.note < 0) throw new ImportError('unknown_format')

  const source = SOURCES.find(([, cols]) => cols.every((c) => header.includes(c)))?.[0] ?? 'CSV'
  const known = new Set(Object.values(idx).filter((i) => i >= 0))
  const items: ImportedItem[] = []

  for (const row of rows) {
    const get = (i: number) => (i >= 0 ? (row[i] ?? '') : '')
    const custom: CustomField[] = []
    if (get(idx.email)) custom.push({ label: 'Email', value: get(idx.email), secret: false })
    // Bitwarden pone los campos extra como "nombre: valor", uno por línea
    for (const line of get(idx.fields).split(/\r?\n/)) {
      const m = /^([^:]+):\s?(.*)$/.exec(line)
      if (m) custom.push({ label: m[1]!.trim(), value: m[2]!, secret: false })
    }
    header.forEach((h, i) => {
      if (!known.has(i) && !IGNORED.has(h) && row[i]?.trim()) custom.push({ label: humanize(h), value: row[i]!, secret: false })
    })

    // LastPass marca las notas seguras con la url "http://sn"
    const lastPassNote = get(idx.url) === 'http://sn'
    const urls = lastPassNote ? [] : get(idx.url).split(/\r?\n|,\s+/)
    const kind = get(idx.type).toLowerCase().replace(/[\s_-]/g, '')
    const isNote =
      lastPassNote ||
      ['note', 'securenote', 'notes', 'nota'].includes(kind) ||
      (!get(idx.password) && !get(idx.username) && !urls.some(Boolean) && !!get(idx.note))
    const fav = get(idx.favorite).toLowerCase()
    const folder = get(idx.folder).replace(/^(root|raíz|raiz)[/\\]?/i, '').replace(/\\/g, '/')
    const base = { note: get(idx.note), favorite: fav === '1' || fav === 'true' || fav === 'yes', custom }
    items.push({
      folder,
      data: isNote
        ? build('note', get(idx.name), {}, base)
        : build(
            'login',
            get(idx.name),
            { username: get(idx.username), password: get(idx.password), totp: get(idx.totp) },
            { ...base, urls }
          )
    })
  }
  return finish(source, items, 0)
}
