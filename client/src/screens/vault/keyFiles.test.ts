import { describe, expect, it } from 'vitest'
import anaPrivate from './fixtures/ana-private.asc?raw'
import anaPublic from './fixtures/ana-public.asc?raw'
import betoBinary from './fixtures/beto-private.gpg.b64?raw'
import sshPrivate from './fixtures/id_ed25519?raw'
import sshPublic from './fixtures/id_rsa.pub?raw'
import tlsPem from './fixtures/tls.pem?raw'
import { analyzeKey, codeStatus, isWordPhrase, keyFileName, parseCodes, phraseWords } from './keyFiles'

// Huellas y fechas tal como las dan gpg y ssh-keygen para esas mismas llaves
const ANA = '9C05 D61F 84B1 A545 C78A 500E 3696 04BF A218 9A3E'
const BETO = '5772 45A3 A59C 0D76 E585 CDB1 F3E9 CBE7 B48A CBCD'

describe('llaves PGP', () => {
  it('lee identidad, huella, fechas y si tiene frase de paso', async () => {
    const info = (await analyzeKey(anaPrivate))!
    expect(info).toMatchObject({
      kind: 'pgp',
      identity: 'Ana Prueba <ana@example.com>',
      fingerprint: ANA,
      createdOn: '2026-11-12',
      expiresOn: '2027-06-30',
      encrypted: true
    })
    expect(info.privateKey).toBe(anaPrivate.trim())
  })

  it('arma la llave pública a partir de la privada', async () => {
    const info = (await analyzeKey(anaPrivate))!
    expect(info.publicKey).toMatch(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/)
    expect(info.publicKey).not.toContain('PRIVATE')
    const pub = (await analyzeKey(info.publicKey))!
    expect(pub).toMatchObject({ fingerprint: ANA, identity: 'Ana Prueba <ana@example.com>', privateKey: '', expiresOn: '2027-06-30' })
  })

  it('usa la pública que venga en el texto en lugar de armarla', async () => {
    const info = (await analyzeKey(`${anaPrivate}\n${anaPublic}`))!
    expect(info.publicKey).toBe(anaPublic.trim())
  })

  it('convierte un archivo binario de GnuPG', async () => {
    const bytes = Uint8Array.from(atob(betoBinary.trim()), (c) => c.charCodeAt(0))
    const info = (await analyzeKey(bytes))!
    expect(info).toMatchObject({ kind: 'pgp', identity: 'Beto RSA <beto@example.com>', fingerprint: BETO, expiresOn: '', encrypted: false })
    expect(info.privateKey).toMatch(/^-----BEGIN PGP PRIVATE KEY BLOCK-----/)
    expect((await analyzeKey(info.privateKey))!.fingerprint).toBe(BETO)
  })
})

describe('otras llaves', () => {
  it('SSH privada: pública, huella y frase de paso', async () => {
    const info = (await analyzeKey(sshPrivate))!
    expect(info).toMatchObject({ kind: 'ssh', fingerprint: 'SHA256:06GTaySA8UsxCei6awgj21MyON8T/1wxxER0abarfi8', encrypted: true })
    expect(info.publicKey).toMatch(/^ssh-ed25519 AAAA/)
  })

  it('SSH pública de una línea, con su comentario', async () => {
    const info = (await analyzeKey(sshPublic))!
    expect(info).toMatchObject({
      kind: 'ssh',
      privateKey: '',
      identity: 'servidor',
      fingerprint: 'SHA256:NLJI3OZ5MLEgDp3fqJ7yCWiplhrmiwQzlBKRkCzGYvw'
    })
  })

  it('PEM y age', async () => {
    expect(await analyzeKey(tlsPem)).toMatchObject({ kind: 'pem', encrypted: false, privateKey: tlsPem.trim() })
    const age = '# created: 2026-01-02T10:00:00Z\n# public key: age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq\nAGE-SECRET-KEY-1QYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQYQSZQGPQQ\n'
    expect(await analyzeKey(age)).toMatchObject({
      kind: 'age',
      createdOn: '2026-01-02',
      publicKey: 'age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq'
    })
  })

  it('no reconoce texto que no es una llave', async () => {
    expect(await analyzeKey('hola mundo')).toBeNull()
    expect(await analyzeKey(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('nombra los archivos al descargar', () => {
    expect(keyFileName('Passbolt Trabajo', 'pgp', 'private')).toBe('passbolt-trabajo-private.asc')
    expect(keyFileName('Servidor ñandú', 'ssh', 'public')).toBe('servidor-nandu_id.pub')
  })
})

describe('recuperación', () => {
  it('separa las palabras de una frase, con o sin números', () => {
    expect(phraseWords('1. alfa 2. beta\n3) gama, delta')).toEqual(['alfa', 'beta', 'gama', 'delta'])
    expect(isWordPhrase('abandon ability able about above absent')).toBe(true)
    expect(isWordPhrase('AB12-CD34-EF56')).toBe(false)
  })

  it('cuenta los códigos que quedan', () => {
    expect(parseCodes('1. 1234 5678\n2. abcd-efgh\n\n9999 0000')).toEqual(['1234 5678', 'abcd-efgh', '9999 0000'])
    const status = codeStatus('1234 5678\nabcd-efgh\n9999 0000', '12345678\nABCD-EFGH')
    expect(status).toMatchObject({ total: 3, left: 1 })
  })
})
