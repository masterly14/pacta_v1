/**
 * Purpose: autenticación del cron de las obligaciones. Vercel Cron envía `Authorization: Bearer <CRON_SECRET>`; sin ese
 *   secreto nadie puede disparar el tick por HTTP. La comparación es en tiempo constante.
 * Runs in: servidor (ruta /api/cron/obligations).
 * Receives → Returns: Request → true solo si el secreto configurado coincide.
 * Seguridad: si CRON_SECRET no está definido, la ruta falla cerrada (lanza al leerlo).
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** Lectura perezosa: falla en la primera petición, no al importar el módulo. */
export function getCronSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) throw new Error("CRON_SECRET no está definido (mínimo 16 caracteres)");
  return secret;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

export function verifyCronRequest(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  // Se comparan hashes del mismo largo: no se filtra el tamaño del secreto ni se compara byte a byte con corte temprano.
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(getCronSecret()));
}
