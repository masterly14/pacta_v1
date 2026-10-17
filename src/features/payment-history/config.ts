// Umbrales de la lógica de historial bancario (plan B §3). Ajustables sin tocar los algoritmos.

// --- Recurrencia ---------------------------------------------------------------------------------
export const RECURRENCE_MIN_OCCURRENCES = 3;
export const AMOUNT_TOLERANCE_PERCENT = 10;
export const RECURRENCE_LOOKBACK_MONTHS = 18;
export const RECURRENCE_MAX_ROWS = 20_000;

export type RecurrenceCadence = "weekly" | "monthly" | "quarterly" | "yearly";

// Días entre pagos consecutivos que se aceptan para cada cadencia (ambos extremos incluidos).
export const CADENCE_BANDS: Record<RecurrenceCadence, { minDays: number; maxDays: number }> = {
  weekly: { minDays: 6, maxDays: 8 },
  monthly: { minDays: 25, maxDays: 35 },
  quarterly: { minDays: 85, maxDays: 95 },
  yearly: { minDays: 355, maxDays: 375 },
};

// --- Asociación con proveedores ------------------------------------------------------------------
// A partir de esta similitud (0..1) se SUGIERE un proveedor existente; nunca se vincula solo.
export const FUZZY_SUGGEST_THRESHOLD = 0.8;
// Si el segundo mejor candidato queda a menos de este margen del primero, la sugerencia es ambigua.
export const AMBIGUITY_MARGIN = 0.05;
// Apariciones mínimas para que la auto-creación opcional cree un proveedor.
export const AUTO_CREATE_MIN_OCCURRENCES = 2;
// Longitud mínima de al menos un token de la clave para considerarla "limpia".
export const AUTO_CREATE_MIN_TOKEN_LENGTH = 3;
export const KEY_MAX_TOKENS = 4;
export const SAMPLE_DESCRIPTIONS_MAX = 3;

// Ruido bancario que no identifica a la contraparte.
export const NOISE_TOKENS: ReadonlySet<string> = new Set([
  "compra", "compras", "pago", "pagos", "pos", "ach", "tarjeta", "tarj", "card", "debito", "credito", "debit",
  "credit", "purchase", "payment", "pmt", "recurring", "recurrente", "suscripcion", "subscription", "cargo",
  "charge", "online", "web", "www", "com", "net", "org", "visa", "mastercard", "mc", "ref", "referencia",
  "no", "nro", "num", "numero", "id",
]);

// Palabras que describen el tipo de movimiento, no a un proveedor. Si solo queda esto, no se asocia.
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  "transferencia", "transferencias", "transfer", "retiro", "retiros", "withdrawal", "deposito", "depositos",
  "deposit", "comision", "comisiones", "fee", "fees", "atm", "cajero", "interes", "intereses", "interest",
  "impuesto", "impuestos", "tax", "cheque", "check", "nomina", "payroll", "banco", "bank", "saldo", "balance",
  "ajuste", "adjustment", "sobregiro", "overdraft",
]);

export const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  "inc", "llc", "ltd", "ltda", "corp", "co", "sa", "sac", "sas", "srl", "sl", "spa", "gmbh", "plc", "bv", "ag",
]);
