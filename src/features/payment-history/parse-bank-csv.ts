/**
 * Purpose: turn a fictional bank CSV into rows the committed bank_transactions table can store.
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: import-csv.ts.
 * Receives → Returns: CSV text → accepted rows (signed amountMinor, negative = outflow),
 *   per-row rejections, or one file-level error when the headers are not a supported layout.
 * Talks to: contracts/money.ts for decimal → minor units without floats.
 */
import { parseAmountToMinor } from "@/features/contracts/money";
import { MAX_CELL_LENGTH, MAX_ROWS } from "./schemas/csv-fields";

export type ParsedBankRow = {
  rowNumber: number;
  postedOn: string;
  amountMinor: number;
  currency: string;
  description: string;
  externalRef: string | null;
};

export type RejectedBankRow = { rowNumber: number; message: string };

export type ParseBankCsvResult =
  | { ok: false; error: string }
  | { ok: true; rows: ParsedBankRow[]; rejected: RejectedBankRow[] };

const HEADER_HELP =
  "Usa las columnas date, description, amount, currency y, si quieres, reference. " +
  "amount es un decimal con punto y el signo indica el sentido: negativo es una salida (por ejemplo -20.00). " +
  "También vale posted_on, amount sin signo y direction (debit o credit).";

function parseCsv(text: string, delimiter: "," | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function delimiterOf(text: string): "," | ";" {
  const header = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const commas = header.split(",").length;
  const semicolons = header.split(";").length;
  return semicolons > commas ? ";" : ",";
}

function headerKey(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isFormula(value: string): boolean {
  return /^[=+@]/.test(value.trim());
}

function columnIndex(headers: string[], names: readonly string[]): number {
  return headers.findIndex((header) => names.includes(header));
}

export function parseBankCsv(text: string): ParseBankCsvResult {
  const table = parseCsv(text, delimiterOf(text));
  if (table.length === 0) return { ok: false, error: "El archivo está vacío." };

  const headers = table[0].map(headerKey);
  const dateIndex = columnIndex(headers, ["date", "posted_on"]);
  const descriptionIndex = columnIndex(headers, ["description"]);
  const counterpartyIndex = columnIndex(headers, ["counterparty"]);
  const amountIndex = columnIndex(headers, ["amount"]);
  const currencyIndex = columnIndex(headers, ["currency"]);
  const referenceIndex = columnIndex(headers, ["reference", "external_ref"]);
  const directionIndex = columnIndex(headers, ["direction"]);
  const signedAmount = directionIndex === -1;

  if (dateIndex === -1 || amountIndex === -1 || currencyIndex === -1 || (signedAmount && descriptionIndex === -1)) {
    return { ok: false, error: HEADER_HELP };
  }

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return { ok: false, error: `El archivo tiene más de ${MAX_ROWS} filas.` };
  }

  const rows: ParsedBankRow[] = [];
  const rejected: RejectedBankRow[] = [];

  dataRows.forEach((cells, offset) => {
    const rowNumber = offset + 2;
    const cell = (index: number) => (index === -1 ? "" : (cells[index] ?? "").trim());
    const problems: string[] = [];

    const postedOn = cell(dateIndex);
    if (!isCalendarDate(postedOn)) problems.push("date debe ser una fecha real YYYY-MM-DD");

    const currency = cell(currencyIndex).toUpperCase();
    let amountMinor = 0;
    if (signedAmount) {
      const parsed = parseSignedAmount(cell(amountIndex), currency);
      if (!parsed.ok) problems.push(parsed.error);
      else amountMinor = parsed.amountMinor;
    } else {
      const direction = cell(directionIndex).toLowerCase();
      if (direction !== "debit" && direction !== "credit") problems.push("direction debe ser debit o credit");
      const parsed = parseSignedAmount(cell(amountIndex), currency);
      if (!parsed.ok) problems.push(parsed.error);
      else if (cell(amountIndex).trim().startsWith("-")) problems.push("Con direction, amount va sin signo");
      else amountMinor = direction === "debit" ? -parsed.amountMinor : parsed.amountMinor;
    }

    const description = cell(descriptionIndex) || cell(counterpartyIndex);
    if (description.length === 0) problems.push("description es obligatoria");
    else if (description.length > MAX_CELL_LENGTH) problems.push("description es demasiado larga");
    else if (isFormula(description)) problems.push("description parece una fórmula de hoja de cálculo");

    const reference = cell(referenceIndex);
    let externalRef: string | null = null;
    if (reference.length > 0) {
      if (reference.length > 200) problems.push("reference admite como máximo 200 caracteres");
      else if (isFormula(reference)) problems.push("reference parece una fórmula de hoja de cálculo");
      else externalRef = reference;
    }

    if (problems.length > 0) {
      rejected.push({ rowNumber, message: problems.join(". ") });
      return;
    }
    rows.push({ rowNumber, postedOn, amountMinor, currency, description, externalRef });
  });

  return { ok: true, rows, rejected };
}

function parseSignedAmount(raw: string, currency: string): { ok: true; amountMinor: number } | { ok: false; error: string } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, error: "amount es obligatorio" };
  if (/[eE,]/.test(value) || value.startsWith("+")) {
    return { ok: false, error: "amount debe ser un decimal con punto, por ejemplo -20.00" };
  }
  const negative = value.startsWith("-");
  const parsed = parseAmountToMinor(negative ? value.slice(1).trim() : value, currency);
  if (!parsed.ok) return parsed;
  if (parsed.amountMinor === 0) return { ok: false, error: "amount no puede ser cero" };
  return { ok: true, amountMinor: negative ? -parsed.amountMinor : parsed.amountMinor };
}
