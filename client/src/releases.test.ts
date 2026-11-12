import { describe, expect, it } from 'vitest'
import { compareVersions, RELEASES, unseenReleases } from './releases'

describe('novedades', () => {
  it('la primera es la versión actual y están en orden', () => {
    expect(RELEASES[0]!.version).toBe(__APP_VERSION__)
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1]!.version, RELEASES[i]!.version)).toBeGreaterThan(0)
    }
  })

  it('cada versión trae notas en los dos idiomas', () => {
    for (const r of RELEASES) {
      expect(r.notes.es.length).toBeGreaterThan(0)
      expect(r.notes.en.length).toBe(r.notes.es.length)
    }
  })

  it('compara versiones número por número', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0)
  })

  it('muestra solo lo que falta por ver', () => {
    expect(unseenReleases('')).toEqual([RELEASES[0]])
    expect(unseenReleases(RELEASES[0]!.version)).toEqual([])
    expect(unseenReleases('0.1.8').map((r) => r.version)).toContain('0.1.9')
    expect(unseenReleases('0.1.8').map((r) => r.version)).not.toContain('0.1.8')
  })
})
