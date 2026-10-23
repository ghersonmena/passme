import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual
} from 'node:crypto'

// Los secretos que llegan del cliente (authKey, llave de recuperación) son derivaciones de 256 bits,
// no contraseñas. Aun así se guardan con scrypt para que una copia de la base de datos no sirva
// para iniciar sesión directamente.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 }

function scryptAsync(secret: Buffer, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  })
}

export async function hashSecret(secret: Buffer): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(secret, salt)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifySecret(secret: Buffer, stored: string): Promise<boolean> {
  const [alg, , , , saltB64, hashB64] = stored.split('$')
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scryptAsync(secret, Buffer.from(saltB64, 'base64'))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Hash con el mismo costo que un login real, para que un correo inexistente tarde lo mismo
const DUMMY_HASH = await hashSecret(randomBytes(32))
export async function burnVerifyTime(secret: Buffer): Promise<void> {
  await verifySecret(secret, DUMMY_HASH)
}

export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

export class ServerKeys {
  private readonly totpKey: Buffer
  private readonly saltKey: Buffer
  private readonly backupKey: Buffer

  constructor(serverSecret: Buffer) {
    const derive = (info: string) => Buffer.from(hkdfSync('sha256', serverSecret, Buffer.alloc(0), info, 32))
    this.totpKey = derive('passme:server:totp')
    this.saltKey = derive('passme:server:fake-salt')
    this.backupKey = derive('passme:server:backup-codes')
  }

  // Cifrado del lado del servidor para el secreto TOTP del inicio de sesión (AES-256-GCM)
  seal(plaintext: string, aad: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.totpKey, iv)
    cipher.setAAD(Buffer.from(aad))
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64')
  }

  open(sealed: string, aad: string): string {
    const raw = Buffer.from(sealed, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', this.totpKey, raw.subarray(0, 12))
    decipher.setAAD(Buffer.from(aad))
    decipher.setAuthTag(raw.subarray(raw.length - 16))
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8')
  }

  // Sal estable para correos que no existen: así /prelogin no revela qué cuentas hay
  fakeSalt(email: string): string {
    return createHmac('sha256', this.saltKey).update(email).digest().subarray(0, 16).toString('base64')
  }

  backupCodeHash(userId: string, code: string): Buffer {
    return createHmac('sha256', this.backupKey).update(`${userId}:${code}`).digest()
  }
}
