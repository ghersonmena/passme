import type { ItemData } from '../crypto/items'
import type { VaultMeta } from '../crypto/keys'
import type { Translate } from '../i18n'
import { cardBrand, fieldLabel, SECRET_KINDS, TYPE_BY_ID, typeLabel } from '../screens/vault/itemTypes'
import { toCsv } from './csv'

// Formatos de exportación y a dónde sirve cada uno:
//   passme          copia completa (todos los tipos y bóvedas) para restaurar en PassMe
//   bitwardenJson   Proton Pass, Bitwarden, 1Password, NordPass, Keeper… (el formato más aceptado)
//   bitwardenCsv    Passbolt, KeePassXC y los que importan CSV de Bitwarden
//   browserCsv      Chrome, Edge, Brave, Firefox y Safari (solo inicios de sesión)
export const EXPORT_FORMATS = ['passme', 'bitwardenJson', 'bitwardenCsv', 'browserCsv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export interface ExportVault {
  meta: VaultMeta
  items: ItemData[]
}

export interface ExportFile {
  name: string
  mime: string
  text: string
  // Elementos que el formato no admite y se dejaron fuera
  left: number
}

export function exportVaults(format: ExportFormat, vaults: ExportVault[], t: Translate, now = new Date()): ExportFile {
  const date = now.toISOString().slice(0, 10)
  switch (format) {
    case 'passme':
      return {
        name: `passme-${date}.json`,
        mime: 'application/json',
        text: JSON.stringify(
          {
            format: 'passme',
            version: 1,
            exportedAt: now.toISOString(),
            vaults: vaults.map((v) => ({ name: v.meta.name, icon: v.meta.icon, color: v.meta.color, items: v.items }))
          },
          null,
          2
        ),
        left: 0
      }
    case 'bitwardenJson':
      return { name: `passme-bitwarden-${date}.json`, mime: 'application/json', text: bitwardenJson(vaults, t), left: 0 }
    case 'bitwardenCsv':
      return { name: `passme-bitwarden-${date}.csv`, mime: 'text/csv', text: bitwardenCsv(vaults, t), left: 0 }
    case 'browserCsv': {
      const logins = vaults.flatMap((v) => v.items).filter((d) => d.type === 'login')
      const total = vaults.reduce((n, v) => n + v.items.length, 0)
      const rows = logins.map((d) => [d.name, d.urls[0] ?? '', d.fields.username ?? '', d.fields.password ?? '', d.note])
      return {
        name: `passme-browser-${date}.csv`,
        mime: 'text/csv',
        text: toCsv([['name', 'url', 'username', 'password', 'note'], ...rows]),
        left: total - logins.length
      }
    }
  }
}

interface BwField {
  name: string
  value: string
  type: 0 | 1
}

// Campos del tipo que el formato de destino no tiene, como campos personalizados con su etiqueta
function extraFields(d: ItemData, t: Translate, skip: string[] = []): BwField[] {
  const def = TYPE_BY_ID[d.type]
  const own = def.fields
    .filter((fd) => !skip.includes(fd.key) && d.fields[fd.key])
    .map((fd) => ({ name: t(fieldLabel(fd)), value: d.fields[fd.key]!, type: (SECRET_KINDS.includes(fd.kind) ? 1 : 0) as 0 | 1 }))
  const custom = d.custom.map((c) => ({ name: c.label, value: c.value, type: (c.secret ? 1 : 0) as 0 | 1 }))
  return [...own, ...custom]
}

function splitName(full = ''): [string, string] {
  const parts = full.trim().split(/\s+/)
  return [parts[0] ?? '', parts.slice(1).join(' ')]
}

function bitwardenItem(d: ItemData, folderId: string, t: Translate) {
  const base = {
    id: crypto.randomUUID(),
    organizationId: null,
    folderId,
    reprompt: 0,
    name: d.name || t(typeLabel(d.type)),
    notes: d.note || null,
    favorite: d.favorite,
    collectionIds: null
  }
  const f = d.fields
  switch (d.type) {
    case 'login':
      return {
        ...base,
        type: 1,
        fields: extraFields(d, t, ['username', 'password', 'totp']),
        login: {
          uris: d.urls.map((uri) => ({ match: null, uri })),
          username: f.username ?? null,
          password: f.password ?? null,
          totp: f.totp ?? null
        }
      }
    case 'card': {
      const [month, year] = (f.expiry ?? '').split('/').map((s) => s.trim())
      return {
        ...base,
        type: 3,
        fields: extraFields(d, t, ['holder', 'cardNumber', 'expiry', 'cvv']),
        card: {
          cardholderName: f.holder ?? null,
          brand: cardBrand(f.cardNumber) || null,
          number: f.cardNumber ?? null,
          expMonth: month ? String(Number(month)) : null,
          expYear: year ? (year.length === 2 ? `20${year}` : year) : null,
          code: f.cvv ?? null
        }
      }
    }
    case 'identity': {
      const [firstName, lastName] = splitName(f.fullName)
      return {
        ...base,
        type: 4,
        fields: extraFields(d, t, ['fullName', 'email', 'phone', 'address', 'nationalId']),
        identity: {
          firstName: firstName || null,
          lastName: lastName || null,
          email: f.email ?? null,
          phone: f.phone ?? null,
          address1: f.address?.replace(/\n/g, ', ') ?? null,
          ssn: f.nationalId ?? null
        }
      }
    }
    // El resto (wifi, servidores, bases de datos…) va como nota segura con sus campos, que es lo
    // que entienden todos los gestores
    default:
      return { ...base, type: 2, secureNote: { type: 0 }, fields: extraFields(d, t) }
  }
}

function bitwardenJson(vaults: ExportVault[], t: Translate): string {
  const folders = vaults.map((v) => ({ id: crypto.randomUUID(), name: v.meta.name }))
  const items = vaults.flatMap((v, i) => v.items.map((d) => bitwardenItem(d, folders[i]!.id, t)))
  return JSON.stringify({ encrypted: false, folders, items }, null, 2)
}

function bitwardenCsv(vaults: ExportVault[], t: Translate): string {
  const header = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp']
  const rows = vaults.flatMap((v) =>
    v.items.map((d) => {
      const login = d.type === 'login'
      const fields = extraFields(d, t, login ? ['username', 'password', 'totp'] : [])
      // La columna "fields" es una línea por campo: los de varias líneas (llaves SSH, frases
      // semilla…) van completos al final de las notas
      const long = fields.filter((x) => /\r?\n/.test(x.value))
      const notes = [d.note, ...long.map((x) => `${x.name}:\n${x.value}`)].filter(Boolean).join('\n\n')
      return [
        v.meta.name,
        d.favorite ? '1' : '',
        login ? 'login' : 'note',
        d.name || t(typeLabel(d.type)),
        notes,
        fields
          .filter((x) => !long.includes(x))
          .map((x) => `${x.name}: ${x.value}`)
          .join('\n'),
        '0',
        login ? d.urls.join(',') : '',
        login ? (d.fields.username ?? '') : '',
        login ? (d.fields.password ?? '') : '',
        login ? (d.fields.totp ?? '') : ''
      ]
    })
  )
  return toCsv([header, ...rows])
}
