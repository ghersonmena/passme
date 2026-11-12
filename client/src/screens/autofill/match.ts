import type { ItemData } from '../../crypto/items'

// A quién se le va a llenar el formulario: una app (por su paquete) o una página en un navegador
// (por su dominio). En un navegador manda el dominio, nunca el paquete del navegador.
export interface FillTarget {
  app: string
  appLabel: string
  domain: string
}

// Así guardan Bitwarden, Proton Pass y otros el vínculo de un login con una app de Android
export const androidAppUrl = (pkg: string) => `androidapp://${pkg}`

// Dominios de segundo nivel comunes: en ellos el sitio es lo que va antes (banco.com.mx)
const SECOND_LEVEL = new Set(['com.mx', 'org.mx', 'gob.mx', 'edu.mx', 'net.mx', 'co.uk', 'org.uk', 'com.ar', 'com.br', 'com.co', 'com.pe', 'com.au', 'co.jp', 'com.es'])

export function baseDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')
  const lastTwo = labels.slice(-2).join('.')
  return SECOND_LEVEL.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo
}

function hostOf(url: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname
  } catch {
    return ''
  }
}

export function matchesTarget(d: ItemData, target: FillTarget): boolean {
  if (d.type !== 'login') return false
  if (target.domain) {
    const base = baseDomain(target.domain)
    return d.urls.some((u) => {
      if (u.startsWith('androidapp://')) return false
      const host = hostOf(u)
      return !!host && baseDomain(host) === base
    })
  }
  return !!target.app && d.urls.includes(androidAppUrl(target.app))
}

// Nombre que se propone al guardar un login nuevo
export function targetName(target: FillTarget): string {
  if (target.domain) return baseDomain(target.domain)
  return target.appLabel || target.app
}

export function targetUrl(target: FillTarget): string {
  return target.domain ? `https://${target.domain}` : androidAppUrl(target.app)
}
