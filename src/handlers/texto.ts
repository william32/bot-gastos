import type { Context } from 'grammy'
import type { Env } from '../config'
import type { Db } from '../db/turso'
import { parsearGasto, formatearSaldo } from '../utils/parseo'

export async function manejarTexto(ctx: Context, _env: Env, db: Db) {
  const texto = ctx.message?.text ?? ''

  const count = await db.getTransaccionCount(ctx.from!.id)
  if (count === 0) {
    await ctx.reply('Primero configura tu saldo inicial con /iniciar 600000')
    return
  }

  const parseado = parsearGasto(texto)
  if (!parseado) {
    await ctx.reply(
      'No entendí. Escribe algo como:\n' +
        '"gasté 5000 en almuerzo"\n' +
        '"5000 almuerzo"\n' +
        'O consulta /saldo, /historial'
    )
    return
  }

  await db.addTransaccion(ctx.from!.id, 'gasto', parseado.monto, parseado.concepto)
  const saldo = await db.getSaldo(ctx.from!.id)

  const advertencia = saldo < 0 ? '\n⚠️ ¡Estás en negativo!' : ''
  await ctx.reply(
    `✅ Gastaste ${formatearSaldo(parseado.monto)} CLP en ${parseado.concepto}.` +
      `\n💰 Te quedan ${formatearSaldo(saldo)} CLP${advertencia}`
  )
}
