// Fixtures ficticios de los contratos del historial bancario. No son datos reales.
// Se usan en los tests; B puede trabajar con ellos sin esperar a parser, BD ni endpoints.

export const detectedHeadersFixture = {
  schemaVersion: 1,
  headers: ["Fecha", "Descripcion", "Contraparte", "Importe", "Tipo", "Moneda", "Referencia"],
} as const;

export const splitHeadersFixture = {
  schemaVersion: 1,
  headers: ["Booking date", "Narrative", "Debit", "Credit"],
} as const;

// Importe sin signo + columna de dirección + moneda por columna.
export const mappingAmountAndDirectionFixture = {
  schemaVersion: 1,
  date: { header: "Fecha", format: "DD/MM/YYYY" },
  amount: { layout: "amount_and_direction", amountHeader: "Importe", directionHeader: "Tipo" },
  decimalSeparator: ",",
  currency: { source: "column", header: "Moneda" },
  description: { header: "Descripcion" },
  counterparty: { header: "Contraparte" },
  externalRef: { header: "Referencia" },
} as const;

// Importe con signo en una columna + moneda fija elegida a mano.
export const mappingSignedFixture = {
  schemaVersion: 1,
  date: { header: "Fecha", format: "YYYY-MM-DD" },
  amount: { layout: "signed_amount", amountHeader: "Importe" },
  decimalSeparator: ".",
  currency: { source: "fixed", code: "USD" },
  description: null,
  counterparty: null,
  externalRef: null,
} as const;

// Dos columnas (débito/crédito).
export const mappingSplitColumnsFixture = {
  schemaVersion: 1,
  date: { header: "Booking date", format: "MM/DD/YYYY" },
  amount: { layout: "debit_credit_columns", debitHeader: "Debit", creditHeader: "Credit" },
  decimalSeparator: ".",
  currency: { source: "fixed", code: "USD" },
  description: { header: "Narrative" },
  counterparty: null,
  externalRef: null,
} as const;

export const summaryFixture = {
  rowsTotal: 10,
  rowsAccepted: 8,
  rowsRejected: 1,
  rowsDuplicate: 1,
  periodFrom: "2026-01-02",
  periodTo: "2026-03-28",
} as const;

const batchBase = {
  id: "batch_demo_1",
  organizationId: "org_demo",
  tags: ["rrhh"],
  contextNote: null,
  fileName: "extracto-demo.csv",
  fileSha256: "a".repeat(64),
  fileRef: "orgs/org_demo/bank-imports/batch_demo_1.csv",
  fileSize: 2048,
  uploadedBy: "user_admin",
  detectedHeaders: detectedHeadersFixture,
  columnMapping: null,
  mappingConfirmedBy: null,
  mappingConfirmedAt: null,
  status: "needs_mapping",
  summary: null,
  createdAt: "2026-04-01T10:00:00Z",
  committedAt: null,
  committedBy: null,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
};

export function batchNeedsMappingFixture(overrides: Record<string, unknown> = {}) {
  return { ...batchBase, ...overrides };
}

export function batchStagedFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...batchBase,
    status: "staged",
    columnMapping: mappingAmountAndDirectionFixture,
    mappingConfirmedBy: "user_admin",
    mappingConfirmedAt: "2026-04-01T10:05:00Z",
    summary: summaryFixture,
    ...overrides,
  };
}

export function batchCommittedFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...batchStagedFixture(),
    status: "committed",
    committedAt: "2026-04-01T10:10:00Z",
    committedBy: "user_admin",
    ...overrides,
  };
}

export function batchVoidedFixture(overrides: Record<string, unknown> = {}) {
  return {
    ...batchCommittedFixture(),
    status: "voided",
    voidedAt: "2026-04-02T09:00:00Z",
    voidedBy: "user_admin",
    voidReason: "Extracto con fechas mal interpretadas",
    ...overrides,
  };
}

export function transactionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "txn_demo_1",
    organizationId: "org_demo",
    importBatchId: "batch_demo_1",
    postedOn: "2026-01-15",
    amountMinor: -2000, // salida de 20,00 USD
    currency: "USD",
    description: "COMPRA TARJETA 4455 HOSTING DEMO INC 15/01",
    externalRef: null,
    fingerprint: "b".repeat(64),
    supplierId: null,
    createdAt: "2026-04-01T10:10:00Z",
    ...overrides,
  };
}

export const spendKnownFixture = {
  status: "known",
  amountMinor: 450000,
  currency: "USD",
  from: "2026-04-01",
  to: "2026-04-30",
  batchIds: ["batch_demo_1"],
} as const;

export const spendUnknownFixture = { status: "unknown", reason: "PERIOD_NOT_COVERED" } as const;

export const recurrenceSuggestionFixture = {
  groupKind: "unlinked_counterparty",
  counterpartyNormalized: "hosting demo",
  supplierId: null,
  cadence: "monthly",
  typicalAmountMinor: 2000,
  currency: "USD",
  occurrences: 3,
  transactionIds: ["txn_demo_1", "txn_demo_2", "txn_demo_3"],
  firstPostedOn: "2026-01-15",
  lastPostedOn: "2026-03-15",
  isSuggestionOnly: true,
} as const;
