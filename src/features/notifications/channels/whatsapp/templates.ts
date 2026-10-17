import type { NotificationEventType, NotificationIntent } from "@/shared/schemas/notification";

// Registro de plantillas WhatsApp por evento. Los nombres deben coincidir con las plantillas
// APROBADAS en Meta Business Manager (bloqueo externo antes de enviar de verdad).
// Cada plantilla: {{1}} proveedor, {{2}} nº factura, {{3}} importe, {{4}} códigos de motivo; botón URL → dashboard.

export type WhatsAppTemplateDefinition = {
  name: string;
  languageCode: string;
  bodyParams: (intent: NotificationIntent) => string[];
};

const MAX_TEXT_LENGTH = 60;
const UNKNOWN = "No disponible";

// Texto de documentos = no confiable: una sola línea, sin enlaces ni caracteres de control, truncado.
export function sanitizeUntrustedText(value: string | null): string {
  if (value === null) {
    return UNKNOWN;
  }
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, "[enlace]")
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) {
    return UNKNOWN;
  }
  return cleaned.length > MAX_TEXT_LENGTH ? `${cleaned.slice(0, MAX_TEXT_LENGTH - 1)}…` : cleaned;
}

// Formatea unidades menores usando la escala real de la moneda (sin floats: división entera + resto).
export function formatAmountMinor(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || currency === null) {
    return UNKNOWN;
  }
  let digits: number;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return UNKNOWN; // moneda no comparable ⇒ no inventar formato
  }
  const factor = 10 ** digits;
  const whole = Math.trunc(amountMinor / factor);
  const fraction = String(amountMinor % factor).padStart(digits, "0");
  return `${whole}${digits > 0 ? `.${fraction}` : ""} ${currency}`;
}

function commonParams(intent: NotificationIntent): string[] {
  return [
    sanitizeUntrustedText(intent.supplierName),
    sanitizeUntrustedText(intent.invoiceNumber),
    formatAmountMinor(intent.amountMinor, intent.currency),
    intent.reasonCodes.join(", "), // enum cerrado: seguro
  ];
}

export const WHATSAPP_TEMPLATES: Record<NotificationEventType, WhatsAppTemplateDefinition> = {
  approval_requested: { name: "pacta_approval_requested", languageCode: "es", bodyParams: commonParams },
  approval_resolved: { name: "pacta_approval_resolved", languageCode: "es", bodyParams: commonParams },
  decision_blocked: { name: "pacta_decision_status", languageCode: "es", bodyParams: commonParams },
  decision_approved_simulated: { name: "pacta_decision_status", languageCode: "es", bodyParams: commonParams },
};

// Sufijo del botón URL dinámico: la ruta sin la barra inicial.
export function deepLinkSuffix(intent: NotificationIntent): string {
  return intent.deepLinkPath.replace(/^\//, "");
}
