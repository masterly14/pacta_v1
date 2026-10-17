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
- Correo: Resend
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
cp .env.example .env.local   # o: vercel env pull .env.local
npm run dev
```

Comandos útiles:

```bash
npm run lint
npm run build
npx prisma generate   # también corre solo en postinstall
```

Las variables de entorno están listadas en `.env.example`. Nunca hagas commit de `.env*`
(salvo `.env.example`).

## Estado

Infraestructura inicial. Aún no hay esquema de base de datos, reglas de negocio ni agentes:
los webhooks responden `501` hasta implementarse.
