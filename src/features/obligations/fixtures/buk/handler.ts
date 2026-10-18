/**
 * FIXTURE / Pacta — Handler del mock de Buk basado en la Web Fetch API (Request -> Response).
 * Se monta igual en Node (server.ts), en un Route Handler de Next.js (examples/next-route-handler.ts) o en MSW.
 *
 * URL: /{escenario}/api/v1/colombia/{ruta documentada}?{query}
 *   ej. /nomina-anomalias/api/v1/colombia/payroll_detail/month?date=01-10-2026
 */
import { listScenarios, loadManifest, readScenarioJson, resolveRoute } from "./manifest";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-pacta-fixture": "true", "x-pacta-simulated-money": "true" },
  });

export async function handleBukMock(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET") return json(405, { errors: ["Solo lectura: el mock implementa únicamente los GET que Pacta usa"] });
  if (url.pathname === "/" || url.pathname === "/health") {
    return json(200, { fixture: true, provider: "buk-colombia (mock)", scenarios: listScenarios() });
  }
  const m = url.pathname.match(/^\/([a-z0-9-]+)\/api\/v1\/colombia(\/.*)$/);
  if (!m) return json(404, { errors: ["Ruta no reconocida. Use /{escenario}/api/v1/colombia/..."] });
  const [, scenario, path] = m as unknown as [string, string, string];
  if (!listScenarios().includes(scenario)) return json(404, { errors: [`Escenario desconocido: ${scenario}`] });

  // Autenticación documentada: header auth_token. El mock acepta cualquier valor no vacío.
  if (!req.headers.get("auth_token")) return json(401, { errors: ["Falta el header auth_token"] });

  const query = Object.fromEntries(url.searchParams);
  if (query.page_size !== undefined) {
    const n = Number(query.page_size);
    // Doc: "debe estar entre un rango de [25 - 100]". [PACTA-ASUNCIÓN] fuera de rango -> 400 { errors }.
    if (!Number.isInteger(n) || n < 25 || n > 100) return json(400, { errors: ["page_size debe estar entre 25 y 100"] });
  }

  const manifest = loadManifest(scenario);
  let route = resolveRoute(manifest, path, query);

  // Doc de GET /employees/{id}: acepta ID o número de documento (sin puntos ni guion).
  const byDoc = path.match(/^\/employees\/(\d{6,})$/);
  if (!route && byDoc) {
    route =
      manifest.routes.find((r) => r.endpoint === "GET /employees/{id}" && (readScenarioJson<{ rut?: string }>(scenario, r.file).rut ?? "") === byDoc[1]) ?? null;
  }
  if (!route) return json(404, { errors: ["No Existe el recurso solicitado"] });
  return json(200, readScenarioJson(scenario, route.file));
}
