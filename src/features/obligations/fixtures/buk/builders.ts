/**
 * FIXTURE / Pacta — Constructores con la forma EXACTA de la doc de Buk Colombia (colaborador, liquidación, página),
 * la plantilla de 12 personas ficticias y las constantes de la empresa "Andina Demo S.A.S.".
 * Todo es ficticio: personas, documentos (prefijo 999, inválidos a propósito), cuentas (solo ****1234). Dinero simulado.
 * Los usan el generador de escenarios (`generate.ts`) y el de historia (`history.ts`).
 *
 * Cifras de referencia (públicas): SMMLV 2026 = $1.750.905 (Decreto 159 de 2026), auxilio de transporte = $249.095.
 * Cálculo de nómina SIMPLIFICADO para fixture: salud 4 % + pensión 4 % (+1 % FSP desde 4 SMMLV), sin retención en la fuente.
 */
import type { ObligationTemplate } from "@/shared/schemas/obligation-config";

export const SMMLV = 1_750_905;
export const AUX = 249_095;
export const TENANT = "andina-demo-fixture.buk.co"; // ficticio
export const ORG = "Andina Demo S.A.S.";
export const FIXTURE_ATTR = { pacta_fixture: "FICTICIO - dato de prueba de Pacta, no es una persona real" };

export type Bank = { bank: string; account_type: "Ahorro" | "Corriente"; last4: string };
export interface Person {
  id: number;
  first: string;
  surname: string;
  second: string;
  gender: "M" | "F";
  birthday: string;
  since: string;
  wage: number;
  role: number;
  area: number;
  district: string;
  bankInfo: Bank;
  eps: string;
  afp: string;
  ces: string;
}

// ---------- Plantilla de 12 personas ficticias ----------
export const P = (
  id: number, first: string, surname: string, second: string, gender: "M" | "F", birthday: string, since: string,
  wage: number, area: number, role: number, district: string, bankInfo: Bank, eps: string, afp: string, ces: string,
): Person => ({ id, first, surname, second, gender, birthday, since, wage, area, role, district, bankInfo, eps, afp, ces });

export const ROSTER: Person[] = [
  P(1001, "Valentina", "Rojas", "Castaño", "F", "1993-04-11", "2022-02-01", 3_200_000, 10, 101, "Chapinero", { bank: "Bancolombia", account_type: "Ahorro", last4: "4821" }, "eps_sura", "porvenir", "porvenir"),
  P(1002, "Andrés Felipe", "Arango", "Ríos", "M", "1990-09-23", "2021-06-15", 6_500_000, 20, 201, "Usaquén", { bank: "Banco Davivienda", account_type: "Ahorro", last4: "7310" }, "compensar", "proteccion", "proteccion"),
  P(1003, "Laura Marcela", "Gómez", "Ospina", "F", "1999-01-30", "2024-03-04", SMMLV, 10, 102, "Kennedy", { bank: "Banco de Bogotá", account_type: "Ahorro", last4: "1157" }, "famisanar", "colpensiones", "porvenir"),
  P(1004, "Juan Sebastián", "Martínez", "Duque", "M", "1988-12-02", "2020-08-10", 4_200_000, 30, 301, "Fontibón", { bank: "BBVA Colombia", account_type: "Corriente", last4: "9046" }, "eps_sura", "proteccion", "proteccion"),
  P(1005, "Camila Andrea", "Torres", "Restrepo", "F", "1995-06-17", "2023-01-16", 3_800_000, 20, 202, "Teusaquillo", { bank: "Bancolombia", account_type: "Ahorro", last4: "4417" }, "compensar", "porvenir", "porvenir"),
  P(1006, "Diego Alejandro", "Herrera", "Mejía", "M", "1992-03-08", "2022-10-03", 2_800_000, 40, 401, "Suba", { bank: "Banco de Occidente", account_type: "Ahorro", last4: "6602" }, "sanitas", "porvenir", "porvenir"),
  P(1007, "Natalia", "Ramírez", "Zuluaga", "F", "1986-11-21", "2019-04-01", 5_600_000, 10, 103, "Chapinero", { bank: "Banco AV Villas", account_type: "Ahorro", last4: "3389" }, "eps_sura", "proteccion", "proteccion"),
  P(1008, "Carlos Mario", "Londoño", "Vélez", "M", "1997-07-14", "2023-07-03", 1_900_000, 30, 302, "Bosa", { bank: "Banco Popular", account_type: "Ahorro", last4: "5524" }, "famisanar", "colpensiones", "fondo_nacional_del_ahorro"),
  P(1009, "María José", "Cárdenas", "Giraldo", "F", "1994-02-27", "2023-05-02", 3_400_000, 50, 501, "Engativá", { bank: "Banco Caja Social BCSC", account_type: "Ahorro", last4: "8873" }, "compensar", "porvenir", "porvenir"),
  P(1010, "Felipe", "Ortiz", "Salazar", "M", "1985-05-05", "2018-09-17", 8_200_000, 20, 203, "Usaquén", { bank: "Banco Itau", account_type: "Corriente", last4: "2290" }, "sanitas", "proteccion", "proteccion"),
  P(1011, "Daniela", "Suárez", "Montoya", "F", "1998-08-19", "2024-06-04", 2_400_000, 50, 502, "Puente Aranda", { bank: "Lulo Bank S.A", account_type: "Ahorro", last4: "7765" }, "eps_sura", "porvenir", "porvenir"),
  P(1012, "Julián David", "Moreno", "Patiño", "M", "1996-10-09", "2022-11-21", 2_600_000, 40, 402, "Kennedy", { bank: "Bancoomeva", account_type: "Ahorro", last4: "4038" }, "coomeva", "colfondos", "colfondos"),
];
export const NEW_HIRE = P(1013, "Sara Lucía", "Bermúdez", "Quintero", "F", "2000-12-12", "2026-10-01", 2_900_000, 40, 403, "Suba", { bank: "Nequi", account_type: "Ahorro", last4: "6150" }, "compensar", "porvenir", "porvenir");

export const idx = (p: Person) => p.id - 1000;
export const rut = (p: Person) => `999000${p.id}`; // 10 dígitos, prefijo 999: documento FALSO a propósito
export const jobId = (p: Person) => 2000 + idx(p);
export const personId = (p: Person) => 5000 + idx(p);
export const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(" ")[0];

export interface EmpState {
  p: Person;
  status: "activo" | "inactivo";
  activeUntil: string | null;
  terminationReason: string | null;
  bankInfo: Bank;
}
export const st = (p: Person, o: Partial<EmpState> = {}): EmpState => ({ p, status: "activo", activeUntil: null, terminationReason: null, bankInfo: p.bankInfo, ...o });

// ---------- Constructores con la forma EXACTA de la doc de Buk ----------
export function employeeJson(s: EmpState) {
  const p = s.p;
  return {
    document_number: rut(p),
    document_type: "cc",
    period_type: "mensual",
    person_id: personId(p),
    id: p.id,
    picture_url: null,
    first_name: p.first,
    surname: p.surname,
    second_surname: p.second,
    full_name: `${p.first} ${p.surname} ${p.second}`,
    rut: rut(p),
    code_sheet: `AND-${String(idx(p)).padStart(3, "0")}`,
    email: `${slug(p.first)}.${slug(p.surname)}@andina-demo.example`,
    personal_email: null,
    address: `Calle Ficticia ${idx(p)} # ${10 + idx(p)}-${20 + idx(p)}`,
    district: p.district,
    location_id: 11001,
    region: "Bogotá D.C.",
    office_phone: null,
    phone: `300 000 ${String(1000 + idx(p))}`, // ficticio
    gender: p.gender,
    birthday: p.birthday,
    university: null,
    degree: null,
    active_since: p.since,
    status: s.status,
    payment_currency: "COP",
    payment_method: "Transferencia Bancaria",
    bank: s.bankInfo.bank,
    account_type: s.bankInfo.account_type,
    account_number: `****${s.bankInfo.last4}`,
    payment_document_type: "cc",
    payment_document_number: rut(p),
    private_role: false,
    progressive_vacations_start: null,
    nationality: "CO",
    country_code: "CO",
    civil_status: idx(p) % 3 === 0 ? "Casado" : "Soltero",
    health_company: p.eps,
    pension_regime: null,
    pension_fund: p.afp,
    afc: null, // en Colombia AFC es una cuenta de ahorro (Fomento a la Construcción); no aplica al fixture
    custom_attributes: FIXTURE_ATTR,
    active_until: s.activeUntil,
    termination_reason: s.terminationReason,
    current_job: {
      id: jobId(p),
      company_id: 1,
      start_date: p.since,
      type_of_contract: "Indefinido",
      end_of_contract: null,
      notice_date: null,
      regular_hours: 42,
      risk_type: "minimo",
      end_date: s.activeUntil,
      contract_finishing_date_1: null,
      contract_finishing_date_2: null,
      cost_center: `CC-${p.area}`,
      periodicity: "mensual",
      zone_assignment: false,
      custom_attributes: {},
      area_id: p.area,
      role_id: p.role,
      leader_id: 1010,
      retention_taxes: "procedimiento_1",
      retention_taxes_type: "automatic_retention_rate",
      retention_taxes_rate: 0,
      currency_code: "COP",
      wage: p.wage,
      wage_type: "fijo",
      boss: { document_number: rut(ROSTER[9]!), document_type: "cc", id: 1010, rut: rut(ROSTER[9]!) },
      without_wage: false,
    },
    family_responsabilities: null,
  };
}

export const line = (type: string, name: string, amount: number, code: string, o: { taxable?: boolean; imponible?: boolean; institution?: string | null } = {}) => ({
  type,
  subtype: null,
  income_type: null,
  name,
  amount,
  resettlement: false,
  taxable: o.taxable ?? type === "haber",
  imponible: o.imponible ?? type === "haber",
  anticipo: false,
  credit_type: null,
  institution: o.institution ?? null,
  description: null,
  code,
  item_code: null,
});

export interface SettleOpts {
  workedDays?: number;
  bonus?: number;
  incapacityDays?: number;
  prima?: boolean | "missing";
  /** Prima con un monto distinto al que espera el calendario de beneficios (COP). */
  primaAmount?: number;
  /** Otros haberes imponibles del mes (p. ej. recargos). Sin ellos, la liquidación es idéntica a la de siempre. */
  extras?: { code: string; name: string; amount: number }[];
  liqId: number;
}
export function settlementJson(p: Person, month: string, o: SettleOpts) {
  const [year, mm] = month.split("-") as [string, string];
  const worked = o.workedDays ?? 30 - (o.incapacityDays ?? 0);
  const daily = p.wage / 30;
  const salary = Math.round(daily * worked);
  const auxEligible = p.wage <= 2 * SMMLV;
  const aux = auxEligible ? Math.round((AUX * worked) / 30) : 0;
  const incap = o.incapacityDays ? Math.round(Math.max(daily * 0.6667, SMMLV / 30) * o.incapacityDays) : 0;
  const bonus = o.bonus ?? 0;
  const prima = o.prima === true ? (o.primaAmount ?? Math.round((p.wage + (auxEligible ? AUX : 0)) / 2)) : 0; // semestre completo: (salario+aux)*180/360
  const extras = (o.extras ?? []).reduce((sum, x) => sum + x.amount, 0);
  const ibc = salary + incap + bonus + extras;
  const salud = Math.round(ibc * 0.04);
  const pension = Math.round(ibc * 0.04);
  const fsp = ibc >= 4 * SMMLV ? Math.round(ibc * 0.01) : 0;
  const lines = [line("haber", "Sueldo", salary, "sueldo")];
  if (incap) lines.push(line("haber", "Incapacidad general", incap, "incapacidad_general"));
  if (bonus) lines.push(line("haber", "Bonificación por desempeño", bonus, "bonificacion"));
  for (const x of o.extras ?? []) lines.push(line("haber", x.name, x.amount, x.code));
  if (aux) lines.push(line("haber", "Auxilio de transporte", aux, "aux_transporte", { imponible: false, taxable: false }));
  if (prima) lines.push(line("haber", "Prima de servicios", prima, "prima_servicios", { imponible: false }));
  lines.push(line("descuento", "Salud", salud, "salud", { institution: p.eps }));
  lines.push(line("descuento", "Pensión", pension, "pension", { institution: p.afp }));
  if (fsp) lines.push(line("descuento", "Fondo de solidaridad pensional", fsp, "fondo_solidaridad", { institution: p.afp }));
  const gross = salary + incap + bonus + extras + aux + prima;
  const legal = salud + pension + fsp;
  const net = gross - legal;
  return {
    liquidacion_id: o.liqId,
    person_id: personId(p),
    employee_id: p.id,
    month: mm,
    year,
    worked_days: worked,
    noworked_days: 30 - worked,
    income_gross: gross,
    income_net: net,
    income_afp: ibc,
    income_ips: 0,
    total_income_taxable: ibc,
    total_income_notaxable: aux + prima,
    total_legal_discounts: legal,
    total_other_discounts: 0,
    closed: true,
    liquid_reach: net,
    taxable_base: ibc,
    rut: rut(p),
    lines_settlement: lines,
  };
}

export const page = <T>(data: T[]) => ({ pagination: { next: null, previous: null, count: data.length, total_pages: 1 }, data });

/** Licencia o incapacidad (GET /absences/licence) con la forma de la doc de Buk. Ficticia. */
export function licenceJson(employeeId: number, id: number, start: string, days: number) {
  const end = new Date(Date.parse(`${start}T00:00:00Z`) + (days - 1) * 86400000).toISOString().slice(0, 10);
  return {
    id, start_date: start, end_date: end, days_count: days, day_percent: 1, contribution_days: 2, workday_stage: "full_working_day",
    application_date: start, application_end_date: end, justification: "Incapacidad por enfermedad general (FICTICIO)", employee_id: employeeId,
    status: "aprobado", created_at: start, updated_at: start, licence_type_id: 3, format: "electronica", type: "remunerada",
    codigo_incapacidad_colombia: "J069", descripcion_codigo_incapacidad_colombia: "INFECCION AGUDA DE LAS VIAS RESPIRATORIAS SUPERIORES, NO ESPECIFICADA",
    licence_type_code: "incapacidad_enfermedad_general", licence_number: "FICT-000123", medic_name: "Médico Ficticio", custom_attributes: {}, medic_rut: "9990009999",
  };
}


/** Plantilla base de nómina de la empresa ficticia (los escenarios pueden sobrescribir campos). */
export const OBLIGATION_BASE: ObligationTemplate = {
  schemaVersion: 1,
  obligationId: "obl_nomina_andina",
  organizationId: "org_andina_demo",
  kind: "payroll",
  calendar: { kind: "payroll", frequency: "monthly", anchor: "month_end" },
  currency: "COP",
  varianceToleranceBps: 1000, // 10 % (valor por defecto del contrato compartido)
  runCapMinor: 12_000_000_000, // $120.000.000 COP
  evidenceMaxAgeDays: 2, // supuesto del mock: el contrato compartido propone 7
  earlyAlertDays: 7,
  urgentAlertDays: 3,
  version: 1,
  status: "active",
  activatedBy: "usr_santiago_demo",
  activatedAt: "2026-09-01T14:00:00Z",
  dataOrigin: "fixture",
};
export const DEFAULT_TREASURY = { fundsAvailableMinor: 8_000_000_000, fundsReservedMinor: 0 }; // $80.000.000 COP
