/**
 * Purpose: las corridas de pago ahora se siguen dentro del contrato proactivo de nómina, en
 *   /obligations/payroll; esta ruta antigua solo redirige para no romper enlaces guardados.
 * Runs in: server.
 * Triggered by: GET /platform/runs.
 * Receives → Returns: petición → redirección al flujo de nómina.
 * Talks to: next/navigation.
 */
import { redirect } from "next/navigation";

export default function RunsRedirect() {
  redirect("/obligations/payroll");
}
