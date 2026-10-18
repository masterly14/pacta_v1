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
- [x] **`feature/a-contracts`** (Brayan): tabla `contracts`, registro manual, `/platform/contracts`, `POST /api/contracts` y `matchContract()` → `ContractMatch` ([#22](https://github.com/masterly14/pacta_v1/issues/22), [#26](https://github.com/masterly14/pacta_v1/issues/26)).

Hoy la ingesta se detiene en `gmail_inbound_messages.processing_status = received` con documentos guardados. No existe la tabla `invoices` ni la extracción con IA.

### Recepción y procesamiento (masterly14)

> **2026-10-17 · `feature/a-invoice-pipeline` (Brayan, a pedido de B, construido sobre #51):** A-01, A-03, A-04, A-05, A-08, A-09 y A-12 implementados. Tabla `invoices` (una por grupo `invoice_candidate`, migración `20261017212437_add_invoices`); `processInvoice()` (extracción → `resolveIdentity()` → `invoices` → `evaluateInvoice()`), llamado desde el webhook de Composio tras la descarga, desde el reintento y desde la carga manual en `/platform/invoices` (PDF, imagen o texto, sin guardar el archivo). Proveedor: solo coincidencia exacta (ignorando sufijos legales) confirma; similar (≥ 0.8, mismo criterio que payment-history) es `ambiguous`. Fallos de extracción quedan en la factura (reintento solo para correo); el correo pasa a `processed`. Original por ruta autenticada `GET /api/invoices/[id]/document` (no expone `public_url`). Verificado: 38 tests de integración (6 del pipeline), prueba real con IA en Chrome (aprobada, proveedor no reconocido, inyección → escala) y ninguna cuenta completa guardada. Pendiente: probar un correo real de Gmail extremo a extremo; A-10 (vista de errores/ignorados) e incluir la carga manual en `documents`.


- [x] **A-01 · `feature/a-invoices-db`** ([#16](https://github.com/masterly14/pacta_v1/issues/16)): tabla `invoices` (proveedor nullable, nombre extraído, número, `amount_minor`, moneda, fechas, `document_id`, `gmail_inbound_message_id`, `source`, `extraction_status` `pending | processing | extracted | failed`, `extraction_error`, `context_json`) + una migración. `documents.gmail_inbound_message_id` nullable para la carga manual. FK de `invoice_id` en las tablas de B, coordinada.
- [ ] **A-02 · `feature/a-extraction`** ([#17](https://github.com/masterly14/pacta_v1/issues/17)): esquema Zod de salida del LLM, prompt que trate el documento como dato no confiable, conversión determinística a `InvoiceContext` (`amountMinor` sin floats reusando `contracts/money.ts`, `missingFields` calculado por código, evidencia solo si el fragmento existe en la fuente) y `InvoiceContextSchema.parse` como última barrera.
- [x] **A-03 · `feature/a-pipeline`** ([#18](https://github.com/masterly14/pacta_v1/issues/18)): `received → processing → processed | failed`; crea `invoices`, extrae y llama a `buildInvoiceContext()`. Idempotente y con errores registrados sin datos sensibles.
- [x] **A-04 · `feature/a-supplier-match`** ([#19](https://github.com/masterly14/pacta_v1/issues/19)): `buildInvoiceContext()`: proveedor normalizado contra `suppliers` (solo lectura) → `matched | ambiguous | not_found`, `findContractMatch()` y `beneficiaryAccountReference` enmascarada como `****1234`.
- [x] **A-05 · `feature/a-manual-upload`** ([#20](https://github.com/masterly14/pacta_v1/issues/20)): `POST /api/invoices` (PDF, imagen o texto) con el mismo pipeline, `source = dashboard`.

### Contratos (Brayan)

- [ ] **A-06 · `feature/a-contracts-pdf`** ([#21](https://github.com/masterly14/pacta_v1/issues/21), si hay tiempo): subir PDF del contrato, el LLM propone términos y una persona los confirma antes de activarlo.

### Interfaz de facturas (masterly14)

- [x] **A-08 · `feature/a-invoices-ui`** ([#23](https://github.com/masterly14/pacta_v1/issues/23)): inbox con recepción, proveedor, número, monto, estado de extracción, contrato y decisión de B (badge «simulado» mientras no exista).
- [x] **A-09 · `feature/a-invoice-detail`** ([#24](https://github.com/masterly14/pacta_v1/issues/24)): detalle + `GET /api/invoices/[id]`: original por ruta autenticada, datos extraídos con evidencia, `missingFields`, advertencias, comparación contractual y decisión.
- [ ] **A-10 · `feature/a-processing-errors`** ([#25](https://github.com/masterly14/pacta_v1/issues/25)): estados `failed` visibles, reintento solo para la organización y correos ignorados listados aparte.

### Integración y calidad

- [x] **A-12 · `feature/a-integration`** ([#27](https://github.com/masterly14/pacta_v1/issues/27)): al quedar `extracted`, llamar `evaluateInvoice(context)` una vez por evento lógico y mostrar la `PaymentDecision`. Depende de `feature/b-decisions`.
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
| `actions.ts`, `components/contract-forms.tsx` | server actions y formularios de `/platform/contracts` |

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

- **Proveedores:** el formulario necesita proveedores existentes. Vienen de `/platform/policies` (`feature/b-policies`).
- **Formato de cuenta:** `buildInvoiceContext()` debe producir `beneficiaryAccountReference` en el mismo formato enmascarado que se registra (`****1234`); si no coincide, la comparación marca discrepancia.
- **Navegación:** resuelto; `/platform/contracts` está en el menú lateral de la plataforma.
- **Proveedor de otra organización:** la FK `contracts.supplier_id` no garantiza que el proveedor sea de la misma organización; lo verifica `createContract()` en el servidor.

## 5. Decisiones abiertas de ingesta

| Id | Tema | Estado |
|---|---|---|
| D-1 ([#31](https://github.com/masterly14/pacta_v1/issues/31)) | **Resend vs Gmail/Composio.** El canal implementado es Gmail vía Composio; `POST /api/webhooks/resend` es un stub (501). Propuesta: Gmail como canal P0, carga manual como respaldo y retirar el stub. Requiere acuerdo (CLAUDE.md §2). | Pendiente |
| D-2 ([#32](https://github.com/masterly14/pacta_v1/issues/32)) | **Modelo para PDF/imagen.** `src/lib/ai.ts` usa DeepSeek, que no lee imágenes. Extraer texto del PDF antes del LLM y usar un modelo con visión para imágenes, o cambiar de proveedor. | Pendiente |
| D-3 ([#33](https://github.com/masterly14/pacta_v1/issues/33)) | **Varios adjuntos en un correo.** ¿Una factura por adjunto o una por correo? Define la unicidad de `invoices` (A-01). | Pendiente |
| D-4 ([#34](https://github.com/masterly14/pacta_v1/issues/34)) | **`documents.public_url`.** CLAUDE.md §7 exige almacenamiento privado; la UI debe usar `/api/gmail/documents/[id]` con control por organización. | Revisar en A-09 |
| D-5 ([#35](https://github.com/masterly14/pacta_v1/issues/35)) | **Rutas.** El prefijo vigente es `/platform/*` (contratos, políticas y el menú lateral). | Resuelto |

- `src/features/payment-history/` (parseo CSV) es de B: B debe adoptarlo en `feature/b-payment-history`.

## 6. Registro

- 2026-10-17: A-02 en curso (no marcada). `src/features/invoices/extraction/`: lectura (unpdf; visión OpenAI para imágenes y PDF escaneado), extracción DeepSeek con `RawExtractionSchema`, conversión determinística a `InvoiceContext` con los campos `name/email/subject/body`. Verificado: 18 tests de Vitest en verde y lint limpio; **no** probado contra OpenAI/DeepSeek reales ni con Langfuse. Pendiente: `buildInvoiceContext()` (A-04) para `supplierId`/`contractMatch`, y cablear el pipeline (A-03). Dependencias añadidas: `@ai-sdk/openai`, `unpdf`. Requiere `OPENAI_API_KEY`.

- 2026-10-17: masterly14 traspasa contratos a Brayan. Se entrega `feature/a-contracts`: registro manual, comparación pura y página. Migración aplicada en la BD de desarrollo de Neon.
- 2026-10-17: masterly14 entrega `feature/gmail-composio` (Gmail + R2) y la plataforma protegida. Se crean los issues #11–#35 (etiqueta `vertical-a`). Próximo: A-01 y decidir D-1/D-2.
