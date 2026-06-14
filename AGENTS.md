# Bot de Gastos — Contexto para Agentes

## Descripción

Bot de Telegram personal para control de gastos. Un solo usuario (dueño) registra
gastos por texto o voz, con un saldo inicial que se descuenta automáticamente.

Stack: **Cloudflare Workers** (free plan) + **Turso** (SQLite serverless free).

---

## Stack técnico

| Componente       | Tecnología                               | Plan        |
|------------------|------------------------------------------|-------------|
| Runtime          | Cloudflare Workers (ES Module)           | Free        |
| Bot API          | Telegram Bot API (webhook, sin librería) | —           |
| Base de datos    | Turso (SQLite via HTTP API)              | Free (500MB)|
| Transcripción voz| ❌ Deshabilitado (sin API key)          | —           |
| Lenguaje         | TypeScript                               | —           |
| CLI              | wrangler v3                              | —           |

## Arquitectura

```
Usuario Telegram
       │
       ▼  POST /webhook  (update JSON)
Cloudflare Worker (bot-gastos.workers.dev)
       │
       ├── Telegram Bot API (sendMessage, getFile)
       ├── Turso HTTP API (/v2/pipeline)
        └── (voz deshabilitada)
```

- El worker responde **inmediatamente 200 OK**
- El procesamiento corre en background via `ctx.waitUntil()` para no exceder
  el límite de CPU del plan free (10ms/request)

## Estructura del proyecto

```
bot-gastos/
├── src/
│   ├── index.ts           # Entry point, webhook handler, lógica principal
│   ├── config.ts          # Interfaz Env (variables de entorno)
│   ├── db/
│   │   └── turso.ts       # Cliente HTTP para Turso (createDb)
│   └── utils/
│       └── parseo.ts      # parsearGasto(), formatearSaldo(), formatearFecha()
├── .dev.vars              # Secrets para desarrollo local
├── wrangler.jsonc         # Config de Cloudflare Workers
├── package.json
├── tsconfig.json
└── AGENTS.md              # Este archivo
```

## Variables de entorno (Env)

| Variable         | Descripción                              | Ejemplo                             |
|------------------|------------------------------------------|-------------------------------------|
| `BOT_TOKEN`      | Token del bot de Telegram                | `8777975409:AAF...`                |
| ~~`WHISPER_API_KEY`~~ | ~~API Key de OpenAI~~ (eliminada) | — |
| `TURSO_URL`      | URL base de la DB Turso                 | `https://xxx.turso.io`              |
| `TURSO_TOKEN`    | Token de autenticación de Turso          | `eyJhbGciOiJ...`                    |
| `TELEGRAM_ID`    | ID numérico del usuario autorizado       | `743634701`                         |

- `TELEGRAM_ID` se define como **var** en `wrangler.jsonc` (no es secreto)
- Las otras 3 se definen como **secrets** via `wrangler secret put`

## Base de datos (Turso)

### Esquema

```sql
CREATE TABLE IF NOT EXISTS transacciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('inicial', 'gasto', 'ingreso')),
  monto INTEGER NOT NULL,              -- en CLP, sin decimales
  concepto TEXT NOT NULL DEFAULT '',
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trans_user_mes
  ON transacciones(telegram_id, anio, mes);

CREATE TABLE IF NOT EXISTS user_config (
  telegram_id INTEGER NOT NULL,
  clave TEXT NOT NULL,
  valor TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (telegram_id, clave)
);
```

### Funciones DB disponibles

| Función              | Descripción                                      |
|----------------------|--------------------------------------------------|
| `init()`             | Crea tabla e índice si no existen                |
| `getSaldo(id)`       | Saldo actual del usuario                         |
| `addTransaccion(...)`| Inserta un movimiento                            |
| `getHistorial(id)`   | Transacciones (por mes si se pasa anio+mes)      |
| `getTotalesMes(id, anio, mes)` | Suma de ingresos y gastos de un mes    |
| `getTransaccionCount(id)` | Cantidad de transacciones                    |
| `reset(id)`          | Elimina todas las transacciones del usuario      |
| `setPresupuesto(id, anio, mes, monto)` | Fija presupuesto mensual          |
| `getPresupuesto(id, anio, mes)` | Obtiene presupuesto del mes (o null)       |
| `deleteLastTransaccion(id)` | Borra y retorna la última transacción        |
| `getAllTransacciones(id)` | Todas las transacciones para exportar           |

### API de Turso

Se usa la HTTP API en `/v2/pipeline`. Formato de respuesta:

```json
{
  "results": [{
    "type": "ok",
    "response": {
      "type": "execute",
      "result": {
        "cols": [{"name": "saldo", "decltype": "integer"}],
        "rows": [[{"type": "integer", "value": "595000"}]]
      }
    }
  }]
}
```

**⚠️ Tanto los argumentos como las celdas usan objetos `{type, value}`.**

- **Input (args)**: `serializeArg()` en `turso.ts` convierte:
  - `number` → `{type: "integer", value: "42"}`
  - `string` → `{type: "text", value: "foo"}`
  - `null` → `{type: "null"}`

- **Output (rows)**: `extractValue()` en `turso.ts` convierte de vuelta:
  - `{type: "integer", value: "42"}` → `42`
  - `{type: "text", value: "foo"}` → `"foo"`
  - `{type: "null"}` → `null`
  - `{type: "float", value: "1.5"}` → `1.5`

## Endpoints del worker

| Ruta       | Método | Descripción                         |
|------------|--------|-------------------------------------|
| `/`        | GET    | Health check (responde "OK")        |
| `/webhook` | POST   | Webhook de Telegram                 |
| cualquier  | GET    | Responde "OK" (para debug)          |

## Comandos del bot

| Entrada                              | Acción                                           |
|--------------------------------------|--------------------------------------------------|
| `/iniciar 600000`                    | Registra saldo inicial (solo una vez)             |
| `gasté 5000 en almuerzo`             | Registra gasto (texto libre)                      |
| `ingresé 50000` o `recibí 50000`     | Registra ingreso (texto libre)                    |
| `/ingreso 50000 sueldo`              | Registra ingreso vía comando                      |
| `/saldo`                             | Muestra saldo actual                              |
| `/historial`                         | Transacciones del mes actual + resumen             |
| `/historial 2026 6`                  | Transacciones de Junio 2026 + resumen             |
| `-5000 almuerzo`                     | Atajo para gasto (texto libre)                    |
| `/presupuesto`                       | Muestra presupuesto del mes actual                |
| `/presupuesto 500000`                | Fija presupuesto mensual                          |
| `/presupuesto 0`                     | Elimina el presupuesto del mes                    |
| `/deshacer`                          | Borra la última transacción                       |
| `/exportar`                          | Descarga CSV con todas las transacciones          |
| `/reset`                             | Borra todo el historial                           |

### Historial por mes

`/historial` sin parámetros muestra el **mes actual**. Al pie se agrega un resumen:
```
📊 Resumen 6/2026:
🟢 Ingresos: $50.000
🔴 Gastos: $5.000
━━━━━━━━━━━━━
💰 Balance: +$45.000
```

Para ver otro mes: `/historial 2026 5`

### Parseo de texto (`parsearGasto`)

Elimina puntos del texto, busca el primer grupo de dígitos como monto.
Todo lo que sigue después del número (quitando "$", "en" o "de" al inicio)
se toma como concepto.

- `"gasté 5000 en almuerzo"` → `{monto: 5000, concepto: "almuerzo"}`
- `"15000"` → `{monto: 15000, concepto: "sin concepto"}`
- `"$ 15.000 en pizza"` → `{monto: 15000, concepto: "pizza"}`
- `"600000"` → `{monto: 600000, concepto: "sin concepto"}` ✅
- `"600.000"` → `{monto: 600000, concepto: "sin concepto"}` ✅

Maneja puntos como separador de miles (formato chileno).

## Mensajes de voz

Actualmente deshabilitados. El bot responde:
*"🎤 Voz no disponible. Escribe el gasto como texto..."*


## Despliegue

```bash
# Local
npx wrangler dev

# Secrets (solo la primera vez)
npx wrangler secret put BOT_TOKEN
# (sin WHISPER_API_KEY)
npx wrangler secret put TURSO_URL
npx wrangler secret put TURSO_TOKEN

# Deploy
npx wrangler deploy
```

## Limitaciones conocidas

- **Plan free Workers**: CPU limit de 10ms por request.
  Por eso todo el procesamiento pesado va en `waitUntil()`.
  Si el CPU se excede, aparece error `1101`.
- **Cold start**: La primera request después de inactividad puede tardar ~1-2s
  (tiempo de arranque del Worker).
- **Voz**: Deshabilitada. Para activarla se necesita API key de Google STT o Whisper.
- **Webhook**: La URL debe ser `/webhook`. Configurada con BotFather.

## Posibles mejoras futuras

- [ ] Dashboard web con estadísticas (Firebase Hosting + Firestore compartida)
- [ ] Categorías de gastos (comida, transporte, etc.)
- [ ] Exportar datos a CSV
- [ ] Recordatorios periódicos
- [ ] Múltiples usuarios con saldos independientes
- [ ] Migrar a Cloudflare Workers paid plan (más CPU, D1 nativa)
