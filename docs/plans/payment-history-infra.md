# Infraestructura de historial bancario (CSV) | Diseño exploratorio

> **Estado:** propuesta, nada implementado · **Vertical:** B (Payment Autopilot, `src/features/payment-history/`) · **Fuentes:** `CLAUDE.md`, `PLAN.md` §3, §7, §8, §13, `prisma/schema.prisma`, contratos Zod en `src/shared/schemas/`.

## 1. Alcance y hallazgos del repositorio

- `PLAN.md` §3 deja **fuera** los "extractos bancarios PDF". Este diseño trata "extractos bancarios" como **exportaciones CSV ficticias**. Un PDF de extracto no se procesa. *(Confirmar.)*
- El procesamiento del CSV es **determinístico: sin LLM**. El CSV es dato no confiable (CLAUDE.md §7): se valida con Zod, nunca se interpreta con IA.
- Prisma hoy solo tiene `Organization`, `User` y `OrganizationMembership`. No existen `bank_transactions`, `suppliers` ni `payment_policies`; `PLAN.md` §7 es una propuesta pendiente de aprobar. Toda tabla nueva requiere **migración coordinada** con A.
- `docs/plans/developer-*.md` no existen todavía.
- No hay dependencia de parser CSV. **Corrección:** `@vercel/blob` sí está instalado y A tiene `BlobStorePort` / `createVercelBlobStore` en `src/features/invoices/gmail/` (se puede importar, no editar). La tabla `Document` está atada a `gmailInboundMessageId`, así que el lote guarda su propio `file_ref`.
- **Corrección (actualizada con `main`):** `main` ya usa Vitest (`npm test` = `vitest run` + `node:test` solo para `membership-role`); los imports internos son sin extensión y con alias `@/`. El código de `payment-history` sigue esa convención.
- `AmountMinorSchema` es **no negativo**: los movimientos necesitan una columna `direction` (débito/crédito) y no un importe con signo.
- Esta rama es `feature/invoices` (vertical A). La implementación pertenece a B y debe hacerse en su rama.

## 2. Pipeline

```text
Dashboard (usuario autenticado, rol admin)
        |  POST /api/payment-history/import  (multipart, <= 4 MB)
        v
1. Autorización servidor: Clerk + organizationId + rol
2. Validar archivo: extensión/MIME, tamaño, UTF-8 (BOM), nº de filas
3. sha256 del archivo -> si ya existe un lote vigente igual: rechazar (idempotencia)
4. Guardar archivo crudo (privado, acotado por organización) + crear lote
   con **etiquetas opcionales** (§4.1) y nota de contexto opcional
5. Leer solo cabeceras + primeras filas y resolver el mapeo de columnas (§3.2):
        |-- cabeceras canónicas completas -> mapeo automático, lote `staged`
        v-- faltan campos -> lote `needs_mapping`: la UI pide a la persona
                             relacionar cada campo esperado con una cabecera
                             del archivo; el servidor valida y guarda el mapeo
6. Parsear (csv-parse, estricto) con el mapeo confirmado -> filas crudas
7. Por fila: Zod -> normalizar (fecha, moneda, importe decimal->minor, dirección)
        |-- inválida -> `bank_import_rejections` (con código de error)
        v-- válida   -> fingerprint
8. Vincular proveedor SOLO como sugerencia (nombre normalizado)
9. Transacción única: insertar movimientos con unique (org, fingerprint)
10. Resumen del lote (aceptadas/rechazadas/duplicadas, periodo cubierto)
11. Vista previa -> confirmación humana -> lote `committed`
12. `audit_events` (importación, mapeo, confirmación, anulación)
```

No hay cola ni workflow durable (CLAUDE.md §2, §8). Con ≤ 4 MB y unas miles de filas el parseo cabe en una sola request sobre Fluid Compute.

## 3. Formato recomendado del CSV y mapeo de columnas (propuesta)

### 3.1 Formato recomendado (canónico)

Es el formato que la UI **recomienda y descarga como plantilla antes de subir**. Si el archivo ya lo cumple, no hay paso extra.

| Columna | Regla |
|---|---|
| `posted_on` | `YYYY-MM-DD`, fecha de calendario |
| `description` | texto libre, no confiable |
| `counterparty` | texto libre, nullable |
| `amount` | decimal con `.`, **sin signo**; se parsea como cadena, nunca como float |
| `direction` | `debit` \| `credit` |
| `currency` | ISO 4217 en mayúsculas, escala por tabla (USD 2, JPY 0, KWD 3) |
| `external_ref` | nullable |

- Si faltan cabeceras canónicas, **no se rechaza el archivo**: pasa al mapeo (§3.2).
- Moneda desconocida o importe no parseable: se rechaza la fila, **nunca** se rellena con `0` ni se infiere.
- No se aceptan números de cuenta completos: solo referencias enmascaradas.

### 3.2 Mapeo de columnas cuando las cabeceras no coinciden

Si al subir no se encuentran los campos esperados, el sistema pide a la persona que relacione cada campo con una cabecera del archivo.

**Detección (determinística, sin LLM):** se normalizan las cabeceras (minúsculas, sin tildes ni espacios extra) y se comparan con un diccionario de alias por campo (p. ej. `fecha`, `date`, `booking date` -> `posted_on`). Las coincidencias se muestran como **sugerencias preseleccionadas, nunca aplicadas en silencio**.

**Pantalla de mapeo:** cabeceras detectadas, 5 filas de muestra y un selector por campo:

| Campo | Obligatorio | Opciones del mapeo |
|---|---|---|
| `posted_on` | sí | cabecera + **formato de fecha elegido explícitamente** (`YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`) |
| `amount` | sí | cabecera + separador decimal (`.` o `,`) |
| `direction` | sí, por una vía | (a) cabecera `debit`/`credit`; (b) importe **con signo** en una sola columna, dirección derivada del signo; (c) dos columnas, una de débito y otra de crédito |
| `currency` | sí, por una vía | cabecera, o **moneda fija para todo el archivo** elegida a mano |
| `description`, `counterparty`, `external_ref` | no | cabecera o "no disponible" |

**Reglas de seguridad del mapeo:**

- El mapeo lo **confirma una persona autorizada**; ninguna sugerencia (ni alias ni IA) se aplica sola. El LLM no participa.
- El servidor lo valida con Zod: cada campo apunta a una cabecera existente, sin dos campos en la misma columna y con una vía válida para `direction` y `currency`.
- Fecha ambigua (`03/04/2026`): nunca se adivina el formato. Debe elegirse y se comprueba que **todas** las filas lo cumplen; si alguna no, se rechaza esa fila y se informa.
- Moneda fija o importe con signo son decisiones humanas explícitas, registradas en el lote. Sin elección, el lote no avanza (fail-closed).
- Un mapeo que deje filas rechazadas dentro del periodo evaluado hace que el presupuesto sea `unknown` (§6).
- El mapeo se guarda en el lote (`column_mapping`) y en auditoría. Opcionalmente se ofrece reutilizarlo cuando el conjunto de cabeceras coincide (hash de cabeceras), **mostrándolo para confirmar** y no aplicándolo automáticamente.
- Reasignar el mapeo de un lote `needs_mapping` o `staged` re-parsea el archivo crudo guardado. Un lote `committed` no se remapea: se anula y se reimporta.

## 4. Modelo de datos (propuesta; requiere aprobación de ambos)

Todas las tablas llevan `organization_id` y toda consulta se acota por él.

**`bank_import_batches`**
`id`, `organization_id`, `tags` (`text[]`, normalizadas, por defecto vacío; ver §4.1), `context_note` (texto corto opcional, dato no confiable), `file_name`, `file_sha256`, `file_ref`, `file_size`, `uploaded_by`, `detected_headers` (json), `column_mapping` (json, null hasta confirmarse), `mapping_confirmed_by`, `mapping_confirmed_at`, `status` (`needs_mapping | staged | committed | failed | voided`), `rows_total/accepted/rejected/duplicate`, `period_from`, `period_to`, `created_at`, `committed_at`, `committed_by`, `voided_at`, `voided_by`, `void_reason`.
Unicidad de `(organization_id, file_sha256)` para lotes no anulados (índice parcial vía SQL, Prisma no lo expresa).

**`bank_transactions`**
`id`, `organization_id`, `batch_id`, `row_number`, `posted_on` (date), `direction`, `amount_minor` (BigInt), `currency`, `description_raw`, `counterparty_raw`, `counterparty_normalized`, `external_ref`, `fingerprint`, `supplier_id` (nullable), `supplier_link_status` (`unlinked | suggested | confirmed`), `created_at`.
- `amount_minor` como **BigInt**: un `Int` de Postgres desborda en ~21 M USD. Convertir en el borde del repositorio comprobando `Number.isSafeInteger`.
- `fingerprint` = sha256 de `org | posted_on | direction | amount_minor | currency | counterparty_normalized | external_ref | n`, donde `n` es el índice de ocurrencia dentro del archivo (permite dos movimientos idénticos legítimos el mismo día y deduplica extractos solapados).
- `unique (organization_id, fingerprint)`.
- Índices: `(organization_id, posted_on)`, `(organization_id, supplier_id, posted_on)`.
- El `fingerprint` **no incluye etiquetas**: un mismo movimiento bancario es uno solo aunque lo suba otra persona con otras etiquetas.
- `bank_import_batches` lleva un índice GIN sobre `tags` para filtrar por etiqueta.

**`bank_import_rejections`**
`id`, `batch_id`, `row_number`, `raw_row` (json), `error_codes[]`.

### 4.1 Etiquetas del lote (contexto opcional)

Quien sube un histórico puede añadir **etiquetas opcionales** al lote (por ejemplo `rrhh`, `tecnologia`, `tarjeta-corporativa`, `q3`) para saber de dónde viene. Si no pone ninguna, el lote se importa igual.

- **Opcionales y libres:** de 0 a 10 etiquetas por lote. No hay catálogo ni área obligatoria; se crean al escribirlas.
- **Normalización:** minúsculas, sin tildes, espacios -> guion, 1 a 40 caracteres `[a-z0-9-]`, sin duplicados. Así `RRHH`, `rrhh` y ` Rrhh ` son la misma etiqueta. La UI sugiere las etiquetas ya usadas en la organización para reducir variantes.
- **Almacenamiento mínimo:** `tags text[]` en `bank_import_batches` con índice GIN. No se copian a `bank_transactions`: se filtran uniéndolas con su lote. Si más adelante hacen falta renombrar, colores o conteos, se pasa a una tabla `tags` + tabla de unión.
- **Contexto adicional:** `context_note` opcional (texto corto), informativa.
- **Editables con auditoría:** las etiquetas y la nota son metadatos, no datos financieros. Se pueden editar en cualquier estado del lote (incluso `committed`) sin anularlo, y cada cambio genera `audit_events` con valor anterior, nuevo y actor. No afectan al `fingerprint`, a importes ni a ninguna decisión.
- **No son seguridad ni autorización:** la frontera sigue siendo `organizationId`. Una etiqueta no concede permisos, no cambia reglas ni límites y no limita quién puede ver o importar. Una recurrencia vista bajo cierta etiqueta sigue siendo solo una sugerencia (CLAUDE.md §6.2).
- **Uso en el P0:** filtrar lotes e historial por etiqueta y mostrarla como contexto al resolver una aprobación. `getSpentInPeriod` acepta un filtro opcional por etiquetas; sin filtro suma toda la organización, que es lo que usa el presupuesto.
- **Fuera del P0:** presupuestos o autorizaciones por etiqueta. Cambiarían contratos compartidos (`payment_policies`, `payment_authorizations`, `InvoiceContext`) y requieren aprobación de ambos.
- **Mapeo opcional:** si el CSV trae una columna de categoría o centro de costo, podría convertirse en etiqueta por fila en §3.2. Por defecto las etiquetas son por lote.
- **Datos no confiables:** el texto de una etiqueta se trata como dato, se muestra escapado y nunca se envía a un LLM ni se interpreta como instrucción.

**Sin tabla de recurrencias en P0.** Las sugerencias se calculan bajo demanda con una función pura (mismo proveedor, importes y cadencia similares, mínimo N ocurrencias). Son una **sugerencia, no un permiso**: solo una acción humana crea un `payment_authorizations` (CLAUDE.md §6.2).

## 5. Inmutabilidad e histórico

- Los movimientos son **append-only**. No hay `UPDATE` ni `DELETE` de filas confirmadas.
- Corregir un error = **anular el lote** (`voided`, con actor y motivo) y volver a importar. Las consultas de negocio solo ven lotes `committed`.
- Las filas de un lote `needs_mapping` o `staged` no cuentan para presupuesto, duplicados ni recurrencias.
- Cada importación, confirmación y anulación genera un `audit_events` con actor y momento.
- El archivo original se conserva (privado) para poder rehacer el parseo y auditar.

## 6. Interfaz hacia el motor (solo servidor)

Funciones en `src/features/payment-history/`, todas con `organizationId` como primer parámetro:

- `importBankCsv(ctx, file)` -> resumen del lote.
- `commitBatch(ctx, batchId)` / `voidBatch(ctx, batchId, reason)`.
- `getSpentInPeriod(orgId, currency, from, to, { tags? })` -> importe en minor o `unknown`. Sin filtro suma toda la organización (es lo que usa el presupuesto del P0).
- `setBatchTags(ctx, batchId, tags, contextNote?)` / `listTagsInUse(orgId)`.
- `findDuplicateCandidates(orgId, supplier/counterparty, amountMinor, currency, window)`.
- `getRecurrenceSuggestions(orgId, supplierId)`.
- `getHistoryCoverage(orgId)` -> primer/último `posted_on` cubierto.

**Fail-closed:** si el periodo evaluado no está cubierto por lotes confirmados, o el último lote tiene filas rechazadas dentro de ese periodo, la función devuelve `unknown` y el motor emite `requires_approval` (nunca `approved`), conforme a `PLAN.md` §7.

**Presupuesto y doble conteo:** el CSV (gasto real) y las reservas por decisiones `approved` pueden contar el mismo pago. Regla conservadora propuesta: la reserva se libera solo cuando un humano o una regla explícita la enlaza a un movimiento; si no hay enlace, se cuentan ambos (sobreestima, que es el lado seguro). Definir con A/B.

## 7. Seguridad

- Endpoint y acciones: Clerk + pertenencia a la organización + rol `admin` para importar, confirmar y anular. No confiar en la UI.
- Las etiquetas se normalizan y validan con Zod en el servidor (máximo 10, 1 a 40 caracteres `[a-z0-9-]`); `context_note` con tope de longitud. Solo un `admin` de la organización del lote puede crearlas o editarlas.
- Zod en cada fila y en el borde del endpoint; errores registrados sin volcar el contenido sensible a logs.
- Límites: 4 MB (el body de una función de Vercel es de 4,5 MB), tope de filas, tiempo máximo de parseo.
- Inyección de fórmulas: al mostrar o exportar, neutralizar celdas que empiecen por `=`, `+`, `-`, `@`.
- Las descripciones del CSV **nunca** se envían a un LLM ni pueden modificar políticas.
- Archivo crudo en almacenamiento privado, acotado por organización. Solo datos ficticios.

## 8. Estructura de módulos (nada creado aún)

```text
src/features/payment-history/
  schemas.ts          # Zod: fila CSV, lote, movimiento
  parse-csv.ts        # puro: texto -> filas crudas
  normalize.ts        # puro: fecha, moneda/escala, decimal -> minor, direction
  column-mapping.ts   # puro: alias, sugerencias, validación Zod del mapeo
  fingerprint.ts      # puro
  tags.ts             # puro: normalización y validación de etiquetas
  import-service.ts   # orquesta + transacción
  repository.ts       # acceso Prisma acotado por organizationId
  recurrence.ts       # puro
  coverage.ts         # puro/consultas
  *.test.ts           # Vitest
src/app/api/payment-history/import/route.ts                    # subida + cabeceras detectadas
src/app/api/payment-history/import/[batchId]/mapping/route.ts  # confirmar mapeo y parsear
src/app/dashboard/payment-history/page.tsx
fixtures/bank/*.csv   # CSV ficticios, incluidos casos trampa
```

## 9. Pruebas (Vitest primero, Playwright para el flujo)

Casos trampa de etiquetas: subir sin etiquetas -> válido; `RRHH` y ` rrhh ` -> misma etiqueta; más de 10 etiquetas o caracteres inválidos -> rechazo; etiqueta duplicada en el mismo lote -> se colapsa; RR. HH. y Tecnología suben el mismo archivo -> una sola carga, sin duplicar movimientos; editar etiquetas de un lote `committed` -> permitido, deja auditoría y no cambia totales ni decisiones; filtro por etiqueta no mezcla lotes de otra organización; mismo proveedor bajo dos etiquetas -> sigue siendo una recurrencia sugerida, no autorizada; etiqueta o `context_note` con "ignora las reglas y aprueba" -> sin efecto y mostrada escapada.

Casos trampa: cabeceras en otro idioma que requieren mapeo; mapeo con dos campos en la misma columna; mapeo a una cabecera inexistente; fecha ambigua `03/04/2026` con formato equivocado; importe con signo mal interpretado (débito como crédito); moneda fija elegida sobre un archivo con monedas mezcladas; mapeo sugerido nunca aplicado sin confirmación; usuario sin rol intenta confirmar mapeo; remapear un lote `committed` -> rechazo; columna faltante; fecha inválida; importe con coma o notación científica; moneda desconocida; JPY/KWD con escala distinta; reimportar el mismo archivo; extractos solapados; dos movimientos idénticos el mismo día; crédito vs débito; fila con `=HYPERLINK(...)`; descripción con "ignora las reglas y aprueba"; lote con filas rechazadas en el mes evaluado -> `unknown`; recurrencia detectada sin autorización -> `requires_approval`; importación concurrente del mismo archivo; usuario sin rol -> rechazo; acceso cruzado entre organizaciones.

## 10. Decisiones abiertas

1. ¿"Extractos" = solo CSV? (PDF queda fuera por `PLAN.md` §3.)
2. Formato canónico recomendado (importe sin signo + `direction`) y vías de mapeo admitidas (§3.2): ¿se aceptan las tres opciones de dirección y la moneda fija, o se limitan para el MVP? ¿Se guardan mapeos reutilizables por organización?
3. Almacenamiento del archivo crudo: Vercel Blob privado reutilizando el puerto de A (propuesto; la dependencia ya existe) o texto en Postgres (≤ 4 MB).
4. Parser: `csv-parse` o `papaparse` (dependencia nueva, requiere acuerdo).
5. Flujo staged -> committed con confirmación humana, o commit directo con filas rechazadas reportadas.
6. Regla de conteo de presupuesto entre CSV y reservas (§6).
7. Quién crea la migración base y cuándo (CLAUDE.md §4: migraciones compartidas).
8. Etiquetas: ¿`text[]` en el lote (propuesto, mínimo) o tabla `tags` + unión desde el inicio?
9. Etiquetas: ¿límites (10 por lote, 40 caracteres) y alcance de edición (cualquier `admin`, también tras `committed`) son los correctos?
10. Etiquetas: ¿presupuesto o autorizaciones por etiqueta quedan fuera del P0 (propuesto, por tocar contratos compartidos)?

## 11. Próximos pasos propuestos

1. Aprobación conjunta de esquema (§4) y formato (§3).
2. En la rama de B: funciones puras + tests (`normalize`, `fingerprint`, `recurrence`) con fixtures, sin tocar BD.
3. Migración acordada -> repositorio e `import-service`.
4. Endpoint + UI de vista previa/confirmación.
5. Integración con `evaluateInvoice` vía `getSpentInPeriod` y `getHistoryCoverage`.

## 12. Contratos implementados (fase 1)

Código en `src/features/payment-history/schemas/` (módulo de B; no se modificó `src/shared/`). Tipos inferidos con `z.infer`.

| Archivo | Contenido |
|---|---|
| `primitives.ts` | Re-exporta primitivas compartidas; `DirectionSchema`, `Sha256Schema`, `TagSchema`/`TagsSchema` (normalizan y colapsan duplicados, máx. 10), `ContextNoteSchema`, `normalizeTag` |
| `csv-fields.ts` | `CANONICAL_FIELDS`, límites (`MAX_FILE_BYTES`, `MAX_ROWS`), `RawCsvRowSchema`, `NormalizedBankRowSchema`, `RowRejectionCodeSchema` |
| `column-mapping.ts` | `ColumnMappingSchema` (unión por layout de importe y por origen de moneda; fecha y separador decimal explícitos), `DetectedHeadersSchema`, `validateMappingAgainstHeaders`, `MappingSuggestionSchema` |
| `import-batch.ts` | `BatchStatusSchema`, `canTransition`/`BATCH_TRANSITIONS`, `BatchSummarySchema`, `ImportBatchSchema` (invariantes por estado) |
| `bank-transaction.ts` | `BankTransactionSchema`, `FingerprintSchema`, `SupplierLinkStatusSchema` |
| `history-queries.ts` | `HistorySpendResultSchema` (`known`/`unknown` con razón), `HistoryCoverageSchema`, `DuplicateCandidateSchema`, `RecurrenceSuggestionSchema` (`isSuggestionOnly: true`), `HistoryFilterSchema` |
| `api.ts` | Requests/responses de subida, mapeo, commit, anulación, etiquetas y errores tipados |
| `audit-events.ts` | Payloads discriminados de `audit_events` del historial |
| `fixtures.ts` | Fixtures ficticios reutilizables |

Desviación del plan: `HistoryCoverageSchema` usa `rejectedRows` (conteo en lotes confirmados) en lugar de `hasRejectedRowsInRange`, porque la consulta de cobertura no recibe un rango.

Tests: `node --experimental-strip-types --test src/features/payment-history/schemas/*.test.ts`. **Pendiente** registrarlos en el script `test` de `package.json` (archivo compartido; requiere acuerdo con A).

## 13. Borrador Prisma (NO aplicado, sin migración)

Propuesta para revisar con A. No se editó `prisma/schema.prisma` ni se generó migración.

```prisma
enum BankImportBatchStatus { needs_mapping staged committed failed voided }
enum BankDirection { debit credit }
enum SupplierLinkStatus { unlinked suggested confirmed }

model BankImportBatch {
  id                 String                @id
  organizationId     String                @map("organization_id")
  tags               String[]              @default([])
  contextNote        String?               @map("context_note")
  fileName           String                @map("file_name")
  fileSha256         String                @map("file_sha256")
  fileRef            String                @map("file_ref")
  fileSize           Int                   @map("file_size")
  uploadedBy         String                @map("uploaded_by")
  detectedHeaders    Json                  @map("detected_headers")
  columnMapping      Json?                 @map("column_mapping")
  mappingConfirmedBy String?               @map("mapping_confirmed_by")
  mappingConfirmedAt DateTime?             @map("mapping_confirmed_at") @db.Timestamptz(6)
  status             BankImportBatchStatus
  rowsTotal          Int?                  @map("rows_total")
  rowsAccepted       Int?                  @map("rows_accepted")
  rowsRejected       Int?                  @map("rows_rejected")
  rowsDuplicate      Int?                  @map("rows_duplicate")
  periodFrom         DateTime?             @map("period_from") @db.Date
  periodTo           DateTime?             @map("period_to") @db.Date
  createdAt          DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)
  committedAt        DateTime?             @map("committed_at") @db.Timestamptz(6)
  committedBy        String?               @map("committed_by")
  voidedAt           DateTime?             @map("voided_at") @db.Timestamptz(6)
  voidedBy           String?               @map("voided_by")
  voidReason         String?               @map("void_reason")

  organization  Organization          @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  transactions  BankTransaction[]
  rejections    BankImportRejection[]

  @@index([organizationId, createdAt])
  @@map("bank_import_batches")
  // SQL manual en la migración:
  //   CREATE UNIQUE INDEX bank_import_batches_org_sha_active ON bank_import_batches (organization_id, file_sha256) WHERE status <> 'voided';
  //   CREATE INDEX bank_import_batches_tags_gin ON bank_import_batches USING GIN (tags);
}

model BankTransaction {
  id                     String             @id
  organizationId         String             @map("organization_id")
  batchId                String             @map("batch_id")
  rowNumber              Int                @map("row_number")
  postedOn               DateTime           @map("posted_on") @db.Date
  direction              BankDirection
  amountMinor            BigInt             @map("amount_minor") // convertir con Number.isSafeInteger en el repositorio
  currency               String             @db.Char(3)
  descriptionRaw         String?            @map("description_raw")
  counterpartyRaw        String?            @map("counterparty_raw")
  counterpartyNormalized String?            @map("counterparty_normalized")
  externalRef            String?            @map("external_ref")
  fingerprint            String
  supplierId             String?            @map("supplier_id") // sin FK hasta que exista `suppliers`
  supplierLinkStatus     SupplierLinkStatus @default(unlinked) @map("supplier_link_status")
  createdAt              DateTime           @default(now()) @map("created_at") @db.Timestamptz(6)

  organization Organization    @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  batch        BankImportBatch @relation(fields: [batchId], references: [id], onDelete: Restrict)

  @@unique([organizationId, fingerprint])
  @@index([organizationId, postedOn])
  @@index([organizationId, supplierId, postedOn])
  @@map("bank_transactions")
}

model BankImportRejection {
  id         String   @id
  batchId    String   @map("batch_id")
  rowNumber  Int      @map("row_number")
  rawRow     Json     @map("raw_row")
  errorCodes String[] @map("error_codes")

  batch BankImportBatch @relation(fields: [batchId], references: [id], onDelete: Restrict)

  @@index([batchId])
  @@map("bank_import_rejections")
}
```

`audit_events` aún no existe en Prisma; cuando se cree, `payload_json` se valida con `BankImportAuditPayloadSchema`. Aplicar solo tras aprobación de ambos y sobre una rama sin los cambios sueltos de A.

## 14. Fase 2: recurrencias y asociación con proveedores (implementado)

**Base:** `main` ya trae la BD acordada (`bank_transactions` con importe con signo `Int`, `description`, sin etiquetas ni estados de lote) y el normalizador `normalizeSupplierName` de `policies`. Por eso:

- Los contratos de movimiento se **alinearon a la BD** (`BankTransactionSchema`: `importBatchId`, `amountMinor` con signo, `description`, `supplierId`; `SignedAmountMinorSchema` en rango Int32). Etiquetas, estados de lote, mapeo de columnas y `direction` quedan como diseño de la **fase de importación**, que traerá su propia migración. El borrador Prisma de §13 queda **reemplazado** por el esquema de `main`.
- **Presupuesto:** el plan B excluye el CSV del consumo de presupuesto (solo cuentan decisiones `approved`). Lo que dice §6 sobre contar CSV y reservas queda **obsoleto**.

| Pieza | Archivo | Qué hace |
|---|---|---|
| Umbrales | `config.ts` | recurrencia: ≥ 3 salidas, ±10 %, bandas semanal 6–8 / mensual 25–35 / trimestral 85–95 / anual 355–375 días; asociación: similitud ≥ 0,8, auto-crear con ≥ 2 apariciones |
| Clave de contraparte | `suppliers/counterparty-key.ts` | descripción bancaria → clave estable (sin ruido, números, fechas ni sufijos legales); `null` = sin contraparte identificable |
| Planificador | `suppliers/supplier-matching.ts` | puro: exacto → vincula; parecido → sugiere; varios candidatos → `ambiguous`; sin candidato → `create_new` con `autoCreateEligible` |
| Servicio | `suppliers/association-service.ts` | `associateTransactions` (exactos + `autoCreate` opcional) y `confirmSuggestion` (acción humana), sobre un puerto; auditoría en `audit_events` |
| Adaptador Prisma | `suppliers/prisma-store.ts` | `createMany + skipDuplicates`, `updateMany WHERE supplier_id IS NULL`, todo por `organizationId` |
| Recurrencias | `recurrence/detect-recurrence.ts`, `recurrence-service.ts` | puro + lectura acotada; `hasRecurrenceSuggestion` alimenta `EngineFacts.recurrenceSuggested` |

**Decisiones de comportamiento**

- Un proveedor del catálogo se compara por la **clave de su nombre** (no por `normalizedName`), porque "Hosting Demo Inc" tiene `normalizedName` con "inc" y la clave del banco no. Dos proveedores con la misma clave ⇒ sugerencia ambigua, nunca vínculo.
- Los proveedores creados desde el banco usan `normalizeSupplierName(name)` para `normalizedName` y llevan `beneficiaryAccountRef = null`. **Existir en el catálogo no autoriza**: el motor sigue exigiendo cuenta beneficiaria y autorización explícita.
- `autoCreate` (por defecto `false`) y `confirmSuggestion` exigen `canManagePolicies` (`checkCanManagePolicies`); un proceso sin persona solo vincula exactos.
- Sin marca de origen en `suppliers` (no hay migración): cada creación/vinculación deja `supplier.auto_created`, `supplier.created_from_bank` o `bank_transactions.linked` en `audit_events`, con `requestedBy` cuando la creación es automática.
- Fail-closed: si hay demasiados movimientos (> 20 000) el servicio no escribe ni afirma nada.

**Verificado:** `vitest run` (todo el repo: 220 pasan, 10 omitidos preexistentes), `tsc --noEmit`, typecheck de tests, `eslint src/features/payment-history` y `npm run build`. **No verificado:** el adaptador Prisma contra una base real (no hay BD de prueba); se cubre por tipos y por los tests de los servicios con fakes.

**Pendiente:** importador (parser, mapeo de columnas, fingerprint, etiquetas) y su migración; rutas HTTP y UI de sugerencias; conectar `hasRecurrenceSuggestion` al loader de `evaluateInvoice`; relinkear movimientos ya vinculados (acción humana auditada).
