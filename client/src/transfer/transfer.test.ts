import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { emptyItem, type ItemData } from '../crypto/items'
import { es } from '../i18n/es'
import type { MessageKey } from '../i18n'
import { parseCsv, toCsv } from './csv'
import { exportVaults, type ExportVault } from './exporters'
import { importFile, importText, ImportError } from './importers'

const t = (key: MessageKey) => es[key]

const login = (name: string, fields: Record<string, string>, extra: Partial<ItemData> = {}): ItemData => ({
  ...emptyItem('login'),
  name,
  fields,
  ...extra
})

describe('CSV', () => {
  it('lee comillas, saltos de línea y comillas escapadas', () => {
    const rows = parseCsv('﻿a,b,c\r\n"uno, dos","línea 1\nlínea 2","dice ""hola"""\n\n')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['uno, dos', 'línea 1\nlínea 2', 'dice "hola"']
    ])
  })

  it('detecta el punto y coma como separador', () => {
    expect(parseCsv('name;password\nx;y')).toEqual([
      ['name', 'password'],
      ['x', 'y']
    ])
  })

  it('escribe lo que luego lee igual', () => {
    const rows = [['a', 'b'], ['con, coma', 'con "comillas"\ny salto'], [' espacio', '']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
})

describe('importar CSV', () => {
  it('Chrome', () => {
    const r = importText('name,url,username,password,note\ngithub.com,https://github.com/login,ana,s3cr3t,mi nota\n')
    expect(r.source).toBe('Chrome / Edge')
    expect(r.items[0]!.data).toMatchObject({
      type: 'login',
      name: 'github.com',
      urls: ['https://github.com/login'],
      note: 'mi nota',
      fields: { username: 'ana', password: 's3cr3t' }
    })
  })

  it('Bitwarden (también lo exporta Passbolt), con campos extra, notas y carpetas', () => {
    const csv = [
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
      'Trabajo,1,login,GitLab,,"PIN: 1234\nRegión: MX",0,https://gitlab.com,ana,clave,otpauth://totp/x?secret=ABC',
      ',,note,Receta,"Harina y agua",,0,,,,'
    ].join('\n')
    const r = importText(csv)
    expect(r.source).toBe('Bitwarden')
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({
      folder: 'Trabajo',
      data: {
        favorite: true,
        fields: { username: 'ana', password: 'clave', totp: 'otpauth://totp/x?secret=ABC' },
        custom: [
          { label: 'PIN', value: '1234', secret: false },
          { label: 'Región', value: 'MX', secret: false }
        ]
      }
    })
    expect(r.items[1]!.data).toMatchObject({ type: 'note', name: 'Receta', note: 'Harina y agua' })
  })

  it('Passbolt / KeePass con grupos anidados', () => {
    const r = importText('"Group","Title","Username","Password","URL","Notes"\n"Root/Servidores","VPS","root","x","ssh://1.2.3.4",""\n')
    expect(r.source).toBe('Passbolt / KeePass')
    expect(r.items[0]).toMatchObject({ folder: 'Servidores', data: { name: 'VPS', fields: { username: 'root' } } })
  })

  it('LastPass, con notas seguras', () => {
    const csv = 'url,username,password,totp,extra,name,grouping,fav\nhttp://sn,,,,"Mi secreto",Nota,Personal,0\nhttps://x.com,yo,pw,,,X,,1\n'
    const r = importText(csv)
    expect(r.source).toBe('LastPass')
    expect(r.items[0]!.data).toMatchObject({ type: 'note', name: 'Nota', note: 'Mi secreto', urls: [] })
    expect(r.items[0]!.folder).toBe('Personal')
    expect(r.items[1]!.data.favorite).toBe(true)
  })

  it('Firefox: sin columna de nombre, usa el dominio y descarta sus metadatos', () => {
    const csv = 'url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\nhttps://www.mozilla.org,yo,pw,,https://www.mozilla.org,{1},1,2,3\n'
    const r = importText(csv)
    expect(r.source).toBe('Firefox')
    expect(r.items[0]!.data.name).toBe('mozilla.org')
    expect(r.items[0]!.data.custom).toEqual([])
  })

  it('Proton Pass (CSV): conserva el correo si es distinto del usuario', () => {
    const csv = 'type,name,url,email,username,password,note,totp,createTime,modifyTime,vault\nlogin,Correo,https://mail.com,ana@mail.com,ana,pw,,,1700000000,1700000000,Personal\n'
    const r = importText(csv)
    expect(r.source).toBe('Proton Pass')
    expect(r.items[0]).toMatchObject({
      folder: 'Personal',
      data: { fields: { username: 'ana' }, custom: [{ label: 'Email', value: 'ana@mail.com' }] }
    })
  })

  it('rechaza lo que no reconoce y los archivos cifrados', () => {
    expect(() => importText('hola mundo')).toThrow(ImportError)
    expect(() => importText('-----BEGIN PGP MESSAGE-----\n...')).toThrow('pgp')
    expect(() => importText('{"encrypted":true,"items":[]}')).toThrow('encrypted')
    expect(() => importText('   ')).toThrow('empty')
  })
})

const PROTON = {
  version: '1.21.0',
  userId: 'u',
  encrypted: false,
  vaults: {
    share1: {
      name: 'Personal',
      items: [
        {
          itemId: 'a',
          state: 1,
          pinned: true,
          data: {
            type: 'login',
            metadata: { name: 'Proton', note: 'nota' },
            extraFields: [{ fieldName: 'Pregunta', type: 'hidden', data: { content: 'perro' } }],
            content: { itemEmail: 'ana@proton.me', itemUsername: '', password: 'pw', urls: ['https://proton.me'], totpUri: '' }
          }
        },
        {
          itemId: 'b',
          state: 1,
          data: {
            type: 'creditCard',
            metadata: { name: 'Visa', note: '' },
            extraFields: [],
            content: { cardholderName: 'ANA', number: '4111111111111111', verificationNumber: '123', expirationDate: '2027-03', pin: '' }
          }
        },
        {
          itemId: 'c',
          state: 1,
          data: {
            type: 'identity',
            metadata: { name: 'Yo', note: '' },
            extraFields: [],
            content: { firstName: 'Ana', lastName: 'López', email: 'ana@x.com', city: 'CDMX', zipOrPostalCode: '01000', passportNumber: 'G123', extraPersonalDetails: [{ fieldName: 'Apodo', type: 'text', data: { content: 'Anita' } }] }
          }
        },
        { itemId: 'd', state: 1, data: { type: 'wifi', metadata: { name: 'Casa', note: '' }, extraFields: [], content: { ssid: 'MiRed', password: 'clave' } } },
        { itemId: 'e', state: 2, data: { type: 'note', metadata: { name: 'Borrada', note: 'x' }, extraFields: [], content: {} } }
      ]
    }
  }
}

describe('importar JSON', () => {
  it('Proton Pass dentro de su .zip', async () => {
    const zip = zipSync({ 'Proton Pass/data.json': strToU8(JSON.stringify(PROTON)) })
    const r = await importFile(new File([zip], 'export.zip'))
    expect(r.source).toBe('Proton Pass')
    // La de la papelera no se importa
    expect(r.items.map((i) => i.data.type)).toEqual(['login', 'card', 'identity', 'wifi'])
    const [l, card, id, wifi] = r.items.map((i) => i.data)
    expect(l).toMatchObject({
      favorite: true,
      fields: { username: 'ana@proton.me', password: 'pw' },
      custom: [{ label: 'Pregunta', value: 'perro', secret: true }]
    })
    expect(card!.fields).toEqual({ holder: 'ANA', cardNumber: '4111111111111111', expiry: '03/27', cvv: '123' })
    expect(id!.fields).toMatchObject({ fullName: 'Ana López', email: 'ana@x.com', address: '01000 CDMX' })
    expect(id!.custom).toEqual([
      { label: 'Passport number', value: 'G123', secret: false },
      { label: 'Apodo', value: 'Anita', secret: false }
    ])
    expect(wifi!.fields).toEqual({ ssid: 'MiRed', password: 'clave' })
    expect(r.items.every((i) => i.folder === 'Personal')).toBe(true)
  })

  it('Bitwarden', () => {
    const json = {
      encrypted: false,
      folders: [{ id: 'f1', name: 'Bancos' }],
      items: [
        {
          type: 1,
          name: 'Banco',
          folderId: 'f1',
          favorite: false,
          notes: null,
          fields: [{ name: 'Cliente', value: '998', type: 0 }],
          login: { uris: [{ uri: 'https://banco.mx' }], username: 'ana', password: 'pw', totp: null }
        },
        { type: 3, name: 'MC', card: { cardholderName: 'ANA', number: '5500000000000004', expMonth: '7', expYear: '2028', code: '999' } },
        { type: 5, name: 'Llave', sshKey: { privateKey: 'PRIV', publicKey: 'PUB', keyFingerprint: 'SHA256:x' } }
      ]
    }
    const r = importText(JSON.stringify(json))
    expect(r.source).toBe('Bitwarden')
    expect(r.items[0]).toMatchObject({ folder: 'Bancos', data: { urls: ['https://banco.mx'], custom: [{ label: 'Cliente', value: '998' }] } })
    expect(r.items[1]!.data.fields.expiry).toBe('07/28')
    expect(r.items[2]!.data).toMatchObject({ type: 'sshKey', fields: { privateKey: 'PRIV', fingerprint: 'SHA256:x' } })
  })
})

describe('exportar', () => {
  const vaults: ExportVault[] = [
    {
      meta: { name: 'Personal', icon: 'home', color: 'plum' },
      items: [
        login('GitHub', { username: 'ana', password: 'p,w"1', totp: 'otpauth://totp/a' }, { urls: ['https://github.com'], favorite: true }),
        { ...emptyItem('wifi'), name: 'Casa', fields: { ssid: 'MiRed', password: 'clave' } }
      ]
    },
    {
      meta: { name: 'Servidores' },
      items: [
        { ...emptyItem('sshKey'), name: 'VPS', fields: { host: '1.2.3.4', privateKey: '-----BEGIN-----\nAAA\n-----END-----' } },
        { ...emptyItem('card'), name: 'Visa', fields: { holder: 'ANA', cardNumber: '4111111111111111', expiry: '03/27', cvv: '123' } }
      ]
    }
  ]

  it('PassMe: la copia completa vuelve idéntica', () => {
    const file = exportVaults('passme', vaults, t)
    const r = importText(file.text)
    expect(r.source).toBe('PassMe')
    expect(r.items.map((i) => i.folder)).toEqual(['Personal', 'Personal', 'Servidores', 'Servidores'])
    expect(r.items.map((i) => i.data)).toEqual(vaults.flatMap((v) => v.items))
  })

  it('Bitwarden JSON: inicios de sesión y tarjetas iguales; lo demás como notas con sus campos', () => {
    const r = importText(exportVaults('bitwardenJson', vaults, t).text)
    const [gh, wifi, ssh, card] = r.items.map((i) => i.data)
    expect(gh).toEqual(vaults[0]!.items[0])
    expect(card!.fields).toEqual(vaults[1]!.items[1]!.fields)
    expect(wifi).toMatchObject({ type: 'note', name: 'Casa', custom: [{ label: es['f.ssid'], value: 'MiRed' }, { label: es['f.password'], value: 'clave', secret: true }] })
    expect(ssh!.custom.find((c) => c.secret)!.value).toBe('-----BEGIN-----\nAAA\n-----END-----')
    expect(r.items[2]!.folder).toBe('Servidores')
  })

  it('CSV de Bitwarden: los campos de varias líneas no se rompen', () => {
    const r = importText(exportVaults('bitwardenCsv', vaults, t).text)
    expect(r.source).toBe('Bitwarden')
    expect(r.items[0]!.data).toEqual(vaults[0]!.items[0])
    expect(r.items[2]!.data.note).toContain('-----BEGIN-----\nAAA\n-----END-----')
    expect(r.items[2]!.data.custom).toEqual([{ label: es['f.host'], value: '1.2.3.4', secret: false }])
  })

  it('CSV de navegador: solo inicios de sesión', () => {
    const file = exportVaults('browserCsv', vaults, t)
    expect(file.left).toBe(3)
    const r = importText(file.text)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.data.fields).toEqual({ username: 'ana', password: 'p,w"1' })
  })
})
