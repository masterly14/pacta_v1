// Configuración de WhatsApp Cloud API. Los secretos solo se leen en servidor.

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} no está definida`);
  }
  return value;
}

export function getWhatsAppAppSecret(): string {
  return required("WHATSAPP_APP_SECRET");
}

export function getWhatsAppVerifyToken(): string {
  return required("WHATSAPP_VERIFY_TOKEN");
}

export function getWhatsAppPhoneNumberId(): string {
  return required("WHATSAPP_PHONE_NUMBER_ID");
}

export function getWhatsAppAccessToken(): string {
  return required("WHATSAPP_ACCESS_TOKEN");
}

// Teléfono (E.164, solo dígitos) del administrador que recibe los avisos. Ausente ⇒ WhatsApp
// deshabilitado como respaldo, no error. Los destinatarios guardados en base de datos tienen prioridad.
export function getWhatsAppAdminPhone(): string | null {
  const digits = process.env.WHATSAPP_ADMIN_PHONE?.replace(/\D/g, "");
  return digits ? digits : null;
}
