import type { Context } from 'grammy'
import type { Env } from '../config'
import type { Db } from '../db/turso'
import { formatearSaldo, formatearFecha } from '../utils/parseo'

export async function cmdIniciar(ctx: Context, env: Env, db: Db) {
  const texto = ctx.message?.text ?? ''

  const match = texto.match(/(\d{1,3}(?:\.\d{3})*|\d+)/)
  if (!match) {
    await ctx.reply('Usa: /iniciar 600000')
    return
  }

  const monto = parseInt(match[1].replace(/\./g, ''), 10)
  if (isNaN(monto) || monto <= 0) {
    await ctx.reply('Monto inválido. Usa: /iniciar 600000')
    return
  }

  const count = await db.getTransaccionCount(ctx.from!.id)
  if (count > 0) {
    await ctx.reply('Ya tienes un saldo inicial. Usa /reset si quieres empezar de cero.')
    return
  }

  await db.addTransaccion(ctx.from!.id, 'inicial', monto, 'Saldo inicial')
  await ctx.reply(`✅ Saldo inicial de ${formatearSaldo(monto)} CLP registrado.`)
}

export async function cmdSaldo(ctx: Context, _env: Env, db: Db) {
  const saldo = await db.getSaldo(ctx.from!.id)
  await ctx.reply(`💰 Saldo actual: ${formatearSaldo(saldo)} CLP`)
}

export async function cmdHistorial(ctx: Context, _env: Env, db: Db) {
  const texto = ctx.message?.text ?? ''
  const partes = texto.split(/\s+/)
  const anio = partes[1] ? parseInt(partes[1], 10) : undefined
  const mes = partes[2] ? parseInt(partes[2], 10) : undefined

  const rows = await db.getHistorial(ctx.from!.id, anio, mes)

  if (rows.length === 0) {
    await ctx.reply('📭 No hay transacciones' + (anio ? ` en ${mes}/${anio}` : '') + '.')
    return
  }

  const lineas = rows.map((r: unknown[]) => {
    const tipo = r[1] as string
    const monto = r[2] as number
    const concepto = r[3] as string
    const fecha = formatearFecha(r[4] as string)
    const icono = tipo === 'inicial' ? '🟢' : tipo === 'gasto' ? '🔴' : '🟢'
    const signo = tipo === 'gasto' ? '-' : '+'
    return `${icono} ${fecha} | ${signo}${formatearSaldo(monto)} | ${concepto}`
  })

  const titulo = anio
    ? `📋 Transacciones de ${mes}/${anio}:\n\n`
    : '📋 Últimas transacciones:\n\n'

  await ctx.reply(titulo + lineas.join('\n'))
}

export async function cmdReset(ctx: Context, _env: Env, db: Db) {
  await db.reset(ctx.from!.id)
  await ctx.reply('🔄 Historial eliminado. Usa /iniciar para configurar un nuevo saldo.')
}
