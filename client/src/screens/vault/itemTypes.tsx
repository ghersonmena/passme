import {
  Bitcoin,
  BookUser,
  Braces,
  CreditCard,
  Database,
  FileKey,
  HeartPulse,
  IdCard,
  KeyRound,
  Landmark,
  MapPin,
  Server,
  SquareTerminal,
  StickyNote,
  Wifi,
  type LucideIcon
} from 'lucide-react'
import type { ItemData, ItemType } from '../../crypto/items'
import type { MessageKey } from '../../i18n'
import { es } from '../../i18n/es'

// Cómo se captura y se muestra cada campo:
//   text       texto de una línea           secret     se oculta hasta que se pide verlo
//   password   secreto con generador        multiline  varias líneas
//   secretText secreto de varias líneas     date       fecha (AAAA-MM-DD)
//   expiry     vencimiento MM/AA            select     lista fija de opciones
export type FieldKind =
  | 'text'
  | 'email'
  | 'phone'
  | 'number'
  | 'url'
  | 'secret'
  | 'password'
  | 'multiline'
  | 'secretText'
  | 'date'
  | 'expiry'
  | 'select'

export interface FieldDef {
  key: string
  kind: FieldKind
  // Etiqueta distinta a la del campo (el usuario de un login acepta también correo)
  label?: string
  mono?: boolean
  // Fechas de vencimiento: se avisa si ya pasaron o están por pasar
  expires?: boolean
  options?: string[]
}

export interface TypeDef {
  type: ItemType
  icon: LucideIcon
  fields: FieldDef[]
  // Solo los inicios de sesión tienen lista de sitios web
  urls?: boolean
  // Lo que aparece bajo el nombre en la lista; nunca un secreto completo
  subtitle: (d: ItemData) => string
}

const f = (key: string, kind: FieldKind = 'text', extra: Partial<FieldDef> = {}): FieldDef => ({ key, kind, ...extra })

const ENGINES = ['postgresql', 'mysql', 'mariadb', 'sqlserver', 'oracle', 'mongodb', 'redis', 'sqlite', 'other']
const PROTOCOLS = ['ssh', 'rdp', 'vnc', 'sftp', 'ftp', 'web', 'other']
const WIFI_SECURITY = ['wpa2', 'wpa3', 'wpa', 'wep', 'open']
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

export const lastDigits = (value = '') => {
  const digits = value.replace(/\D/g, '')
  return digits ? `•••• ${digits.slice(-4)}` : ''
}

const first = (...values: (string | undefined)[]) => values.find((v) => v && v.trim()) ?? ''

export const TYPES: TypeDef[] = [
  {
    type: 'login',
    icon: KeyRound,
    urls: true,
    fields: [f('username', 'text', { label: 'loginUsername' }), f('password', 'password')],
    subtitle: (d) => first(d.fields.username, d.urls[0])
  },
  {
    type: 'note',
    icon: StickyNote,
    fields: [],
    subtitle: (d) => d.note.split('\n')[0] ?? ''
  },
  {
    type: 'card',
    icon: CreditCard,
    fields: [
      f('holder'),
      f('cardNumber', 'secret', { mono: true }),
      f('expiry', 'expiry', { mono: true, expires: true }),
      f('cvv', 'secret', { mono: true }),
      f('pin', 'secret', { mono: true }),
      f('cardKind', 'select', { options: ['credit', 'debit', 'prepaid'] })
    ],
    subtitle: (d) => lastDigits(d.fields.cardNumber)
  },
  {
    type: 'identity',
    icon: IdCard,
    fields: [
      f('fullName'),
      f('birthDate', 'date'),
      f('email', 'email'),
      f('phone', 'phone'),
      f('address', 'multiline'),
      f('nationalId', 'text', { mono: true }),
      f('taxId', 'text', { mono: true })
    ],
    subtitle: (d) => first(d.fields.fullName, d.fields.email)
  },
  {
    type: 'api',
    icon: Braces,
    fields: [
      f('url', 'url'),
      f('clientId', 'text', { mono: true }),
      f('apiKey', 'secret', { mono: true }),
      f('token', 'secretText', { mono: true }),
      f('expiresOn', 'date', { expires: true })
    ],
    subtitle: (d) => first(d.fields.url, d.fields.clientId)
  },
  {
    type: 'database',
    icon: Database,
    fields: [
      f('engine', 'select', { options: ENGINES }),
      f('host', 'text', { mono: true }),
      f('port', 'number', { mono: true }),
      f('database', 'text', { mono: true }),
      f('username'),
      f('password', 'password'),
      f('connectionString', 'secretText', { mono: true })
    ],
    subtitle: (d) => first(d.fields.host && `${d.fields.host}${d.fields.port ? ':' + d.fields.port : ''}`, d.fields.database)
  },
  {
    type: 'server',
    icon: Server,
    fields: [
      f('host', 'text', { mono: true }),
      f('port', 'number', { mono: true }),
      f('protocol', 'select', { options: PROTOCOLS }),
      f('username'),
      f('password', 'password')
    ],
    subtitle: (d) => first(d.fields.username && d.fields.host && `${d.fields.username}@${d.fields.host}`, d.fields.host)
  },
  {
    type: 'license',
    icon: FileKey,
    fields: [
      f('version'),
      f('licenseKey', 'secretText', { mono: true }),
      f('licensedTo'),
      f('email', 'email'),
      f('purchaseDate', 'date'),
      f('expiresOn', 'date', { expires: true })
    ],
    subtitle: (d) => first(d.fields.version, d.fields.licensedTo)
  },
  {
    type: 'sshKey',
    icon: SquareTerminal,
    fields: [
      f('host', 'text', { mono: true }),
      f('username'),
      f('publicKey', 'multiline', { mono: true }),
      f('privateKey', 'secretText', { mono: true }),
      f('passphrase', 'secret'),
      f('fingerprint', 'text', { mono: true })
    ],
    subtitle: (d) => first(d.fields.username && d.fields.host && `${d.fields.username}@${d.fields.host}`, d.fields.host, d.fields.fingerprint)
  },
  {
    type: 'wifi',
    icon: Wifi,
    fields: [f('ssid'), f('password', 'password'), f('security', 'select', { options: WIFI_SECURITY })],
    subtitle: (d) => d.fields.ssid ?? ''
  },
  {
    type: 'location',
    icon: MapPin,
    fields: [f('address', 'multiline'), f('coordinates', 'text', { mono: true }), f('accessCode', 'secret', { mono: true })],
    subtitle: (d) => first(d.fields.address?.split('\n')[0], d.fields.coordinates)
  },
  {
    type: 'bank',
    icon: Landmark,
    fields: [
      f('bankName'),
      f('holder'),
      f('accountKind', 'select', { options: ['checking', 'savings', 'payroll', 'investment', 'other'] }),
      f('accountNumber', 'secret', { mono: true }),
      f('iban', 'secret', { mono: true }),
      f('swift', 'text', { mono: true }),
      f('pin', 'secret', { mono: true })
    ],
    subtitle: (d) => [d.fields.bankName, lastDigits(d.fields.accountNumber)].filter(Boolean).join(' · ')
  },
  {
    type: 'crypto',
    icon: Bitcoin,
    fields: [
      f('coin'),
      f('walletApp'),
      f('address', 'text', { mono: true }),
      f('seedPhrase', 'secretText', { mono: true }),
      f('privateKey', 'secretText', { mono: true }),
      f('password', 'password')
    ],
    subtitle: (d) => first(d.fields.coin, d.fields.walletApp)
  },
  {
    type: 'medical',
    icon: HeartPulse,
    fields: [
      f('fullName'),
      f('bloodType', 'select', { options: BLOOD_TYPES }),
      f('allergies', 'multiline'),
      f('conditions', 'multiline'),
      f('medications', 'multiline'),
      f('doctor'),
      f('doctorPhone', 'phone'),
      f('insurer'),
      f('policyNumber', 'text', { mono: true }),
      f('emergencyContact')
    ],
    subtitle: (d) => first(d.fields.fullName, d.fields.insurer)
  },
  {
    type: 'passport',
    icon: BookUser,
    fields: [
      f('fullName'),
      f('passportNumber', 'secret', { mono: true }),
      f('nationality'),
      f('birthDate', 'date'),
      f('birthPlace'),
      f('issueDate', 'date'),
      f('expiresOn', 'date', { expires: true }),
      f('authority')
    ],
    subtitle: (d) => first(d.fields.fullName, d.fields.nationality)
  }
]

export const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.type, t])) as Record<ItemType, TypeDef>

export const SECRET_KINDS: FieldKind[] = ['secret', 'password', 'secretText']

export const fieldLabel = (fd: FieldDef) => `f.${fd.label ?? fd.key}` as MessageKey
export const typeLabel = (type: ItemType) => `type.${type}` as MessageKey

// Las opciones se muestran con su traducción si la tienen (crédito, cheques…) y las demás (A+, O-)
// tal cual
export function optionLabel(t: (key: MessageKey) => string, value: string): string {
  const key = `opt.${value}` as MessageKey
  return key in es ? t(key) : value
}

// Texto que se puede buscar: nombre, sitios y campos que no son secretos
export function searchText(d: ItemData): string {
  const def = TYPE_BY_ID[d.type]
  const visible = def.fields.filter((fd) => !SECRET_KINDS.includes(fd.kind)).map((fd) => d.fields[fd.key] ?? '')
  return [d.name, ...d.urls, ...visible, ...d.custom.filter((c) => !c.secret).map((c) => c.value)].join('\n').toLowerCase()
}

// --- Vencimientos ---

export type ExpiryStatus = 'expired' | 'soon' | null

// Acepta AAAA-MM-DD o MM/AA (tarjetas, que vencen al terminar ese mes)
export function expiryDate(value: string): Date | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]) + 1)
  const card = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(value.trim())
  if (card) {
    const month = Number(card[1])
    const year = card[2]!.length === 2 ? 2000 + Number(card[2]) : Number(card[2])
    if (month >= 1 && month <= 12) return new Date(year, month, 1)
  }
  return null
}

export function expiryStatus(value: string, now = new Date()): ExpiryStatus {
  const end = expiryDate(value)
  if (!end) return null
  if (end <= now) return 'expired'
  return end.getTime() - now.getTime() < 60 * 86_400_000 ? 'soon' : null
}

// --- Tarjetas ---

export function cardBrand(number = ''): string {
  const n = number.replace(/\D/g, '')
  if (n.startsWith('4')) return 'Visa'
  if (/^(5[1-5]|2[2-7])/.test(n)) return 'Mastercard'
  if (/^3[47]/.test(n)) return 'American Express'
  if (/^6(011|5)/.test(n)) return 'Discover'
  return ''
}

export function formatCardNumber(number: string): string {
  const n = number.replace(/\s/g, '')
  return /^\d+$/.test(n) ? n.replace(/(.{4})(?=.)/g, '$1 ') : number
}

// --- Wi-Fi: texto del QR que leen las cámaras de Android e iOS para conectarse ---

export function wifiQrText(d: ItemData): string {
  const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1')
  const security = d.fields.security ?? 'wpa2'
  const kind = security === 'open' ? 'nopass' : security === 'wep' ? 'WEP' : 'WPA'
  const pass = kind === 'nopass' ? '' : `P:${esc(d.fields.password ?? '')};`
  return `WIFI:T:${kind};S:${esc(d.fields.ssid ?? '')};${pass};`
}

// --- Ubicaciones: "lat, lon" a un enlace de OpenStreetMap ---

export function mapUrl(coordinates: string): string | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(coordinates)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`
}
