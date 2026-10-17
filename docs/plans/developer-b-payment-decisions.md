# Plan B — Payment Autopilot

> **Owner:** Desarrollador B · **Referencias:** [`PLAN.md`](../../PLAN.md) §8, §10, §13 · [`CLAUDE.md`](../../CLAUDE.md)
> **Consume:** `InvoiceContext` (`src/shared/schemas/invoice-context.ts`) · **Produce:** `PaymentDecision` (`src/shared/schemas/payment-decision.ts`)

## 1. Orden de trabajo (una rama corta por funcionalidad)

- [x] **`feature/b-db-schema`**: tablas de B en `schema.prisma` + una migración (ver §4).
- [x] **`feature/b-engine`**: Vitest + `decide()` puro + fixtures de casos trampa (sin BD ni IA). Código en `src/features/decisions/engine/`.
- [x] **`feature/b-policies`**: proveedores, políticas versionadas, autorizaciones y permisos de aprobación (datos demo + UI mínima). Código en `src/features/policies/` y `/platform/policies`.
- [ ] **`feature/b-decisions`**: `evaluateInvoice()`, `POST /api/invoices/[id]/evaluate`, decisiones persistidas, auditoría, idempotencia.
- [ ] **`feature/b-approvals`**: bandeja, resolución con reevaluación, autorización recurrente explícita, bloqueo transaccional.
- [ ] **`feature/b-payment-history`**: importación CSV + sugerencias de recurrencia.
- [ ] Páginas de B: `/platform/policies`, `/platform/approvals`, `/platform/payment-history`, `/platform/audit`.

## 2. Motor determinístico (sin IA, 10 reglas)

La IA solo interviene antes (vertical A) para leer documentos. El motor compara datos estructurados con reglas TypeScript.

- **`decide(context, facts): PaymentDecision`** — función pura. `facts` = política vigente, autorizaciones, decisiones previas, presupuesto consumido, sugerencias de recurrencia.
- **`evaluateInvoice(context): Promise<PaymentDecision>`** — solo servidor; carga `facts` de la BD y llama a `decide()`.
- Se evalúan **todas** las reglas aunque alguna falle. Una regla sin dato de entrada devuelve `unknown`.
- Resultado: algún bloqueo absoluto falla → `blocked`; cualquier otra regla `fail`/`unknown` → `requires_approval`; todas `pass` → `approved` con `AUTO_APPROVAL_RULES_PASSED`.

| # | `ruleId` | Falla con | Resultado |
|---|---|---|---|
| 1 | `essential_fields_present` (proveedor confirmado, monto, moneda, número, cuenta) | `INSUFFICIENT_DATA` | escala |
| 2 | `no_extraction_warnings` (A no reportó advertencias de extracción) | `INSUFFICIENT_DATA` | escala |
| 3 | `currency_supported` (solo USD en P0) | `CURRENCY_NOT_SUPPORTED` | escala |
| 4 | `not_duplicate` | `DUPLICATE_INVOICE` | **bloquea** si confirmado; escala si sospechoso o reenvío de una bloqueada |
| 5 | `supplier_authorized` (activa, vigente hoy y en la fecha de factura, sin usar en su periodo) | `SUPPLIER_NOT_AUTHORIZED` o `RECURRENCE_NOT_AUTHORIZED` (si hay recurrencia en CSV) | escala |
| 6 | `beneficiary_matches_authorization` | `BENEFICIARY_CHANGED` | escala |
| 7 | `within_authorization_limit` | `AMOUNT_LIMIT_EXCEEDED` | escala |
| 8 | `within_policy_auto_limit` | `AMOUNT_LIMIT_EXCEEDED` | escala |
| 9 | `contract_consistent` | `CONTRACT_MISMATCH` | escala |
| 10 | `budget_available` | `BUDGET_INSUFFICIENT` | **bloquea** |

## 3. Decisiones acordadas

| Tema | Decisión |
|---|---|
| Bloqueos absolutos | Solo **duplicado confirmado** y **presupuesto insuficiente**. Todo lo demás escala; una aprobación humana nunca salta un bloqueo absoluto. |
| Cuenta beneficiaria cambiada | Escala (puede ser un cambio legítimo de banco). La autorización existente no se transfiere a la cuenta nueva. |
| Proveedor autorizado | Coinciden **todas** las dimensiones de una autorización activa: proveedor, cuenta beneficiaria, moneda, monto máximo, alcance y vigencia (hoy **y** fecha de factura). Cada autorización cubre **una factura por periodo** de su frecuencia (`one_time`: una en total); el loader informa `approvalsInCurrentPeriod`. Contrato o historial nunca autorizan. |
| Contrato | No es obligatorio si hay autorización. `mismatch` o `ambiguous` escalan; `not_found`/`null` son informativos. |
| Presupuesto | Consumido = suma de decisiones `approved` del **mes calendario UTC** (por fecha de decisión), en USD. El CSV **no** cuenta (evita doble conteo). Si no se puede calcular → escala. |
| Duplicados | Número normalizado (mayúsculas, sin separadores). Solo cuenta la decisión **más reciente** de cada factura previa. Confirmado = mismo `supplierId` + número, o mismo sha256, con última decisión no `blocked` → bloquea. Reenvío de una factura cuya última decisión fue `blocked` → escala (una persona confirma). Sospechoso (mismo proveedor, monto y fecha, otro número) o número ausente → escala. |
| Permisos | Identidad y rol vienen de Clerk (espejo en `organization_memberships`, de A). Permisos de pago en tabla propia de B `approval_permissions`: sin fila = sin permisos; `approvalLimitMinor` obligatorio si `canApprove` (no hay aprobadores ilimitados). Solo rol `admin` edita permisos. Todo se verifica en servidor. |
| Aprobación humana | El servidor revalida con `decide()` contra política y presupuesto vigentes y verifica el límite del aprobador. Guarda **nueva** fila con `decisionSource: human`; no edita la anterior. Autorización recurrente solo mediante casilla explícita con cuenta, monto máximo, frecuencia y vigencia. |
| Concurrencia | Verificación de presupuesto + inserción de `approved` dentro de una transacción que bloquea la fila de política de la organización (`SELECT … FOR UPDATE`). Una factura no se aprueba dos veces (índice único parcial). |
| CSV | Columnas `date` (YYYY-MM-DD), `description`, `amount` (texto decimal, negativo = salida), `currency`, `reference`. Parseo a unidades menores sin floats. Filas inválidas se rechazan con error por fila; repetidas se omiten. |
| Recurrencia | ≥ 3 salidas al mismo proveedor, intervalos de 25–35 días, montos ±10 % → solo sugerencia, nunca autorización. |
| Gestión de políticas | Rol `admin` (Clerk) → editar permisos de pago y cargar datos demo. `canManagePolicies` → proveedores, versiones de política y autorizaciones. Crear una autorización exige además `canApprove` con límite ≥ monto máximo: nadie autoriza más de lo que podría aprobar. |
| Datos demo | Botón solo para admin en `/platform/policies` (idempotente). Proveedores = los del CSV demo (Nube Hosting LLC, Diseño Studio, Papelería Central). Solo Papelería Central queda autorizada; Nube Hosting tiene historial recurrente sin autorización y debe escalar. El admin recibe permisos explícitos (límite 10,000.00 USD). |
| Normalización de proveedores | `normalizeSupplierName` (policies) debe producir lo mismo que `normalizeName` (payment-history); un test lo verifica. Al integrar, payment-history debería importar la de policies. |
| Tests | Vitest. `npm test` ejecuta Vitest y luego el test de A con `node --test` (`test:node`) hasta que A decida migrarlo. |

## 4. Tablas de B

Todas con `organization_id` → `organizations` e índices por organización.

| Tabla | Propósito | Notas |
|---|---|---|
| `suppliers` | Catálogo (no implica autorización) | único por `(organization_id, normalized_name)` |
| `payment_policies` | Política versionada: límite automático, presupuesto mensual | único por `(organization_id, version)` |
| `payment_authorizations` | Autorizaciones explícitas único/recurrente | estado `active \| revoked \| consumed` |
| `approval_permissions` | Permisos de aprobación por usuario | FK compuesta a `organization_memberships`; CHECK límite obligatorio |
| `payment_decisions` | Cada `PaymentDecision`, solo inserción | guarda `supplier_id` + `invoice_number` + monto para duplicados y presupuesto; único parcial: un `approved` por factura |
| `approval_requests` | Bandeja humana | único parcial: una solicitud `pending` por factura |
| `bank_import_batches` | Lote de importación CSV | quién y cuándo importó |
| `bank_transactions` | Movimientos ficticios del CSV | único por `(organization_id, fingerprint)` |
| `audit_events` | Rastro append-only | actor nullable = sistema |

## 5. Bloqueos y coordinación con A

- `invoice_id` en `payment_decisions` / `approval_requests` es texto sin FK hasta que A cree `invoices`; agregar la FK en una migración coordinada.
- Script `test`: el test de A (`src/shared/auth/membership-role.test.ts`) sigue en `node --test`; migrarlo a Vitest es opcional y lo decide A.
- Huella de archivo para duplicados: `InvoiceContext` no trae sha256. El loader de `evaluateInvoice()` buscará en `documents` (A) las facturas con el mismo sha256 y decisión no `blocked`, y las pasa en `documentDuplicateInvoiceIds`. Sin la tabla de A, la lista va vacía y solo se detecta por proveedor + número.

## 6. Registro

- 2026-10-17: plan acordado en sesión de diseño. Orden elegido: tablas primero, luego motor.
- 2026-10-17: tablas de B aplicadas en Neon (`20261017163245_add_payment_autopilot_tables`).
- 2026-10-17: correcciones tras prueba en Chrome: un proveedor no puede tener dos contratos vigentes solapados (409 en la API, bloqueo de fila del proveedor); los formularios conservan lo escrito tras un error (`src/shared/forms/use-form-action.ts`); toasts al terminar contratos, revocar autorizaciones y cargar datos demo; montos de contratos con el mismo formato que políticas; mensajes de moneda en español.
- 2026-10-17: políticas: CRUD con auditoría, permisos, datos demo y página. 38 tests unitarios + 10 de integración opcionales (`TEST_DATABASE_URL`, base desechable). Build local requiere que `.env.local` no sobrescriba `DATABASE_URL` con vacío.
- 2026-10-17: revisión de código del PR #5: se añadieron uso por periodo de autorizaciones, vigencia por fecha de factura, normalización de número, última decisión por factura, regla de advertencias de extracción y escalado de reenvíos bloqueados (48 tests).
- 2026-10-17: motor `decide(invoice, facts)` con 38 tests de casos trampa. Entradas validadas con Zod (`EngineFactsSchema`); la salida pasa por `PaymentDecisionSchema.parse` como última barrera. Explicaciones por plantilla, sin IA. Próximo: `feature/b-policies`.
