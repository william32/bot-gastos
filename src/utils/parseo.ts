interface GastoParseado {
  monto: number
  concepto: string
  texto_original: string
}

export function parsearGasto(texto: string): GastoParseado | null {
  const sinPuntos = texto.replace(/\./g, '')

  const digitosMatch = sinPuntos.match(/\d+/)
  if (!digitosMatch) return null

  const monto = parseInt(digitosMatch[0], 10)
  if (isNaN(monto) || monto <= 0) return null

  const despuesNumero = sinPuntos.slice(digitosMatch.index! + digitosMatch[0].length).trim()
  const concepto = despuesNumero
    .replace(/^[$\s]+/, '')
    .replace(/^en\s+/i, '')
    .replace(/^de\s+/i, '')
    .trim() || 'sin concepto'

  return { monto, concepto, texto_original: texto }
}

export function formatearSaldo(monto: number): string {
  return '$' + monto.toLocaleString('es-CL')
}

export function formatearFecha(fechaStr: string): string {
  try {
    const d = new Date(fechaStr + 'Z')
    return d.toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return fechaStr
  }
}
