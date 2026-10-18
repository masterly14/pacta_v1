import type { NotificationEventType, NotificationIntent } from "@/shared/schemas/notification";
import { DECISION_LABEL, describeReasons } from "../../copy";
import { REPLY_ACTIONS, buildReplyPayload, type ReplyAction } from "../../inbound/reply-reference";

// Registro de plantillas WhatsApp por evento. Los nombres deben coincidir con las plantillas
// APROBADAS en Meta Business Manager (idioma `es`). Texto exacto a registrar: ver
// `WHATSAPP_TEMPLATE_TEXT` al final de este archivo.

export type WhatsAppTemplateDefinition = {
  name: string;
  languageCode: string;
  bodyParams: (intent: NotificationIntent) => string[];
  // `quick_reply`: tres botones que devuelven `acción:solicitud` (pista, nunca autorización).
  // `url`: un botón al dashboard con la ruta como sufijo.
  button: "quick_reply" | "url";
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

// {{1}} proveedor, {{2}} nº factura, {{3}} importe, {{4}} motivo (texto fijo del catálogo).
function commonParams(intent: NotificationIntent): string[] {
  return [
    sanitizeUntrustedText(intent.supplierName),
    sanitizeUntrustedText(intent.invoiceNumber),
    formatAmountMinor(intent.amountMinor, intent.currency),
    describeReasons(intent.reasonCodes),
  ];
}

// {{1}} proveedor, {{2}} nº factura, {{3}} importe, {{4}} estado, {{5}} motivo.
function statusParams(intent: NotificationIntent): string[] {
  const [supplier, invoice, amount, reason] = commonParams(intent) as [string, string, string, string];
  return [supplier, invoice, amount, DECISION_LABEL[intent.decision], reason];
}

export const WHATSAPP_TEMPLATES: Record<NotificationEventType, WhatsAppTemplateDefinition> = {
  approval_requested: { name: "pacta_aprobacion_requerida", languageCode: "es", bodyParams: commonParams, button: "quick_reply" },
  approval_resolved: { name: "pacta_aprobacion_resuelta", languageCode: "es", bodyParams: statusParams, button: "url" },
  decision_blocked: { name: "pacta_estado_factura", languageCode: "es", bodyParams: statusParams, button: "url" },
  decision_approved_simulated: { name: "pacta_estado_factura", languageCode: "es", bodyParams: statusParams, button: "url" },
};

// Sufijo del botón URL dinámico: la ruta sin la barra inicial.
export function deepLinkSuffix(intent: NotificationIntent): string {
  return intent.deepLinkPath.replace(/^\//, "");
}

// Carga de cada botón de respuesta rápida, en el orden en que se registran en la plantilla
// (índices 0, 1, 2 = Pagar, Rechazar, Más detalles). Exige una solicitud de aprobación.
export function quickReplyPayloads(intent: NotificationIntent): { index: "0" | "1" | "2"; action: ReplyAction; payload: string }[] {
  const approvalRequestId = intent.approvalRequestId;
  if (approvalRequestId === null) {
    throw new Error("Los botones de respuesta exigen approvalRequestId");
  }
  const indexes = ["0", "1", "2"] as const;
  return REPLY_ACTIONS.map((action, position) => ({
    index: indexes[position]!,
    action,
    payload: buildReplyPayload(action, approvalRequestId),
  }));
}

// Texto exacto que debe registrarse en Meta Business Manager (categoría Utilidad, idioma Español).
export const WHATSAPP_TEMPLATE_TEXT = {
  pacta_aprobacion_requerida: {
    body: "Una factura necesita tu aprobación.\n\nProveedor: {{1}}\nFactura: {{2}}\nImporte: {{3}}\nMotivo: {{4}}\n\nElige una opción:",
    buttons: ["Pagar", "Rechazar", "Más detalles"], // respuesta rápida
  },
  pacta_aprobacion_resuelta: {
    body: "Una persona resolvió una solicitud de aprobación.\n\nProveedor: {{1}}\nFactura: {{2}}\nImporte: {{3}}\nEstado: {{4}}\nMotivo: {{5}}",
    buttons: ["Ver en Pacta"], // URL dinámica: <APP_URL>/{{1}}
  },
  pacta_estado_factura: {
    body: "Actualización de una factura.\n\nProveedor: {{1}}\nFactura: {{2}}\nImporte: {{3}}\nEstado: {{4}}\nMotivo: {{5}}",
    buttons: ["Ver en Pacta"], // URL dinámica: <APP_URL>/{{1}}
  },
} as const;
