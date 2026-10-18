import { handleBukMock } from "@/features/obligations/fixtures/buk/handler";
import { devToolsEnabled } from "@/shared/config/dev-tools";

// FIXTURE: API simulada de Buk (nómina de Colombia) con datos ficticios de "Andina Demo S.A.S.".
// Oculta salvo PACTA_SHOW_DEV_TOOLS=true y, además, protegida por la sesión de Clerk (src/proxy.ts).
// La app no llama a este endpoint por red: el adaptador usa el mismo handler en proceso.
// URL: /api/mock/buk/{escenario}/api/v1/colombia/{ruta documentada de Buk}
export async function GET(request: Request): Promise<Response> {
  if (!devToolsEnabled()) return new Response("No encontrado", { status: 404 });
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api\/mock\/buk/, "");
  return handleBukMock(new Request(url, { headers: request.headers }));
}
