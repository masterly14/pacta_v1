# Plan A — Invoice Intelligence

> **Owner:** Desarrollador A (masterly14) · **Contratos:** Brayan (traspaso acordado el 2026-10-17)
> **Referencias:** [`PLAN.md`](../../PLAN.md) §5, §6.1, §9, §13 · [`CLAUDE.md`](../../CLAUDE.md)
> **Produce:** `InvoiceContext` (`src/shared/schemas/invoice-context.ts`), incluido `contractMatch`.

## 1. Orden de trabajo (una rama corta por funcionalidad)

- [x] **`feature/a-contracts`** (Brayan): tabla `contracts`, registro manual, `/dashboard/contracts`, `POST /api/contracts` y `matchContract()` → `ContractMatch`.
- [ ] **`feature/a-contracts-pdf`** (Brayan, si hay tiempo): subir PDF del contrato, el LLM propone términos y una persona los confirma antes de activarlo.
- [ ] _Ingesta (Resend + carga manual), documentos, extracción e `invoices`: por definir con masterly14._
- [ ] _`buildInvoiceContext()`: identificación del proveedor + `findContractMatch()` + `missingFields`. Por definir con masterly14._
- [ ] _Inbox `/dashboard/invoices` y detalle: por definir con masterly14._

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

## 5. Registro

- 2026-10-17: masterly14 traspasa contratos a Brayan. Se entrega `feature/a-contracts`: registro manual, comparación pura y página. Migración aplicada en la BD de desarrollo de Neon.
