// CSV según RFC 4180: comillas dobles, comillas escapadas ("") y saltos de línea dentro de un campo.
// Acepta coma, punto y coma o tabulador como separador (se detecta en la primera línea).

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.slice(0, src.search(/\r?\n/) >>> 0)
  const sep = [',', ';', '\t'].reduce((best, s) => (count(firstLine, s) > count(firstLine, best) ? s : best), ',')

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === sep) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // Sin filas vacías (líneas en blanco al final, por ejemplo)
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

function count(line: string, sep: string): number {
  return line.split(sep).length - 1
}

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) || v !== v.trim() ? `"${v.replace(/"/g, '""')}"` : v)
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
