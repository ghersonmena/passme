import { describe, expect, it } from 'vitest'
import { formatLatLng, isShortMapLink, mapLinks, parseLocation } from './geo'

describe('coordenadas', () => {
  it('lee "lat, lon" y variantes', () => {
    expect(parseLocation('19.432608, -99.133209')).toEqual({ lat: 19.432608, lng: -99.133209 })
    expect(parseLocation(' 19.4 ; -99.1 ')).toEqual({ lat: 19.4, lng: -99.1 })
    expect(parseLocation('19.4 -99.1')).toEqual({ lat: 19.4, lng: -99.1 })
    expect(parseLocation('95, 10')).toBeNull()
    expect(parseLocation('Calle 5')).toBeNull()
  })

  it('lee enlaces de Google, Apple, OpenStreetMap y geo:', () => {
    const place = 'https://www.google.com/maps/place/Z%C3%B3calo/@19.4326077,-99.1357,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d19.4326018!4d-99.1332049'
    expect(parseLocation(place)).toEqual({ lat: 19.4326018, lng: -99.1332049 })
    expect(parseLocation('https://www.google.com/maps/@19.43,-99.13,15z')).toEqual({ lat: 19.43, lng: -99.13 })
    expect(parseLocation('https://maps.google.com/?q=19.43,-99.13')).toEqual({ lat: 19.43, lng: -99.13 })
    expect(parseLocation('https://maps.apple.com/?ll=40.7,-74.0&q=Pin')).toEqual({ lat: 40.7, lng: -74 })
    expect(parseLocation('https://www.openstreetmap.org/?mlat=48.85&mlon=2.29#map=17/48.85/2.29')).toEqual({ lat: 48.85, lng: 2.29 })
    expect(parseLocation('https://www.openstreetmap.org/#map=15/48.8584/2.2945')).toEqual({ lat: 48.8584, lng: 2.2945 })
    expect(parseLocation('geo:37.78,-122.4')).toEqual({ lat: 37.78, lng: -122.4 })
  })

  it('lee grados, minutos y segundos', () => {
    const p = parseLocation(`19°25'57.4"N 99°07'59.5"W`)!
    expect(p.lat).toBeCloseTo(19.432611, 5)
    expect(p.lng).toBeCloseTo(-99.133194, 5)
  })

  it('reconoce los enlaces cortos que no traen coordenadas', () => {
    expect(isShortMapLink('https://maps.app.goo.gl/AbC123')).toBe(true)
    expect(parseLocation('https://maps.app.goo.gl/AbC123')).toBeNull()
  })

  it('formatea y arma enlaces', () => {
    const p = { lat: 19.4326018, lng: -99.1332049 }
    expect(formatLatLng(p)).toBe('19.432602, -99.133205')
    expect(mapLinks(p).google).toBe('https://www.google.com/maps/search/?api=1&query=19.4326018,-99.1332049')
  })
})
