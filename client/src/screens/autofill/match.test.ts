import { describe, expect, it } from 'vitest'
import { emptyItem, type ItemData } from '../../crypto/items'
import { baseDomain, matchesTarget, targetName, targetUrl } from './match'

const login = (...urls: string[]): ItemData => ({ ...emptyItem('login'), urls })

describe('autocompletar: a quién le toca', () => {
  it('saca el sitio de un dominio', () => {
    expect(baseDomain('accounts.google.com')).toBe('google.com')
    expect(baseDomain('www.banamex.com.mx')).toBe('banamex.com.mx')
    expect(baseDomain('mi.banco.com.mx')).toBe('banco.com.mx')
    expect(baseDomain('localhost')).toBe('localhost')
  })

  it('en un navegador compara el sitio, no el paquete', () => {
    const target = { app: 'com.android.chrome', appLabel: 'Chrome', domain: 'accounts.google.com' }
    expect(matchesTarget(login('https://mail.google.com'), target)).toBe(true)
    expect(matchesTarget(login('google.com'), target)).toBe(true)
    expect(matchesTarget(login('https://google.com.evil.io'), target)).toBe(false)
    expect(matchesTarget(login('androidapp://com.android.chrome'), target)).toBe(false)
  })

  it('en una app compara el paquete', () => {
    const target = { app: 'com.netflix.mediaclient', appLabel: 'Netflix', domain: '' }
    expect(matchesTarget(login('https://netflix.com', 'androidapp://com.netflix.mediaclient'), target)).toBe(true)
    expect(matchesTarget(login('https://netflix.com'), target)).toBe(false)
    expect(matchesTarget({ ...emptyItem('note'), urls: ['androidapp://com.netflix.mediaclient'] }, target)).toBe(false)
  })

  it('propone nombre y enlace al guardar', () => {
    expect(targetName({ app: 'com.android.chrome', appLabel: 'Chrome', domain: 'login.live.com' })).toBe('live.com')
    expect(targetName({ app: 'com.netflix.mediaclient', appLabel: 'Netflix', domain: '' })).toBe('Netflix')
    expect(targetUrl({ app: 'com.netflix.mediaclient', appLabel: 'Netflix', domain: '' })).toBe('androidapp://com.netflix.mediaclient')
  })
})
