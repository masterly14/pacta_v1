import { Resend } from "resend";

// Cliente de Resend creado de forma perezosa: no falla al importar el módulo
// (por ejemplo durante el build) si la clave aún no está configurada.
let client: Resend | undefined;

export function getResend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY no está definida");
    }
    client = new Resend(apiKey);
  }
  return client;
}
