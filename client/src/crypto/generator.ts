import { wordlist } from '@scure/bip39/wordlists/english.js'

export interface PasswordOptions {
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  // Quita caracteres que se confunden al leerlos (O/0, l/1/I)
  avoidAmbiguous: boolean
}

export interface PassphraseOptions {
  words: number
  separator: string
  capitalize: boolean
  includeNumber: boolean
}

const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~'
}
const AMBIGUOUS = /[O0oIl1|]/g

// Entero uniforme en [0, max) con muestreo por rechazo: sin el sesgo de usar % directamente
export function randomInt(max: number): number {
  if (max <= 0 || max > 2 ** 32) throw new RangeError('max')
  const limit = Math.floor(2 ** 32 / max) * max
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    const value = buf[0]!
    if (value < limit) return value % max
  }
}

function pick<T>(list: ArrayLike<T>): T {
  return list[randomInt(list.length)]!
}

function activeSets(opts: PasswordOptions): string[] {
  const sets: string[] = []
  for (const name of ['lower', 'upper', 'digits', 'symbols'] as const) {
    if (!opts[name]) continue
    sets.push(opts.avoidAmbiguous ? SETS[name].replace(AMBIGUOUS, '') : SETS[name])
  }
  return sets.length ? sets : [SETS.lower]
}

export function generatePassword(opts: PasswordOptions): string {
  const sets = activeSets(opts)
  const pool = sets.join('')
  const length = Math.max(opts.length, sets.length)
  // Se garantiza al menos un carácter de cada grupo elegido, y luego se revuelve
  const chars = sets.map((set) => pick(set))
  while (chars.length < length) chars.push(pick(pool))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

export function generatePassphrase(opts: PassphraseOptions): string {
  const words = Array.from({ length: opts.words }, () => {
    const word = pick(wordlist)
    return opts.capitalize ? word[0]!.toUpperCase() + word.slice(1) : word
  })
  if (opts.includeNumber) {
    const i = randomInt(words.length)
    words[i] = words[i] + String(randomInt(10))
  }
  return words.join(opts.separator)
}

export function passwordEntropy(opts: PasswordOptions): number {
  return Math.max(opts.length, 1) * Math.log2(activeSets(opts).join('').length)
}

export function passphraseEntropy(opts: PassphraseOptions): number {
  return opts.words * Math.log2(wordlist.length) + (opts.includeNumber ? Math.log2(10 * opts.words) : 0)
}

export type Strength = 'weak' | 'fair' | 'good' | 'strong'

export function strengthFromBits(bits: number): Strength {
  if (bits < 50) return 'weak'
  if (bits < 70) return 'fair'
  if (bits < 100) return 'good'
  return 'strong'
}

// Estimación rápida para una contraseña escrita a mano. Es conservadora a propósito: castiga
// repeticiones y secuencias. El monitor de seguridad (v0.5) hará un análisis completo.
export function estimatePasswordBits(password: string): number {
  if (!password) return 0
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/\d/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33
  const unique = new Set(password).size
  const effectiveLength = Math.min(password.length, unique * 2)
  let bits = effectiveLength * Math.log2(Math.max(pool, 1))
  if (/(.)\1{2,}/.test(password)) bits *= 0.8
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(password)) bits *= 0.7
  return Math.round(bits)
}
