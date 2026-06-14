# Bot de Gastos Telegram

Bot personal para control de gastos vía Telegram. Un saldo inicial que se descuenta automáticamente con cada gasto, con historial por mes y soporte para ingresos.

**Stack:** Cloudflare Workers (free) + Turso (SQLite serverless free)

---

## Requisitos

- Node.js 20+
- Cuenta en [Cloudflare](https://dash.cloudflare.com)
- Cuenta en [Turso](https://turso.tech)
- Bot de Telegram (creado con [@BotFather](https://t.me/BotFather))

## Configuración local

```bash
# Clonar
git clone https://github.com/william32/bot-gastos.git
cd bot-gastos

# Instalar dependencias
npm install

# Copiar plantilla de variables de entorno
cp .dev.vars.example .dev.vars
```

Edita `.dev.vars` con tus credenciales:

| Variable | Descripción | Cómo obtenerla |
|---|---|---|
| `BOT_TOKEN` | Token del bot de Telegram | @BotFather → `/newbot` |
| `TURSO_URL` | URL de la base de datos Turso | `turso db show bot-gastos` |
| `TURSO_TOKEN` | Token de autenticación Turso | `turso db tokens create bot-gastos` |
| `TELEGRAM_ID` | Tu ID de usuario Telegram | @userinfobot |

## Ejecutar localmente

```bash
npm run dev
```

Esto inicia el servidor en `http://localhost:8787`. Para simular un mensaje:

```bash
curl -X POST http://localhost:8787/webhook \
  -H "Content-Type: application/json" \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":TU_TELEGRAM_ID},"chat":{"id":TU_TELEGRAM_ID,"type":"private"},"date":1700000000,"text":"/iniciar 600000"}}'
```

## Desplegar en Cloudflare

```bash
# Configurar secrets (solo la primera vez)
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TURSO_URL
npx wrangler secret put TURSO_TOKEN

# Editar TELEGRAM_ID en wrangler.jsonc con tu ID

# Desplegar
npm run deploy
```

Luego configura el webhook:

```
https://api.telegram.org/bot<TU_TOKEN>/setWebhook?url=https://tu-worker.workers.dev/webhook
```

## Comandos

| Entrada | Acción |
|---|---|
| `/iniciar 600000` | Registrar saldo inicial |
| `/saldo` | Ver saldo actual |
| `/ingreso 50000 sueldo` | Registrar ingreso |
| `gasté 5000 en almuerzo` | Registrar gasto (texto libre) |
| `ingresé 50000 sueldo` | Registrar ingreso (texto libre) |
| `/historial` | Transacciones del mes actual + resumen |
| `/historial 2026 5` | Transacciones de un mes específico |
| `/reset` | Borrar todo el historial |

## Estructura

```
src/
├── index.ts       # Lógica del bot y webhook
├── config.ts      # Interfaces de entorno
├── db/turso.ts    # Cliente HTTP para Turso
└── utils/parseo.ts # Parseo de montos y formato
```

## Base de datos (Turso)

```sql
CREATE TABLE transacciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('inicial', 'gasto', 'ingreso')),
  monto INTEGER NOT NULL,
  concepto TEXT NOT NULL DEFAULT '',
  anio INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  fecha TEXT NOT NULL DEFAULT (datetime('now'))
);
```
