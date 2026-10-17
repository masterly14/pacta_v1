# Plan A — Invoice Intelligence

> **Owner:** Desarrollador A (masterly14) · **Contratos:** Brayan (traspaso acordado el 2026-10-17)
> **Referencias:** [`PLAN.md`](../../PLAN.md) §5, §6.1, §9, §13 · [`CLAUDE.md`](../../CLAUDE.md)
> **Produce:** `InvoiceContext` (`src/shared/schemas/invoice-context.ts`), incluido `contractMatch`.

**Resultado independiente (norte):** enviar una factura al correo y verla procesada en el dashboard, con sus datos estructurados, evidencia y comparación contractual.

**Seguimiento en GitHub:** issues con etiqueta [`vertical-a`](https://github.com/masterly14/pacta_v1/issues?q=label%3Avertical-a). Cada tarea lleva su id (`A-xx`) y su issue; un PR cierra el suyo con `Closes #N`. Al terminar una tarea, marcar `[x]` y anotar en §6 qué se verificó (tests, lint, build). No marcar como hecho algo que no se ejecutó.

## 1. Orden de trabajo (una rama corta por funcionalidad)

### Hecho

- [x] Base de usuarios y organizaciones con Clerk: migración `init_users_and_organizations`, roles de membresía ([#11](https://github.com/masterly14/pacta_v1/issues/11)).
- [x] **`feature/gmail-composio`**: recepción por Gmail vía Composio, webhook `POST /api/webhooks/composio` con idempotencia por `composio_event_id` y `(gmail_connection_id, gmail_message_id)` ([#12](https://github.com/masterly14/pacta_v1/issues/12)).
- [x] Captura de cuerpo y adjuntos PDF/JPEG/PNG/WEBP (≤ 10 MB) con sha256 en R2 y tabla `documents`; reintento en `POST /api/gmail/inbound/[id]/retry` ([#13](https://github.com/masterly14/pacta_v1/issues/13)).
- [x] Autenticación en español y plataforma protegida `/platform/*` ([#14](https://github.com/masterly14/pacta_v1/issues/14)).
- [x] Parseo de historial CSV y recurrencias en `src/features/payment-history/` (carpeta de B; ver §5) ([#15](https://github.com/masterly14/pacta_v1/issues/15)).
- [x] **`feature/a-contracts`** (Brayan): tabla `contracts`, registro manual, `/dashboard/contracts`, `POST /api/contracts` y `matchContract()` → `ContractMatch` ([#22](https://github.com/masterly14/pacta_v1/issues/22), [#26](https://github.com/masterly14/pacta_v1/issues/26)).

Hoy la ingesta se detiene en `gmail_inbound_messages.processing_status = received` con documentos guardados. No existe la tabla `invoices` ni la extracción con IA.

### Recepción y procesamiento (masterly14)

- [ ] **A-01 · `feature/a-invoices-db`** ([#16](https://github.com/masterly14/pacta_v1/issues/16)): tabla `invoices` (proveedor nullable, nombre extraído, número, `amount_minor`, moneda, fechas, `document_id`, `gmail_inbound_message_id`, `source`, `extraction_status` `pending | processing | extracted | failed`, `extraction_error`, `context_json`) + una migración. `documents.gmail_inbound_message_id` nullable para la carga manual. FK de `invoice_id` en las tablas de B, coordinada.
- [ ] **A-02 · `feature/a-extraction`** ([#17](https://github.com/masterly14/pacta_v1/issues/17)): esquema Zod de salida del LLM, prompt que trate el documento como dato no confiable, conversión determinística a `InvoiceContext` (`amountMinor` sin floats reusando `contracts/money.ts`, `missingFields` calculado por código, evidencia solo si el fragmento existe en la fuente) y `InvoiceContextSchema.parse` como última barrera.
- [ ] **A-03 · `feature/a-pipeline`** ([#18](https://github.com/masterly14/pacta_v1/issues/18)): `received → processing → processed | failed`; crea `invoices`, extrae y llama a `buildInvoiceContext()`. Idempotente y con errores registrados sin datos sensibles.
- [ ] **A-04 · `feature/a-supplier-match`** ([#19](https://github.com/masterly14/pacta_v1/issues/19)): `buildInvoiceContext()`: proveedor normalizado contra `suppliers` (solo lectura) → `matched | ambiguous | not_found`, `findContractMatch()` y `beneficiaryAccountReference` enmascarada como `****1234`.
- [ ] **A-05 · `feature/a-manual-upload`** ([#20](https://github.com/masterly14/pacta_v1/issues/20)): `POST /api/invoices` (PDF, imagen o texto) con el mismo pipeline, `source = dashboard`.

### Contratos (Brayan)

- [ ] **A-06 · `feature/a-contracts-pdf`** ([#21](https://github.com/masterly14/pacta_v1/issues/21), si hay tiempo): subir PDF del contrato, el LLM propone términos y una persona los confirma antes de activarlo.

### Interfaz de facturas (masterly14)

- [ ] **A-08 · `feature/a-invoices-ui`** ([#23](https://github.com/masterly14/pacta_v1/issues/23)): inbox con recepción, proveedor, número, monto, estado de extracción, contrato y decisión de B (badge «simulado» mientras no exista).
- [ ] **A-09 · `feature/a-invoice-detail`** ([#24](https://github.com/masterly14/pacta_v1/issues/24)): detalle + `GET /api/invoices/[id]`: original por ruta autenticada, datos extraídos con evidencia, `missingFields`, advertencias, comparación contractual y decisión.
- [ ] **A-10 · `feature/a-processing-errors`** ([#25](https://github.com/masterly14/pacta_v1/issues/25)): estados `failed` visibles, reintento solo para la organización y correos ignorados listados aparte.

### Integración y calidad

- [ ] **A-12 · `feature/a-integration`** ([#27](https://github.com/masterly14/pacta_v1/issues/27)): al quedar `extracted`, llamar `evaluateInvoice(context)` una vez por evento lógico y mostrar la `PaymentDecision`. Depende de `feature/b-decisions`.
- [ ] **A-13** ([#28](https://github.com/masterly14/pacta_v1/issues/28)): ≥ 10 facturas ficticias (PDF, imagen, texto) con extracción esperada y casos trampa: sin datos esenciales, mismo PDF con otro nombre, mismo correo dos veces, prompt injection, salida malformada y fallo del LLM.
- [ ] **A-14** ([#29](https://github.com/masterly14/pacta_v1/issues/29)): Playwright correo/carga manual → inbox → detalle.
- [ ] **A-15** ([#30](https://github.com/masterly14/pacta_v1/issues/30), opcional): migrar los tests de `node --test` a Vitest.

## 2. Contratos

Un contrato es **evidencia** para comparar facturas y **nunca autoriza un pago**; eso solo lo hace `payment_authorizations` (B). En P0 se registran a mano; no hay documento asociado.

**Código:** `src/features/contracts/`

| Archivo | Rol |
|---|---|
| `match-contract.ts` | `matchContract(facts, contracts)`, pura: devuelve `ContractMatch \| null` validado con `ContractMatchSchema` |
| `server.ts` | lecturas/mutaciones acotadas por `organizationId`, auditadas en `audit_events`; `findContractMatch(orgId, facts)` |
| `schemas.ts` | `ContractInputSchema` (formulario y API) |
| `money.ts` | decimal escrito → unidades menores sin floats, según la escala ISO 4217; solo monedas de la lista `CURRENCY_SCALES` |
| `permissions.ts` | solo el rol `admin` registra o termina contratos |
| `actions.ts`, `components/contract-forms.tsx` | server actions y formularios de `/dashboard/contracts` |

### Reglas de comparación

| Situación | `contractMatch` |
|---|---|
| Proveedor no confirmado (`supplierId` null) | `null` (no se comparó) |
| El proveedor no tiene contratos activos | `not_found` |
| Factura sin `invoiceDate` | `ambiguous` |
| Más de un contrato vigente en `invoiceDate` | `ambiguous` |
| Ninguno vigente, pero hay activos | `mismatch` contra el más cercano, con discrepancia `period` |
| Exactamente uno vigente | se comparan los campos: `matched` sin discrepancias, `mismatch` con alguna |

- **Moneda** distinta: discrepancia `currency` (el monto no se compara).
- **Monto**: debe ser **exactamente** el acordado; un monto desconocido también es discrepancia. Sin tolerancia en P0.
- **Cuenta beneficiaria**: se compara solo si ambos lados tienen valor.
- **Frecuencia**: no se verifica (requiere historial de facturas); se copia en la salida.
- Los contratos terminados se ignoran. La evidencia es `sourceType: "manual_entry"` con un extracto de los términos.

El motor de B (`contract_consistent`) escala `mismatch` y `ambiguous` con `CONTRACT_MISMATCH`; `matched`, `not_found` y `null` no lo afectan.

### Datos

Tabla `contracts` (migración `20261017174628_add_contracts_table`): proveedor, estado `active | terminated`, monto acordado, moneda, frecuencia (incluye `one_time`), `valid_from`, `valid_to` (null = sin fin), cuenta enmascarada, descripción y autor. CHECK `contracts_terms_check`: monto > 0, moneda `^[A-Z]{3}$`, `valid_to >= valid_from`, y un contrato terminado tiene `terminated_at` y `terminated_by`. Un contrato no se edita ni se borra: se termina y se registra otro.

## 3. Decisiones acordadas

| Tema | Decisión |
|---|---|
| Registro de contratos | Formulario manual en P0; PDF + LLM con confirmación humana después |
| Quién registra | Rol `admin` de Clerk (los contratos no autorizan pagos, pero cambian la comparación) |
| Monedas | Lista cerrada con escala conocida (USD, EUR, GBP, MXN, COP, JPY, CLP…). Otra moneda se rechaza, nunca se supone su escala |
| Tolerancia de monto | Ninguna: cualquier diferencia escala. Revisar si molesta en suscripciones por uso |

## 4. Coordinación pendiente

- **Proveedores:** el formulario necesita proveedores existentes. Vienen de `/dashboard/policies` (`feature/b-policies`).
- **Formato de cuenta:** `buildInvoiceContext()` debe producir `beneficiaryAccountReference` en el mismo formato enmascarado que se registra (`****1234`); si no coincide, la comparación marca discrepancia.
- **Navegación:** falta un enlace a `/dashboard/contracts` en el layout global (compartido).
- **Proveedor de otra organización:** la FK `contracts.supplier_id` no garantiza que el proveedor sea de la misma organización; lo verifica `createContract()` en el servidor.

## 5. Decisiones abiertas de ingesta

| Id | Tema | Estado |
|---|---|---|
| D-1 ([#31](https://github.com/masterly14/pacta_v1/issues/31)) | **Resend vs Gmail/Composio.** El canal implementado es Gmail vía Composio; `POST /api/webhooks/resend` es un stub (501). Propuesta: Gmail como canal P0, carga manual como respaldo y retirar el stub. Requiere acuerdo (CLAUDE.md §2). | Pendiente |
| D-2 ([#32](https://github.com/masterly14/pacta_v1/issues/32)) | **Modelo para PDF/imagen.** `src/lib/ai.ts` usa DeepSeek, que no lee imágenes. Extraer texto del PDF antes del LLM y usar un modelo con visión para imágenes, o cambiar de proveedor. | Pendiente |
| D-3 ([#33](https://github.com/masterly14/pacta_v1/issues/33)) | **Varios adjuntos en un correo.** ¿Una factura por adjunto o una por correo? Define la unicidad de `invoices` (A-01). | Pendiente |
| D-4 ([#34](https://github.com/masterly14/pacta_v1/issues/34)) | **`documents.public_url`.** CLAUDE.md §7 exige almacenamiento privado; la UI debe usar `/api/gmail/documents/[id]` con control por organización. | Revisar en A-09 |
| D-5 ([#35](https://github.com/masterly14/pacta_v1/issues/35)) | **Rutas.** Contratos y políticas viven en `/dashboard/*`; la navegación apunta a `/platform/*` (páginas vacías). Elegir un prefijo y actualizar PLAN.md. | Pendiente |

- `src/features/payment-history/` (parseo CSV) es de B: B debe adoptarlo en `feature/b-payment-history`.

## 6. Registro

- 2026-10-17: masterly14 traspasa contratos a Brayan. Se entrega `feature/a-contracts`: registro manual, comparación pura y página. Migración aplicada en la BD de desarrollo de Neon.
- 2026-10-17: masterly14 entrega `feature/gmail-composio` (Gmail + R2) y la plataforma protegida. Se crean los issues #11–#35 (etiqueta `vertical-a`). Próximo: A-01 y decidir D-1/D-2.
