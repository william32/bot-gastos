import type { Env } from '../config'

interface TursoCell {
  type: string
  value?: string
}

interface TursoResponse {
  results: Array<{
    type: string
    response: {
      type: string
      result: {
        cols: Array<{ name: string; decltype: string | null }>
        rows: TursoCell[][]
        affected_row_count: number
        last_insert_rowid: string | null
      }
    }
  }>
  baton: string | null
  base_url: string | null
}

function extractValue(cell: TursoCell): unknown {
  if (cell.type === 'null') return null
  if (cell.type === 'integer') return Number(cell.value)
  if (cell.type === 'text') return cell.value ?? ''
  if (cell.type === 'float') return Number(cell.value)
  return cell.value ?? null
}

function serializeArg(arg: unknown): Record<string, string> {
  if (arg === null || arg === undefined) return { type: 'null' }
  if (typeof arg === 'number') return { type: 'integer', value: String(arg) }
  if (typeof arg === 'string') return { type: 'text', value: arg }
  return { type: 'text', value: String(arg) }
}

export function createDb(env: Env) {
  async function exec(sql: string, args: unknown[] = []) {
    const url = env.TURSO_URL.replace(/\/$/, '') + '/v2/pipeline'
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.TURSO_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{ type: 'execute', stmt: { sql, args: args.map(serializeArg) } }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Turso error (${res.status}): ${text}`)
    }

    const data = (await res.json()) as TursoResponse
    const result = data.results?.[0]?.response?.result
    if (!result) return null

    return {
      rows: result.rows.map((row) => row.map(extractValue)),
      lastInsertRowid: result.last_insert_rowid,
      affectedRowCount: result.affected_row_count,
    }
  }

  async function init() {
    await exec(`CREATE TABLE IF NOT EXISTS transacciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('inicial', 'gasto', 'ingreso')),
      monto INTEGER NOT NULL,
      concepto TEXT NOT NULL DEFAULT '',
      anio INTEGER NOT NULL,
      mes INTEGER NOT NULL,
      fecha TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    await exec(
      `CREATE INDEX IF NOT EXISTS idx_trans_user_mes ON transacciones(telegram_id, anio, mes)`
    )
    await exec(`CREATE TABLE IF NOT EXISTS user_config (
      telegram_id INTEGER NOT NULL,
      clave TEXT NOT NULL,
      valor TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (telegram_id, clave)
    )`)
  }

  async function getSaldo(telegramId: number): Promise<number> {
    const res = await exec(
      `SELECT COALESCE(SUM(
        CASE WHEN tipo IN ('inicial', 'ingreso') THEN monto ELSE -monto END
      ), 0) AS saldo FROM transacciones WHERE telegram_id = ?`,
      [telegramId]
    )
    return (res?.rows?.[0]?.[0] as number) ?? 0
  }

  async function addTransaccion(
    telegramId: number,
    tipo: 'inicial' | 'gasto' | 'ingreso',
    monto: number,
    concepto: string
  ) {
    const now = new Date()
    await exec(
      `INSERT INTO transacciones (telegram_id, tipo, monto, concepto, anio, mes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [telegramId, tipo, monto, concepto, now.getFullYear(), now.getMonth() + 1]
    )
  }

  async function getHistorial(
    telegramId: number,
    anio?: number,
    mes?: number,
    limit = 100
  ): Promise<unknown[][]> {
    if (anio && mes) {
      const res = await exec(
        `SELECT id, tipo, monto, concepto, fecha FROM transacciones
         WHERE telegram_id = ? AND anio = ? AND mes = ?
         ORDER BY fecha DESC`,
        [telegramId, anio, mes]
      )
      return res?.rows ?? []
    }
    const res = await exec(
      `SELECT id, tipo, monto, concepto, fecha FROM transacciones
       WHERE telegram_id = ? ORDER BY fecha DESC LIMIT ?`,
      [telegramId, limit]
    )
    return res?.rows ?? []
  }

  async function getTotalesMes(
    telegramId: number,
    anio: number,
    mes: number
  ): Promise<{ totalIngresos: number; totalGastos: number }> {
    const res = await exec(
      `SELECT
        COALESCE(SUM(CASE WHEN tipo IN ('inicial', 'ingreso') THEN monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN tipo = 'gasto' THEN monto ELSE 0 END), 0) AS gastos
       FROM transacciones WHERE telegram_id = ? AND anio = ? AND mes = ?`,
      [telegramId, anio, mes]
    )
    return {
      totalIngresos: (res?.rows?.[0]?.[0] as number) ?? 0,
      totalGastos: (res?.rows?.[0]?.[1] as number) ?? 0,
    }
  }

  async function getTransaccionCount(telegramId: number): Promise<number> {
    const res = await exec(
      `SELECT COUNT(*) AS cnt FROM transacciones WHERE telegram_id = ?`,
      [telegramId]
    )
    return (res?.rows?.[0]?.[0] as number) ?? 0
  }

  async function reset(telegramId: number) {
    await exec(`DELETE FROM transacciones WHERE telegram_id = ?`, [telegramId])
  }

  async function setPresupuesto(telegramId: number, anio: number, mes: number, monto: number) {
    const clave = `presupuesto_${anio}_${mes}`
    await exec(
      `INSERT OR REPLACE INTO user_config (telegram_id, clave, valor) VALUES (?, ?, ?)`,
      [telegramId, clave, String(monto)]
    )
  }

  async function getPresupuesto(telegramId: number, anio: number, mes: number): Promise<number | null> {
    const clave = `presupuesto_${anio}_${mes}`
    const res = await exec(
      `SELECT valor FROM user_config WHERE telegram_id = ? AND clave = ?`,
      [telegramId, clave]
    )
    const val = res?.rows?.[0]?.[0] as string | undefined
    return val ? parseInt(val, 10) : null
  }

  async function deleteLastTransaccion(telegramId: number): Promise<{ monto: number; concepto: string; tipo: string } | null> {
    const res = await exec(
      `SELECT id, tipo, monto, concepto FROM transacciones
       WHERE telegram_id = ? ORDER BY id DESC LIMIT 1`,
      [telegramId]
    )
    if (!res?.rows?.length) return null
    const row = res.rows[0]
    await exec(`DELETE FROM transacciones WHERE id = ? AND telegram_id = ?`, [row[0], telegramId])
    return { monto: row[2] as number, concepto: row[3] as string, tipo: row[1] as string }
  }

  async function getAllTransacciones(telegramId: number): Promise<unknown[][]> {
    const res = await exec(
      `SELECT id, tipo, monto, concepto, anio, mes, fecha FROM transacciones
       WHERE telegram_id = ? ORDER BY id ASC`,
      [telegramId]
    )
    return res?.rows ?? []
  }

  return {
    init, getSaldo, addTransaccion, getHistorial, getTransaccionCount,
    getTotalesMes, reset, setPresupuesto, getPresupuesto,
    deleteLastTransaccion, getAllTransacciones,
  }
}

export type Db = ReturnType<typeof createDb>
