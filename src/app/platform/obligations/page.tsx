/**
 * Purpose: las obligaciones (nómina, impuestos) ahora se crean y se siguen desde Contratos; esta
 *   ruta antigua solo redirige para no romper enlaces guardados.
 * Runs in: server.
 * Triggered by: GET /platform/obligations.
 * Receives → Returns: petición → redirección a /platform/contracts.
 * Talks to: next/navigation.
 */
import { redirect } from "next/navigation";

export default function ObligationsRedirect() {
  redirect("/platform/contracts");
}
