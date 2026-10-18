import { NextResponse } from "next/server";
import { readClock } from "@/features/obligations/clock";
import { defaultRuntime, getLearnedProvider, organizationsWithActiveObligations } from "@/features/obligations/server";
import { openFixturePayroll } from "@/features/obligations/runner";
import { runTick } from "@/features/obligations/tick";
import { verifyCronRequest } from "@/lib/cron";
import { devToolsEnabled } from "@/shared/config/dev-tools";

// Cron de las obligaciones (Vercel Cron). Recorre las organizaciones con una plantilla activa y ejecuta el tick con su reloj
// (el de demo solo si las herramientas de prueba están activas). Idempotente: repetirlo no duplica fases, decisiones ni pagos.
// Falla cerrada: sin CRON_SECRET o con un secreto distinto no hace nada.
export async function GET(request: Request) {
  let authorized = false;
  try {
    authorized = verifyCronRequest(request);
  } catch {
    return NextResponse.json({ error: "Cron no configurado" }, { status: 503 });
  }
  if (!authorized) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const runtime = defaultRuntime();
  const summary = { organizations: 0, ran: 0, skipped: 0, failed: 0 };
  for (const organizationId of await organizationsWithActiveObligations()) {
    const clock = await readClock(runtime.store, organizationId, { demoEnabled: devToolsEnabled() });
    const report = await runTick({ runtime, organizationId, now: clock.now, openFacts: openFixturePayroll, learned: getLearnedProvider() });
    summary.organizations++;
    for (const entry of report.entries) {
      if (entry.outcome === "ran") summary.ran++;
      else if (entry.outcome === "failed") summary.failed++;
      else summary.skipped++;
    }
  }
  return NextResponse.json({ ok: summary.failed === 0, ...summary });
}
