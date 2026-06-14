import type { Env } from './config'
import { createDb } from './db/turso'
import { parsearGasto, formatearSaldo, formatearFecha } from './utils/parseo'

let dbInit: Promise<void> | null = null

interface TelegramUpdate {
  message?: {
    message_id: number
    from?: { id: number; first_name?: string }
    chat?: { id: number; type: string }
    text?: string
    voice?: { file_id: string; duration: number }
    date: number
  }
}

async function sendMessage(token: string, chatId: number, text: string): Promise<{ message_id?: number }> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    }
  )
  const data = await res.json() as { ok: boolean; result?: { message_id: number } }
  return { message_id: data.result?.message_id }
}

async function procesarMensaje(update: TelegramUpdate, env: Env) {
  try {
    const msg = update.message
    if (!msg || !msg.from || String(msg.from.id) !== env.TELEGRAM_ID) return

    const chatId = msg.chat?.id ?? msg.from.id
    const token = env.BOT_TOKEN
    const db = createDb(env)

    try {
      if (!dbInit) {
        dbInit = db.init()
      }
      await dbInit
    } catch (err) {
      dbInit = null
      const errMsg = err instanceof Error ? err.message : 'Error de DB'
      await sendMessage(token, chatId, `❌ Error de base de datos: ${errMsg}`)
      return
    }

  const count = await db.getTransaccionCount(msg.from.id)
  const text = msg.text?.trim() ?? ''

  if (text.startsWith('/iniciar')) {
    if (count > 0) {
      await sendMessage(token, chatId, 'Ya tienes un saldo inicial. Usa /reset si quieres empezar de cero.')
      return
    }
    const montoStr = text.replace(/\./g, '').match(/\d+/)
    if (!montoStr) {
      await sendMessage(token, chatId, 'Usa: /iniciar 600000')
      return
    }
    const monto = parseInt(montoStr[0], 10)
    if (isNaN(monto) || monto <= 0) {
      await sendMessage(token, chatId, 'Monto inválido.')
      return
    }
    await db.addTransaccion(msg.from.id, 'inicial', monto, 'Saldo inicial')
    await sendMessage(token, chatId, `✅ Saldo inicial de ${formatearSaldo(monto)} CLP registrado.`)
    return
  }

  if (text.startsWith('/saldo')) {
    const saldo = await db.getSaldo(msg.from.id)
    await sendMessage(token, chatId, `💰 Saldo actual: ${formatearSaldo(saldo)} CLP`)
    return
  }

  if (text.startsWith('/ingreso')) {
    const montoStr = text.replace(/\./g, '').match(/\d+/)
    if (!montoStr) {
      await sendMessage(token, chatId, 'Usa: /ingreso 50000')
      return
    }
    const monto = parseInt(montoStr[0], 10)
    if (isNaN(monto) || monto <= 0) {
      await sendMessage(token, chatId, 'Monto inválido.')
      return
    }
    const despues = text.slice(text.indexOf(montoStr[0]) + montoStr[0].length).trim()
    const concepto = despues.replace(/^en\s+/i, '').trim() || 'sin concepto'
    await db.addTransaccion(msg.from.id, 'ingreso', monto, concepto)
    const saldo = await db.getSaldo(msg.from.id)
    await sendMessage(token, chatId, `🟢 Ingresaste ${formatearSaldo(monto)} CLP${despues ? ` en ${concepto}` : ''}.\n💰 Saldo actual: ${formatearSaldo(saldo)} CLP`)
    return
  }

  if (text.startsWith('/historial')) {
    const ahora = new Date()
    const partes = text.split(/\s+/)
    const anio = partes[1] ? parseInt(partes[1], 10) : ahora.getFullYear()
    const mes = partes[2] ? parseInt(partes[2], 10) : ahora.getMonth() + 1

    const rows = await db.getHistorial(msg.from.id, anio, mes)

    if (rows.length === 0) {
      await sendMessage(token, chatId, `📭 No hay transacciones en ${mes}/${anio}.`)
      return
    }

    const lineas = rows.map((r: unknown[]) => {
      const tipo = r[1] as string
      const monto = r[2] as number
      const concepto = r[3] as string
      const fecha = formatearFecha(r[4] as string)
      const icono = tipo === 'gasto' ? '🔴' : '🟢'
      const signo = tipo === 'gasto' ? '- ' : '+ '
      return `${icono} ${fecha} | ${signo}${formatearSaldo(monto)} | ${concepto}`
    })

    const totales = await db.getTotalesMes(msg.from.id, anio, mes)
    const diferencia = totales.totalIngresos - totales.totalGastos
    const signoDiferencia = diferencia >= 0 ? '+' : ''

    const resumen = `\n\n📊 Resumen ${mes}/${anio}:\n` +
      `🟢 Ingresos: ${formatearSaldo(totales.totalIngresos)}\n` +
      `🔴 Gastos: ${formatearSaldo(totales.totalGastos)}\n` +
      `━━━━━━━━━━━━━\n` +
      `💰 Balance: ${signoDiferencia}${formatearSaldo(diferencia)}`

    await sendMessage(token, chatId,
      `📋 Transacciones de ${mes}/${anio}:\n\n` +
      lineas.join('\n') +
      resumen
    )
    return
  }

  if (text.startsWith('/reset')) {
    await db.reset(msg.from.id)
    dbInit = null
    await sendMessage(token, chatId, '🔄 Historial eliminado. Usa /iniciar para configurar un nuevo saldo.')
    return
  }

  if (msg.voice) {
    await sendMessage(token, chatId, '🎤 Voz no disponible. Escribe el gasto como texto, ej: "gasté 5000 en almuerzo"')
    return
  }

  if (text && count === 0) {
    await sendMessage(token, chatId, 'Primero configura tu saldo inicial con /iniciar 600000')
    return
  }

  if (text) {
    const esIngreso = /^(ingres[éeí]|recib[ií]|deposit[aá]ron|abonaron|ingreso)\b/i.test(text)
    const parseado = parsearGasto(text)
    if (!parseado) {
      await sendMessage(token, chatId, 'No entendí. Escribe algo como:\n"gasté 5000 en almuerzo"\n"ingresé 50000"\n"5000 almuerzo"\nO consulta /saldo, /historial')
      return
    }

    const tipo = esIngreso ? 'ingreso' : 'gasto'
    await db.addTransaccion(msg.from.id, tipo, parseado.monto, parseado.concepto)
    const saldo = await db.getSaldo(msg.from.id)
    const advertencia = saldo < 0 ? '\n⚠️ ¡Estás en negativo!' : ''

    if (esIngreso) {
      await sendMessage(token, chatId, `🟢 Ingresaste ${formatearSaldo(parseado.monto)} CLP en ${parseado.concepto}.\n💰 Saldo actual: ${formatearSaldo(saldo)} CLP${advertencia}`)
    } else {
      await sendMessage(token, chatId, `🔴 Gastaste ${formatearSaldo(parseado.monto)} CLP en ${parseado.concepto}.\n💰 Te quedan ${formatearSaldo(saldo)} CLP${advertencia}`)
    }
  }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Error desconocido'
    try {
      const chatId = update.message?.from?.id
      if (chatId) {
        await sendMessage(env.BOT_TOKEN, chatId, `❌ Error interno: ${errMsg}`)
      }
    } catch {
      // ignore errors from error reporting
    }
  }
}

export default {
  async fetch(req: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname !== '/webhook' || req.method !== 'POST') {
      return new Response('OK', { status: 200 })
    }

    try {
      const update = (await req.json()) as TelegramUpdate
      executionCtx.waitUntil(procesarMensaje(update, env))
    } catch {
      // ignore parse errors
    }

    return new Response('OK', { status: 200 })
  },
}
