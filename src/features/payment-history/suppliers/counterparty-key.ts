import {
  AUTO_CREATE_MIN_TOKEN_LENGTH,
  GENERIC_TOKENS,
  KEY_MAX_TOKENS,
  LEGAL_SUFFIXES,
  NOISE_TOKENS,
} from "../config";

// Clave estable de la contraparte de un movimiento, derivada de su descripción bancaria.
// Es dato no confiable procesado de forma determinística: el texto nunca se interpreta como instrucción.
// Es también el `normalizedName` de los proveedores que se crean desde el banco (índice único por organización).

function tokenize(description: string): string[] {
  return description
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0);
}

// null = no hay contraparte identificable (vacío, solo dígitos o solo palabras genéricas): no se asocia.
export function extractCounterpartyKey(description: string): string | null {
  const tokens = tokenize(description).filter(
    (token) =>
      token.length >= 2 &&
      !/\d/.test(token) &&
      !NOISE_TOKENS.has(token) &&
      !GENERIC_TOKENS.has(token) &&
      !LEGAL_SUFFIXES.has(token),
  );
  if (tokens.length === 0) return null;
  return tokens.slice(0, KEY_MAX_TOKENS).join(" ");
}

// Una clave "limpia" tiene al menos un token alfabético con longitud suficiente (requisito de auto-creación).
export function isCleanKey(key: string): boolean {
  return key.split(" ").some((token) => token.length >= AUTO_CREATE_MIN_TOKEN_LENGTH);
}

// Nombre legible propuesto para un proveedor nuevo: "hosting demo" -> "Hosting Demo".
export function proposeSupplierName(key: string): string {
  return key
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}
