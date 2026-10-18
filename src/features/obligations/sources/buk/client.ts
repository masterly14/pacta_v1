/**
 * FIXTURE / Pacta — Cliente mínimo de la API de Buk (solo lectura, solo los GET que Pacta usa).
 * Autenticación documentada: header `auth_token: <API Key>` (securityDefinitions.auth_token, in: header).
 * Base documentada: https://{TENANT}.buk.co/api/v1/colombia  (basePath del Swagger: /api/v1/colombia)
 * Paginación documentada: `{ pagination: { next, previous, count, total_pages }, data: [...] }`, page_size 25–100.
 */
import type { z } from "zod";

export type Query = Record<string, string>;

export interface BukTransport {
  /** GET relativo al basePath (p. ej. "/employees/active"). Devuelve el JSON crudo. */
  get(path: string, query: Query): Promise<unknown>;
  /** GET de una URL absoluta tomada de `pagination.next`. */
  getUrl(url: string): Promise<unknown>;
}

export class BukHttpError extends Error {
  constructor(public status: number, public body: unknown, url: string) {
    super(`Buk HTTP ${status} en ${url}`);
  }
}

/** Transporte HTTP real (sirve igual para el tenant real o para el mock server). */
export class HttpTransport implements BukTransport {
  constructor(private baseUrl: string, private token: string, private fetchImpl: typeof fetch = fetch) {}
  async get(path: string, query: Query): Promise<unknown> {
    const qs = new URLSearchParams(query).toString();
    return this.getUrl(`${this.baseUrl.replace(/\/$/, "")}${path}${qs ? `?${qs}` : ""}`);
  }
  async getUrl(url: string): Promise<unknown> {
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json", auth_token: this.token } });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new BukHttpError(res.status, body, url);
    return body;
  }
}

export class BukClient {
  constructor(private transport: BukTransport, private pageSize = 100) {}

  async getOne<S extends z.ZodType>(path: string, query: Query, schema: S, onRaw?: (raw: unknown) => void): Promise<z.infer<S>> {
    const raw = await this.transport.get(path, query);
    onRaw?.(raw);
    return schema.parse(raw);
  }

  /** Recorre todas las páginas siguiendo `pagination.next`. */
  async listAll<T>(
    path: string,
    query: Query,
    schema: z.ZodType<{ pagination: { next?: string | null | undefined }; data: T[] }>,
    /** Recibe cada página cruda (para congelar evidencia con hash). */
    onRawPage?: (raw: unknown) => void,
  ): Promise<T[]> {
    const out: T[] = [];
    let raw = await this.transport.get(path, { ...query, page_size: String(this.pageSize) });
    onRawPage?.(raw);
    let page = schema.parse(raw);
    out.push(...page.data);
    let guard = 0;
    while (page.pagination.next) {
      if (++guard > 500) throw new Error("Paginación sin fin");
      raw = await this.transport.getUrl(page.pagination.next);
      onRawPage?.(raw);
      page = schema.parse(raw);
      out.push(...page.data);
    }
    return out;
  }
}

/** Formatos de fecha que pide cada endpoint según la doc. */
export const bukDate = {
  /** /payroll_detail/month?date= usa DD-MM-YYYY */
  ddmmyyyy: (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  },
  /** /employees/active?date=, /absences/licence?from=&to= usan YYYY-MM-DD */
  iso: (iso: string) => iso,
};
