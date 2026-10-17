# Pacta

Agente de IA que recibe facturas por correo (Resend), Slack y WhatsApp y decide si
**pagarlas**, **frenarlas** o **escalarlas** a una persona según las reglas de la empresa.

> Proyecto de hackathon. **No mueve dinero real.**

## Stack

- Next.js (App Router, TypeScript estricto, Tailwind, ESLint) con npm
- UI: shadcn/ui y AI Elements (Vercel)
- Auth: Clerk
- Base de datos: Prisma 6 + Neon Postgres (adapter de Neon)
- Validación: zod (contratos en `src/contracts`)
- Modelos: DeepSeek (`@ai-sdk/deepseek`, cliente en `src/lib/ai.ts`)
- Agentes: AI SDK 7 (`ai`), `@ai-sdk/workflow`, Vercel Workflow (`workflow`), Chat SDK (`chat`) con adapters de Slack y WhatsApp
- Correo: Gmail vía Composio (OAuth2 por organización; varios buzones). Resend queda como stub.
- Observabilidad: Langfuse + OpenTelemetry (`@vercel/otel`)

## Estructura

```
src/
  app/                  rutas (App Router) y /api/webhooks/{resend,slack,whatsapp}
  agents/               agentes de IA
  workflows/            workflows duraderos ("use workflow" / "use step")
  rules/                reglas duras en TypeScript puro
  contracts/            esquemas zod: Invoice, Policy, Decision, Approval
  lib/                  db (Prisma), langfuse, resend
  components/           UI (shadcn en ui/, AI Elements en ai-elements/)
prisma/schema.prisma    esquema de base de datos
```

`src/proxy.ts` protege todas las rutas con Clerk excepto `/` y `/api/webhooks/*`.

## Desarrollo

```bash
npm install
npm run dev
```

Comandos útiles:

```bash
npm run lint
npm run build
npx prisma generate   # también corre solo en postinstall
```

Las variables de entorno compartidas están en `.env` (versionado). `.env.example`
documenta las claves. `.env.local` sigue ignorado para overrides personales.

Gmail / Composio (solo servidor):

- `COMPOSIO_API_KEY`
- `COMPOSIO_AUTH_CONFIG_ID` — auth config `ac_…` de Gmail
- `COMPOSIO_WEBHOOK_SECRET` — secret V3; no regenerar en cada deploy
- `APP_URL` — origen HTTPS (callback y webhook)
- Cloudflare R2 (bucket Monark `monark-media`): `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_PUBLIC_BASE_URL`, `R2_PREFIX`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Las capturas se guardan juntas en `pacta/invoices/...` y quedan con URL pública `https://pub-93e729bb52a7484eb99df64ce8ba41bf.r2.dev/...`. Las API tokens S3 se crean en Cloudflare → R2 → Manage R2 API tokens.

Registro único del webhook del proyecto:

```bash
npm run composio:register-webhook
```

Copia el secret impreso a `COMPOSIO_WEBHOOK_SECRET`. El trigger `GMAIL_NEW_GMAIL_MESSAGE` se crea por buzón al completar OAuth.

## Estado

Infraestructura inicial. Aún no hay esquema de base de datos, reglas de negocio ni agentes:
los webhooks responden `501` hasta implementarse.
