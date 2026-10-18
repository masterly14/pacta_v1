/**
 * FIXTURE — Transporte de Buk en memoria sobre `buildMonth`. Sirve el mismo contrato HTTP que el mock (mismos paths,
 * mismas consultas, mismo sobre paginado), pero sin tocar disco: lo usan el replay del libro y el backtest.
 */
import type { BukTransport, Query } from "../../sources/buk/client";
import { addMonths, buildMonth, lastDayOf, type MonthOptions, type MonthPayloads } from "./history";
import { page } from "./builders";

/** Filas de GET /process_periods para una lista de meses; el último queda abierto. */
export function periodsPage(months: readonly string[]) {
  return page(
    months.map((month, index) => ({
      id: 300 + Number(month.slice(5)) + (Number(month.slice(0, 4)) - 2026) * 12,
      month,
      end_date: lastDayOf(month),
      status: index === months.length - 1 ? "abierto" : "cerrado",
    })),
  );
}

const monthOfIso = (iso: string) => iso.slice(0, 7);
const monthOfDdMmYyyy = (date: string) => {
  const [, mm, yyyy] = date.split("-");
  return `${yyyy}-${mm}`;
};

export class MemoryBukTransport implements BukTransport {
  private cache = new Map<string, MonthPayloads>();

  /** `options(month)` permite inyectar anomalías en meses concretos. */
  constructor(
    private months: readonly string[],
    private options: (month: string) => MonthOptions = () => ({}),
  ) {}

  private month(month: string): MonthPayloads {
    if (!this.months.includes(month)) throw new Error(`Buk (memoria) no tiene el mes ${month}`);
    let payloads = this.cache.get(month);
    if (!payloads) {
      payloads = buildMonth(month, this.options(month));
      this.cache.set(month, payloads);
    }
    return payloads;
  }

  async get(path: string, query: Query): Promise<unknown> {
    if (path === "/process_periods") return periodsPage(this.months);
    if (path === "/employees/active") return this.month(monthOfIso(query.date ?? "")).employeesActive;
    if (path === "/payroll_detail/month") return this.month(monthOfDdMmYyyy(query.date ?? "")).payrollDetail;
    if (path === "/absences/licence") return this.month(monthOfIso(query.from ?? "")).licences;
    if (path === "/jobs/events/terminations") return this.month(monthOfIso(query.start_date ?? "")).terminations;
    const detail = path.match(/^\/employees\/(\d+)$/);
    if (detail) {
      const id = Number(detail[1]);
      for (const month of this.months) {
        const found = this.month(month).employeeDetails[id];
        if (found) return found;
      }
    }
    throw new Error(`Buk (memoria): sin respuesta para GET ${path}`);
  }

  async getUrl(url: string): Promise<unknown> {
    const parsed = new URL(url);
    return this.get(parsed.pathname.replace(/^.*\/api\/v1\/colombia/, ""), Object.fromEntries(parsed.searchParams));
  }
}

export { addMonths };
