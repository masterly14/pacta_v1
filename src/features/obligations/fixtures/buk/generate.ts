/**
 * FIXTURE / Pacta — Generador determinista de payloads (forma Buk Colombia) y oráculos.
 * Todo es ficticio: personas, empresa ("Andina Demo S.A.S."), documentos (prefijo 999, inválidos a propósito),
 * cuentas (solo ****1234). Montos: COP plausibles para 2026, ficticios. Dinero simulado.
 *
 * Cifras de referencia (públicas): SMMLV 2026 = $1.750.905 (Decreto 159 de 2026), auxilio de transporte = $249.095.
 * Cálculo de nómina SIMPLIFICADO para fixture: salud 4 % + pensión 4 % (+1 % FSP desde 4 SMMLV), sin retención en la fuente.
 *
 * Uso: npm run mock:generate
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RouteEntry, ScenarioManifest } from "./manifest";
import { EXPECTED_DIR, PAYLOADS_DIR } from "./manifest";
import type { ObligationTemplate } from "@/shared/schemas/obligation-config";

// Vocabulario en español de las especificaciones de escenario. Al escribir los oráculos y la plantilla se traduce
// a los valores de los contratos compartidos (inglés): ver `translate.ts`.
type Decision = "aprobada" | "bloqueada" | "requiere_aprobacion";
type LineType = "salario" | "prima" | "cesantias" | "liquidacion_final";
type ReasonCode =
  | "EMPLEADO_DESVINCULADO"
  | "EMPLEADO_NO_ENCONTRADO"
  | "NOMINA_OMISION"
  | "VARIACION_EXCEDIDA"
  | "BENEFICIO_NO_COINCIDE"
  | "LINEA_DUPLICADA"
  | "FONDOS_INSUFICIENTES"
  | "OBLIGACION_NO_AUTORIZADA"
  | "EVIDENCIA_DESACTUALIZADA"
  | "SENAL_PENDIENTE_REVISION"
  | "BENEFICIARIO_CAMBIADO"
  | "DATOS_INSUFICIENTES"
  | "MONEDA_NO_SOPORTADA";
type RunFinding = { ruleId: "obligacion_autorizada" | "evidencia_vigente" | "corrida_completa" | "fondos_suficientes" };

const DECISION_EN = { aprobada: "approved", bloqueada: "blocked", requiere_aprobacion: "requires_approval" } as const satisfies Record<Decision, string>;
const LINE_TYPE_EN = { salario: "salary", prima: "bonus", cesantias: "severance", liquidacion_final: "final_settlement" } as const satisfies Record<LineType, string>;
const OCCURRENCE_STATUS_EN = { lista_para_ejecutar: "ready_to_execute", en_aprobacion: "in_approval", retenida: "held" } as const;
const REASON_EN = {
  EMPLEADO_DESVINCULADO: "EMPLOYEE_TERMINATED",
  EMPLEADO_NO_ENCONTRADO: "EMPLOYEE_NOT_FOUND",
  NOMINA_OMISION: "PAYROLL_OMISSION",
  VARIACION_EXCEDIDA: "VARIANCE_EXCEEDED",
  BENEFICIO_NO_COINCIDE: "BENEFIT_MISMATCH",
  LINEA_DUPLICADA: "DUPLICATE_LINE",
  FONDOS_INSUFICIENTES: "FUNDS_INSUFFICIENT",
  OBLIGACION_NO_AUTORIZADA: "OBLIGATION_NOT_AUTHORIZED",
  EVIDENCIA_DESACTUALIZADA: "STALE_EVIDENCE",
  SENAL_PENDIENTE_REVISION: "SIGNAL_PENDING_REVIEW",
  BENEFICIARIO_CAMBIADO: "BENEFICIARY_CHANGED",
  DATOS_INSUFICIENTES: "INSUFFICIENT_DATA",
  MONEDA_NO_SOPORTADA: "CURRENCY_NOT_SUPPORTED",
} as const satisfies Record<ReasonCode, string>;

const SMMLV = 1_750_905;
const AUX = 249_095;
const TENANT = "andina-demo-fixture.buk.co"; // ficticio
const ORG = "Andina Demo S.A.S.";
const FIXTURE_ATTR = { pacta_fixture: "FICTICIO - dato de prueba de Pacta, no es una persona real" };

type Bank = { bank: string; account_type: "Ahorro" | "Corriente"; last4: string };
interface Person {
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
const P = (
  id: number, first: string, surname: string, second: string, gender: "M" | "F", birthday: string, since: string,
  wage: number, area: number, role: number, district: string, bankInfo: Bank, eps: string, afp: string, ces: string,
): Person => ({ id, first, surname, second, gender, birthday, since, wage, area, role, district, bankInfo, eps, afp, ces });

const ROSTER: Person[] = [
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
const NEW_HIRE = P(1013, "Sara Lucía", "Bermúdez", "Quintero", "F", "2000-12-12", "2026-10-01", 2_900_000, 40, 403, "Suba", { bank: "Nequi", account_type: "Ahorro", last4: "6150" }, "compensar", "porvenir", "porvenir");

const idx = (p: Person) => p.id - 1000;
const rut = (p: Person) => `999000${p.id}`; // 10 dígitos, prefijo 999: documento FALSO a propósito
const jobId = (p: Person) => 2000 + idx(p);
const personId = (p: Person) => 5000 + idx(p);
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(" ")[0];

interface EmpState {
  p: Person;
  status: "activo" | "inactivo";
  activeUntil: string | null;
  terminationReason: string | null;
  bankInfo: Bank;
}
const st = (p: Person, o: Partial<EmpState> = {}): EmpState => ({ p, status: "activo", activeUntil: null, terminationReason: null, bankInfo: p.bankInfo, ...o });

// ---------- Constructores con la forma EXACTA de la doc de Buk ----------
function employeeJson(s: EmpState) {
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

const line = (type: string, name: string, amount: number, code: string, o: { taxable?: boolean; imponible?: boolean; institution?: string | null } = {}) => ({
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

interface SettleOpts {
  workedDays?: number;
  bonus?: number;
  incapacityDays?: number;
  prima?: boolean | "missing";
  /** Prima con un monto distinto al que espera el calendario de beneficios (COP). */
  primaAmount?: number;
  liqId: number;
}
function settlementJson(p: Person, month: string, o: SettleOpts) {
  const [year, mm] = month.split("-") as [string, string];
  const worked = o.workedDays ?? 30 - (o.incapacityDays ?? 0);
  const daily = p.wage / 30;
  const salary = Math.round(daily * worked);
  const auxEligible = p.wage <= 2 * SMMLV;
  const aux = auxEligible ? Math.round((AUX * worked) / 30) : 0;
  const incap = o.incapacityDays ? Math.round(Math.max(daily * 0.6667, SMMLV / 30) * o.incapacityDays) : 0;
  const bonus = o.bonus ?? 0;
  const prima = o.prima === true ? (o.primaAmount ?? Math.round((p.wage + (auxEligible ? AUX : 0)) / 2)) : 0; // semestre completo: (salario+aux)*180/360
  const ibc = salary + incap + bonus;
  const salud = Math.round(ibc * 0.04);
  const pension = Math.round(ibc * 0.04);
  const fsp = ibc >= 4 * SMMLV ? Math.round(ibc * 0.01) : 0;
  const lines = [line("haber", "Sueldo", salary, "sueldo")];
  if (incap) lines.push(line("haber", "Incapacidad general", incap, "incapacidad_general"));
  if (bonus) lines.push(line("haber", "Bonificación por desempeño", bonus, "bonificacion"));
  if (aux) lines.push(line("haber", "Auxilio de transporte", aux, "aux_transporte", { imponible: false, taxable: false }));
  if (prima) lines.push(line("haber", "Prima de servicios", prima, "prima_servicios", { imponible: false }));
  lines.push(line("descuento", "Salud", salud, "salud", { institution: p.eps }));
  lines.push(line("descuento", "Pensión", pension, "pension", { institution: p.afp }));
  if (fsp) lines.push(line("descuento", "Fondo de solidaridad pensional", fsp, "fondo_solidaridad", { institution: p.afp }));
  const gross = salary + incap + bonus + aux + prima;
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

const page = <T>(data: T[]) => ({ pagination: { next: null, previous: null, count: data.length, total_pages: 1 }, data });

// ---------- Escenarios (§13 del doc de diseño, casos de fuente de RR. HH.) ----------
type Expect = { decision: Decision; reasons: ReasonCode[] };
interface StageSpec {
  stage: "inicial" | "reevaluacion";
  asOf: string; // instante UTC
  description: string;
  /** Clave `<employeeId>:<lineType>` (o `...#2` para la repetición). Las no listadas usan `all` o aprobada. */
  lines?: Record<string, Expect>;
  all?: Expect;
  runFindings?: { ruleId: RunFinding["ruleId"]; code: ReasonCode; effect: "escala" | "bloquea"; employeeId: number | null }[];
  occurrenceStatus: "lista_para_ejecutar" | "en_aprobacion" | "retenida";
}
interface ScenarioSpec {
  name: string;
  description: string;
  month: string;
  /** Instante de la lectura de RR. HH. (colaboradores y nómina), UTC. Default: asOf de la primera evaluación − 5 min. */
  hrCapturedAt?: string;
  states: EmpState[];
  current: { p: Person; opts?: Omit<SettleOpts, "liqId"> }[];
  /** Personas con pago confirmado por Pacta en la corrida anterior (default: ROSTER). */
  confirmedPeople?: Person[];
  terminations?: { p: Person; endDate: string; reason: string }[];
  finiquito?: Person;
  licences?: { p: Person; start: string; days: number }[];
  webhooks?: { file: string; receivedAt: string; body: unknown }[];
  obligation?: Partial<ObligationTemplate>;
  treasury?: { fundsAvailableMinor: number | null; fundsReservedMinor: number | null };
  stages: StageSpec[];
  notes: string[];
}

const empHook = (employee_id: number, date: string, event_type: string, employment_status: string) => ({
  data: { employee_id, date, event_type, tenant_url: TENANT, employment_status },
});

const OCT_ASOF = "2026-10-29T14:00:00Z"; // 09:00 hora de Bogotá
const JUN_ASOF = "2026-06-26T14:00:00Z";
const base12 = () => ROSTER.map((p) => st(p));
const cur = (ps: Person[]) => ps.map((p) => ({ p }));
const R = (id: number) => ROSTER[id - 1001]!;
const ok12 = (desc = "Todo coincide."): StageSpec[] => [{ stage: "inicial", asOf: OCT_ASOF, description: desc, occurrenceStatus: "lista_para_ejecutar" }];

const SCENARIOS: ScenarioSpec[] = [
  {
    name: "nomina-limpia",
    description: "§13 'Nómina limpia': 12 colaboradores activos, plantilla activa, fondos suficientes, montos y cuentas iguales a lo último confirmado. Todas aprobada.",
    month: "2026-10",
    states: base12(),
    current: cur(ROSTER),
    stages: ok12(),
    notes: ["Caso base (sin hallazgos)."],
  },
  {
    name: "nomina-anomalias",
    description:
      "Demo §12: 9 aprobada, 1 bloqueada (retirado en línea ordinaria), 2 requiere_aprobacion (cuenta cambiada, variación excedida). Luego llega el webhook de Buk 'Laura Gómez deja de laborar' y la reevaluación pasa su línea de aprobada a requiere_aprobacion.",
    month: "2026-10",
    states: ROSTER.map((p) =>
      p.id === 1008 ? st(p, { status: "inactivo", activeUntil: "2026-09-30", terminationReason: "renuncia" }) : p.id === 1005 ? st(p, { bankInfo: { bank: "Nequi", account_type: "Ahorro", last4: "9032" } }) : st(p),
    ),
    current: ROSTER.map((p) => ({ p, opts: p.id === 1002 ? { bonus: 2_500_000 } : {} })),
    webhooks: [
      { file: "webhooks/01-job_termination-1008.json", receivedAt: "2026-09-30T22:05:00Z", body: empHook(1008, "2026-09-30T17:05:00-05:00", "job_termination", "terminado") },
      { file: "webhooks/02-employee_update-1005.json", receivedAt: "2026-10-20T16:12:00Z", body: empHook(1005, "2026-10-20T11:12:00-05:00", "employee_update", "activo") },
      { file: "webhooks/03-job_termination-1003.json", receivedAt: "2026-10-29T21:30:00Z", body: empHook(1003, "2026-10-29T16:30:00-05:00", "job_termination", "terminado") },
    ],
    stages: [
      {
        stage: "inicial",
        asOf: OCT_ASOF,
        description: "Evaluación inicial (9 / 1 / 2).",
        lines: {
          "1008:salario": { decision: "bloqueada", reasons: ["EMPLEADO_DESVINCULADO"] },
          "1005:salario": { decision: "requiere_aprobacion", reasons: ["BENEFICIARIO_CAMBIADO"] },
          "1002:salario": { decision: "requiere_aprobacion", reasons: ["VARIACION_EXCEDIDA"] },
        },
        occurrenceStatus: "en_aprobacion",
      },
      {
        stage: "reevaluacion",
        asOf: "2026-10-29T22:00:00Z",
        description: "Webhook job_termination de Laura Marcela Gómez (1003) recibido 16:30 hora de Bogotá, después de la lectura y antes de ejecutar: señal `propuesta`, su línea pasa a requiere_aprobacion (8 / 1 / 3).",
        lines: {
          "1008:salario": { decision: "bloqueada", reasons: ["EMPLEADO_DESVINCULADO"] },
          "1005:salario": { decision: "requiere_aprobacion", reasons: ["BENEFICIARIO_CAMBIADO"] },
          "1002:salario": { decision: "requiere_aprobacion", reasons: ["VARIACION_EXCEDIDA"] },
          "1003:salario": { decision: "requiere_aprobacion", reasons: ["SENAL_PENDIENTE_REVISION"] },
        },
        occurrenceStatus: "en_aprobacion",
      },
    ],
    notes: [
      "1008 (Carlos Mario Londoño) se retiró el 2026-09-30 (active_until) pero aparece con liquidación ordinaria de octubre: bloqueada.",
      "1005 (Camila Torres) cambió de Bancolombia ****4417 a Nequi ****9032: BENEFICIARIO_CAMBIADO.",
      "1002 (Andrés Felipe Arango) trae una bonificación de $2.500.000: neto +37 % vs último monto confirmado (tolerancia 10 %).",
      "1003 (Laura Marcela Gómez): Buk notifica job_termination después de la lectura. La señal solo aumenta cautela; mientras nadie relea/confirme, requiere aprobación (no bloquea).",
    ],
  },
  {
    name: "trampa-plantilla-borrador",
    description: "§13 'Plantilla en borrador': la obligación de nómina no fue activada. Todas las líneas requiere_aprobacion (OBLIGACION_NO_AUTORIZADA).",
    month: "2026-10",
    states: base12(),
    current: cur(ROSTER),
    obligation: { status: "draft", activatedBy: null, activatedAt: null },
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "Regla de corrida obligacion_autorizada escala todas las líneas.", all: { decision: "requiere_aprobacion", reasons: ["OBLIGACION_NO_AUTORIZADA"] }, runFindings: [{ ruleId: "obligacion_autorizada", code: "OBLIGACION_NO_AUTORIZADA", effect: "escala", employeeId: null }], occurrenceStatus: "en_aprobacion" }],
    notes: ["Las líneas individuales están limpias: lo que falla es la autorización de la plantilla (§9 status)."],
  },
  {
    name: "trampa-omision",
    description: "§13 'Empleado activo sin línea': 12 activos en Buk, solo 11 liquidaciones (falta Daniela Suárez, 1011). NOMINA_OMISION escala toda la corrida.",
    month: "2026-10",
    states: base12(),
    current: cur(ROSTER.filter((p) => p.id !== 1011)),
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "corrida_completa escala las 11 líneas.", all: { decision: "requiere_aprobacion", reasons: ["NOMINA_OMISION"] }, runFindings: [{ ruleId: "corrida_completa", code: "NOMINA_OMISION", effect: "escala", employeeId: 1011 }], occurrenceStatus: "en_aprobacion" }],
    notes: ["Ninguna línea individual falla: la omisión solo se ve cruzando GET /employees/active con GET /payroll_detail/month."],
  },
  {
    name: "trampa-duplicado",
    description: "§13 'Línea duplicada': Juan Sebastián Martínez (1004) aparece dos veces (dos liquidacion_id, mismo mes y monto). La repetida se bloquea.",
    month: "2026-10",
    states: base12(),
    current: [...cur(ROSTER), { p: R(1004) }],
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "La primera aparición se aprueba; la repetida se bloquea.", lines: { "1004:salario#2": { decision: "bloqueada", reasons: ["LINEA_DUPLICADA"] } }, occurrenceStatus: "lista_para_ejecutar" }],
    notes: ["Bloqueo absoluto. Las demás líneas aprobadas pueden ejecutarse (la ocurrencia no queda retenida)."],
  },
  {
    name: "trampa-licencia",
    description: "Juan Sebastián Martínez (1004) tiene 12 días de incapacidad en octubre (GET /absences/licence): estado licencia → DATOS_INSUFICIENTES; además su neto baja −13 % → VARIACION_EXCEDIDA. Requiere aprobación.",
    month: "2026-10",
    states: base12(),
    current: ROSTER.map((p) => ({ p, opts: p.id === 1004 ? { incapacityDays: 12 } : {} })),
    licences: [{ p: R(1004), start: "2026-10-05", days: 12 }],
    webhooks: [{ file: "webhooks/01-licence_create-8101.json", receivedAt: "2026-10-05T15:00:00Z", body: { data: { licence_id: 8101, date: "2026-10-05T10:00:00-05:00", event_type: "licence_create", tenant_url: TENANT } } }],
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "empleado_sin_licencia y variacion_aceptable escalan.", lines: { "1004:salario": { decision: "requiere_aprobacion", reasons: ["DATOS_INSUFICIENTES", "VARIACION_EXCEDIDA"] } }, occurrenceStatus: "en_aprobacion" }],
    notes: ["La licencia NO justifica la variación automáticamente: §7.1 manda a humano (DATOS_INSUFICIENTES)."],
  },
  {
    name: "trampa-sin-historial",
    description: "§13 'Sin historial': ingreso nuevo Sara Lucía Bermúdez (1013) desde 2026-10-01. Pacta no tiene monto ni cuenta confirmados → DATOS_INSUFICIENTES.",
    month: "2026-10",
    states: [...base12(), st(NEW_HIRE)],
    current: cur([...ROSTER, NEW_HIRE]),
    webhooks: [{ file: "webhooks/01-job_hire-1013.json", receivedAt: "2026-10-01T13:30:00Z", body: empHook(1013, "2026-10-01T08:30:00-05:00", "job_hire", "activo") }],
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "variacion_aceptable y cuenta_estable sin dato previo.", lines: { "1013:salario": { decision: "requiere_aprobacion", reasons: ["DATOS_INSUFICIENTES"] } }, occurrenceStatus: "en_aprobacion" }],
    notes: ["Sin último monto confirmado no hay base para la variación; sin última cuenta confirmada no se puede afirmar que la cuenta es estable."],
  },
  {
    name: "trampa-prima-sin-concepto",
    description: "§13 'Mes de prima sin el concepto': junio 2026. 11 liquidaciones traen 'Prima de servicios'; la de Natalia Ramírez (1007) no. Su línea de salario requiere aprobación.",
    month: "2026-06",
    states: base12(),
    current: ROSTER.map((p) => ({ p, opts: { prima: p.id === 1007 ? ("missing" as const) : true } })),
    stages: [{ stage: "inicial", asOf: JUN_ASOF, description: "beneficios_esperados: falta la prima de 1007.", lines: { "1007:salario": { decision: "requiere_aprobacion", reasons: ["BENEFICIO_NO_COINCIDE"] } }, occurrenceStatus: "en_aprobacion" }],
    notes: ["La prima va en su propia línea (lineType prima): las líneas de salario no cambian y NO disparan VARIACION_EXCEDIDA."],
  },
  {
    name: "trampa-prima-otro-monto",
    description: "§13 'Mes de prima con otro monto': junio 2026. La prima de Natalia Ramírez (1007) viene por $2.000.000 y el calendario del escenario espera $2.800.000. Su línea de prima requiere aprobación.",
    month: "2026-06",
    states: base12(),
    current: ROSTER.map((p) => ({ p, opts: p.id === 1007 ? { prima: true, primaAmount: 2_000_000 } : { prima: true } })),
    stages: [{ stage: "inicial", asOf: JUN_ASOF, description: "beneficios_esperados: monto de prima distinto.", lines: { "1007:prima": { decision: "requiere_aprobacion", reasons: ["BENEFICIO_NO_COINCIDE"] } }, occurrenceStatus: "en_aprobacion" }],
    notes: ["Monto esperado = fórmula simplificada y ficticia del fixture ((salario + auxilio si aplica) / 2), no un cálculo laboral legal."],
  },
  {
    name: "trampa-liquidacion-final",
    description: "§13 'Liquidación final de desvinculado': María José Cárdenas (1009) renunció el 2026-10-15. Sin línea ordinaria; su liquidacion_final requiere aprobación (no se bloquea).",
    month: "2026-10",
    states: ROSTER.map((p) => (p.id === 1009 ? st(p, { status: "inactivo", activeUntil: "2026-10-15", terminationReason: "renuncia" }) : st(p))),
    current: cur(ROSTER.filter((p) => p.id !== 1009)),
    terminations: [{ p: R(1009), endDate: "2026-10-15", reason: "renuncia" }],
    finiquito: R(1009),
    webhooks: [{ file: "webhooks/01-job_termination-1009.json", receivedAt: "2026-10-15T23:00:00Z", body: empHook(1009, "2026-10-15T18:00:00-05:00", "job_termination", "terminado") }],
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "empleado_activo escala (no bloquea) en liquidacion_final.", lines: { "1009:liquidacion_final": { decision: "requiere_aprobacion", reasons: ["EMPLEADO_DESVINCULADO"] } }, occurrenceStatus: "en_aprobacion" }],
    notes: ["Ya no está en /employees/active, así que corrida_completa no la espera; su liquidación final nunca se aprueba sola."],
  },
  {
    name: "trampa-evidencia-desactualizada",
    description: "§13 'Evidencia de RR. HH. vieja': la lectura de Buk es del 2026-10-25 09:00 (Bogotá) y se evalúa el 2026-10-29 (> 2 días). EVIDENCIA_DESACTUALIZADA escala toda la corrida.",
    month: "2026-10",
    hrCapturedAt: "2026-10-25T14:00:00Z",
    states: base12(),
    current: cur(ROSTER),
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "evidencia_vigente escala todas las líneas.", all: { decision: "requiere_aprobacion", reasons: ["EVIDENCIA_DESACTUALIZADA"] }, runFindings: [{ ruleId: "evidencia_vigente", code: "EVIDENCIA_DESACTUALIZADA", effect: "escala", employeeId: null }], occurrenceStatus: "en_aprobacion" }],
    notes: ["N = 2 días es supuesto de Pacta (§14 deja N pendiente)."],
  },
  {
    name: "trampa-fondos-insuficientes",
    description: "§13 'Fondos insuficientes': disponibles $40.000.000 − reservados $2.000.000 < total de la corrida. FONDOS_INSUFICIENTES bloquea todas las líneas y la ocurrencia queda retenida.",
    month: "2026-10",
    states: base12(),
    current: cur(ROSTER),
    treasury: { fundsAvailableMinor: 4_000_000_000, fundsReservedMinor: 200_000_000 },
    stages: [{ stage: "inicial", asOf: OCT_ASOF, description: "fondos_suficientes bloquea la corrida.", all: { decision: "bloqueada", reasons: ["FONDOS_INSUFICIENTES"] }, runFindings: [{ ruleId: "fondos_suficientes", code: "FONDOS_INSUFICIENTES", effect: "bloquea", employeeId: null }], occurrenceStatus: "retenida" }],
    notes: ["Bloqueo absoluto de corrida: ninguna línea se ejecuta aunque individualmente esté limpia."],
  },
];

// ---------- Escritura ----------
const write = (path: string, data: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};
const lastDay = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};
const prevMonth = (m: string, k = 1) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 - k, 1)).toISOString().slice(0, 7);
};
const ddmmyyyy = (iso: string) => iso.split("-").reverse().join("-");
const minusMin = (utc: string, min: number) => new Date(Date.parse(utc) - min * 60_000).toISOString().replace(".000Z", "Z");

const OBLIGATION_BASE: ObligationTemplate = {
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
const DEFAULT_TREASURY = { fundsAvailableMinor: 8_000_000_000, fundsReservedMinor: 0 }; // $80.000.000 COP

rmSync(PAYLOADS_DIR, { recursive: true, force: true });
rmSync(EXPECTED_DIR, { recursive: true, force: true });

for (const sc of SCENARIOS) {
  const dir = join(PAYLOADS_DIR, sc.name);
  const routes: RouteEntry[] = [];
  const add = (path: string, endpoint: string, query: Record<string, string>, file: string, body: unknown) => {
    routes.push({ method: "GET", path, endpoint, query, file });
    write(join(dir, file), body);
  };
  const start = `${sc.month}-01`;
  const end = lastDay(sc.month);
  const months = [prevMonth(sc.month, 2), prevMonth(sc.month, 1), sc.month];
  const monthIdx = (m: string) => months.indexOf(m) + 1;
  const firstAsOf = sc.stages[0]!.asOf;
  const capturedDefault = minusMin(firstAsOf, 5);

  add("/process_periods", "GET /process_periods", {}, "process_periods.json",
    page(months.map((m, i) => ({ id: 300 + Number(m.slice(5)) + (Number(m.slice(0, 4)) - 2026) * 12, month: m, end_date: lastDay(m), status: i === months.length - 1 ? "abierto" : "cerrado" }))));

  const active = sc.states.filter((s) => s.status === "activo");
  add("/employees/active", "GET /employees/active", { date: end }, "employees_active.json", page(active.map(employeeJson)));
  for (const s of sc.states) add(`/employees/${s.p.id}`, "GET /employees/{id}", {}, `employees/${s.p.id}.json`, employeeJson(s));

  const currentSettlements = sc.current.map((c, i) => {
    const dupOffset = sc.current.findIndex((x) => x.p.id === c.p.id) === i ? 0 : 500;
    const o = c.opts ?? {};
    return settlementJson(c.p, sc.month, { ...o, prima: o.prima === true, liqId: 700000 + monthIdx(sc.month) * 1000 + idx(c.p) + dupOffset });
  });
  add("/payroll_detail/month", "GET /payroll_detail/month", { date: ddmmyyyy(start) }, `payroll_detail_month_${sc.month}.json`, page(currentSettlements));

  const terms = (sc.terminations ?? []).map((t) => ({
    id: jobId(t.p), code: `AND-${String(idx(t.p)).padStart(3, "0")}`, role_id: t.p.role, company_id: 1, employee_id: t.p.id, area_id: t.p.area,
    weekly_hours: 42, weekly_days: ["lunes", "martes", "miercoles", "jueves", "viernes"], currency: "COP", base_wage: t.p.wage, supervisor_id: 1010,
    contract_term: null, start_date: t.p.since, end_date: t.endDate, termination_reason: t.reason, custom_attributes: {},
  }));
  add("/jobs/events/terminations", "GET /jobs/events/terminations", { start_date: start, end_date: end }, "jobs_events_terminations.json", page(terms));

  let finiquito: { id: number; monto: number } | null = null;
  if (sc.finiquito) {
    const p = sc.finiquito;
    const auxBase = p.wage <= 2 * SMMLV ? AUX : 0;
    const base = p.wage + auxBase;
    const dCes = 285; // 2026-01-01 a 2026-10-15, base 360
    const dPrima = 105; // 2026-07-01 a 2026-10-15
    const salarioPend = Math.round((p.wage * 15) / 30);
    const auxPend = Math.round((auxBase * 15) / 30);
    const cesantias = Math.round((base * dCes) / 360);
    const intereses = Math.round((cesantias * dCes * 0.12) / 360);
    const prima = Math.round((base * dPrima) / 360);
    const vac = Math.round((p.wage / 30) * 7.5);
    const haberes = [
      { nombre: "Salario pendiente", monto: salarioPend },
      { nombre: "Auxilio de transporte pendiente", monto: auxPend },
      { nombre: "Cesantías", monto: cesantias },
      { nombre: "Intereses sobre cesantías", monto: intereses },
      { nombre: "Prima de servicios proporcional", monto: prima },
      { nombre: "Vacaciones compensadas", monto: vac },
    ];
    const descuentos = [
      { nombre: "Salud", monto: Math.round(salarioPend * 0.04) },
      { nombre: "Pensión", monto: Math.round(salarioPend * 0.04) },
    ];
    const total = haberes.reduce((a, h) => a + h.monto, 0) - descuentos.reduce((a, d) => a + d.monto, 0);
    finiquito = { id: 9000 + idx(p), monto: total };
    add(`/jobs/${jobId(p)}/termination`, "GET /jobs/{id}/termination", {}, `jobs/${jobId(p)}_termination.json`, {
      data: {
        fecha: "2026-10-15", fecha_aviso: "2026-10-01", fecha_pago: "2026-10-29", razon: "renuncia", anos_de_servicio: 3,
        indemnizacion_legal_por_anos_servicios: 0, indemnizacion_legal_por_meses_obra: 0, indemnizacion_sustitutiva_previo_aviso: 0,
        indemnizacion_pactada_contractualmente: 0, indemnizacion_voluntaria: 0, indemnizacion_vacaciones: 0, descuento_seguro_cesantia: 0,
        otros_descuentos: 0, monto_indemnizacion_no_renta: 0, reajuste_indemnizacion: 0, interes_indemnizacion: 0, en_liquidacion: false,
        custom_attributes: FIXTURE_ATTR,
        id: finiquito.id, fecha_inicio: p.since, monto: total, monto_sin_liquidacion: total - (salarioPend + auxPend - descuentos.reduce((a, d) => a + d.monto, 0)),
        razon_print: "Renuncia voluntaria", dias_indemnizacion_por_obra: 0, dias_feriados_corridos: 7.5, descuentos, haberes,
        indemnizacion_tributable: 0, impuesto_indemnizacion: 0, remuneraciones_pendientes: salarioPend, asignaciones_no_imponibles_pendientes: auxPend,
      },
    });
  }

  const lic = (sc.licences ?? []).map((l, i) => {
    const endD = new Date(Date.parse(`${l.start}T00:00:00Z`) + (l.days - 1) * 86400000).toISOString().slice(0, 10);
    return {
      id: 8101 + i, start_date: l.start, end_date: endD, days_count: l.days, day_percent: 1, contribution_days: 2, workday_stage: "full_working_day",
      application_date: l.start, application_end_date: endD, justification: "Incapacidad por enfermedad general (FICTICIO)", employee_id: l.p.id,
      status: "aprobado", created_at: l.start, updated_at: l.start, licence_type_id: 3, format: "electronica", type: "remunerada",
      codigo_incapacidad_colombia: "J069", descripcion_codigo_incapacidad_colombia: "INFECCION AGUDA DE LAS VIAS RESPIRATORIAS SUPERIORES, NO ESPECIFICADA",
      licence_type_code: "incapacidad_enfermedad_general", licence_number: "FICT-000123", medic_name: "Médico Ficticio", custom_attributes: {}, medic_rut: "9990009999",
    };
  });
  add("/absences/licence", "GET /absences/licence", { from: start, to: end }, "absences_licence.json", page(lic));

  for (const w of sc.webhooks ?? []) write(join(dir, w.file), w.body);

  // ---------- Datos propios de Pacta ----------
  const obligation: ObligationTemplate = { ...OBLIGATION_BASE, ...sc.obligation };
  write(join(dir, "_pacta/obligation.json"), { fixture: true, note: "Plantilla de obligación (ObligationTemplate compartido) de Pacta. No viene de Buk.", ...obligation });
  const treasury = sc.treasury ?? DEFAULT_TREASURY;
  write(join(dir, "_pacta/treasury.json"), { fixture: true, note: "Fondos simulados de Pacta (§6.1 OccurrenceContext). Dinero simulado.", ...treasury });
  const hr = sc.hrCapturedAt ?? capturedDefault;
  write(join(dir, "_pacta/fetch-log.json"), {
    fixture: true,
    note: "Hora (UTC) en que Pacta capturó cada instantánea de Buk. No es respuesta de Buk.",
    capturedAt: { periods: capturedDefault, employees: hr, payroll: hr, licences: capturedDefault, terminations: capturedDefault },
  });
  const prev = prevMonth(sc.month);
  const confirmed = sc.confirmedPeople ?? ROSTER;
  write(join(dir, "_pacta/last-confirmed.json"), {
    fixture: true,
    note: `Último monto (línea salario, neto) y última cuenta confirmados por Pacta en la corrida de ${prev}. Solo cuentas enmascaradas.`,
    byCounterparty: Object.fromEntries(
      confirmed.map((p) => [`buk:employee:${p.id}`, { beneficiaryReference: `****${p.bankInfo.last4}`, amountMinor: settlementJson(p, prev, { liqId: 0 }).liquid_reach * 100 }]),
    ),
  });
  write(join(dir, "_pacta/benefit-calendar.json"), {
    fixture: true,
    note: "Calendario de beneficios del escenario. Fórmula SIMPLIFICADA y ficticia: prima = (salario base + auxilio de transporte si salario ≤ 2 SMMLV) / 2, redondeada a peso. No es cálculo laboral legal.",
    primaMonths: ["06", "12"],
    formula: "prima_semestral_simplificada",
    smmlvMinor: SMMLV * 100,
    auxTransporteMinor: AUX * 100,
  });

  const manifest: ScenarioManifest = {
    fixture: true,
    scenario: sc.name,
    description: sc.description,
    organization: ORG,
    period: { month: sc.month, startDate: start, endDate: end },
    routes,
    pacta: {
      obligation: "_pacta/obligation.json",
      treasury: "_pacta/treasury.json",
      lastConfirmed: "_pacta/last-confirmed.json",
      benefitCalendar: "_pacta/benefit-calendar.json",
      fetchLog: "_pacta/fetch-log.json",
      webhooks: (sc.webhooks ?? []).map((w) => ({ file: w.file, receivedAt: w.receivedAt })),
    },
    evaluations: sc.stages.map((s) => ({ stage: s.stage, asOf: s.asOf, description: s.description })),
  };
  write(join(dir, "manifest.json"), manifest);

  // ---------- Oráculo (escrito por intención, independiente del mapper) ----------
  const occ = `${obligation.obligationId}:${start}`; // mismo criterio que el contrato compartido: obligationId:periodStart
  const fullName = (id: number) => employeeJson(sc.states.find((x) => x.p.id === id) ?? st(R(id))).full_name;
  type Skel = { key: string; lineId: string; employeeId: number; lineType: LineType; amountMinor: number };
  const skel: Skel[] = [];
  const seen = new Map<string, number>();
  const keyOf = (id: number, t: LineType) => {
    const k = `${id}:${t}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? k : `${k}#${n}`;
  };
  for (const s of currentSettlements) {
    const prima = s.lines_settlement.filter((l) => l.code === "prima_servicios").reduce((a, l) => a + l.amount, 0);
    skel.push({ key: keyOf(s.employee_id, "salario"), lineId: `${occ}:buk-liquidacion-${s.liquidacion_id}:salary`, employeeId: s.employee_id, lineType: "salario", amountMinor: (s.liquid_reach - prima) * 100 });
    if (prima > 0) skel.push({ key: keyOf(s.employee_id, "prima"), lineId: `${occ}:buk-liquidacion-${s.liquidacion_id}:bonus`, employeeId: s.employee_id, lineType: "prima", amountMinor: prima * 100 });
  }
  if (sc.finiquito && finiquito) {
    skel.push({ key: keyOf(sc.finiquito.id, "liquidacion_final"), lineId: `${occ}:buk-finiquito-${finiquito.id}:final_settlement`, employeeId: sc.finiquito.id, lineType: "liquidacion_final", amountMinor: finiquito.monto * 100 });
  }
  const total = skel.reduce((a, l) => a + l.amountMinor, 0);
  const free = (treasury.fundsAvailableMinor ?? 0) - (treasury.fundsReservedMinor ?? 0);
  if (!sc.treasury && total > free) throw new Error(`${sc.name}: fondos por defecto no cubren ${total}`);
  if (sc.treasury && total <= free) throw new Error(`${sc.name}: el escenario de fondos no produce faltante`);

  const evaluations = sc.stages.map((stg) => {
    for (const k of Object.keys(stg.lines ?? {})) if (!skel.some((l) => l.key === k)) throw new Error(`${sc.name}: clave de oráculo sin línea: ${k}`);
    const lines = skel.map((l) => {
      const e = stg.lines?.[l.key] ?? stg.all ?? { decision: "aprobada" as Decision, reasons: [] };
      return {
        lineId: l.lineId,
        counterpartyRef: `buk:employee:${l.employeeId}`,
        displayName: fullName(l.employeeId),
        lineType: LINE_TYPE_EN[l.lineType],
        amountMinor: l.amountMinor,
        decision: DECISION_EN[e.decision],
        reasons: e.reasons.map((reason) => REASON_EN[reason]),
      };
    });
    const counts = { approved: 0, blocked: 0, requires_approval: 0 };
    for (const l of lines) counts[l.decision]++;
    return {
      stage: stg.stage,
      asOf: stg.asOf,
      description: stg.description,
      occurrenceStatus: OCCURRENCE_STATUS_EN[stg.occurrenceStatus],
      counts,
      runFindings: (stg.runFindings ?? []).map((f) => ({
        ruleId: f.ruleId,
        code: REASON_EN[f.code],
        effect: f.effect === "bloquea" ? "blocked" : "requires_approval",
        counterpartyRef: f.employeeId === null ? null : `buk:employee:${f.employeeId}`,
      })),
      lines,
    };
  });
  write(join(EXPECTED_DIR, `${sc.name}.json`), {
    fixture: true,
    simulatedMoney: true,
    scenario: sc.name,
    description: sc.description,
    organization: ORG,
    occurrenceId: occ,
    period: sc.month,
    amountsUnit: "COP en unidades menores (centavos)",
    authority: "Oráculo escrito a mano por escenario según platform-core §7.1 y §13. El motor real de Pacta es la fuente de verdad.",
    totalMinor: total,
    evaluations,
    notes: sc.notes,
  });
}

write(join(PAYLOADS_DIR, "index.json"), {
  fixture: true,
  organization: ORG,
  provider: "Buk (Colombia) — forma de respuesta según https://demo.buk.cl/apidocs?country=colombia, consultado 2026-10-17",
  scenarios: SCENARIOS.map((s) => s.name),
});
writeFileSync(join(PAYLOADS_DIR, "FIXTURE.md"), `# ⚠️ FIXTURE — datos ficticios, dinero simulado

Los JSON de este directorio son **respuestas simuladas** con la forma exacta de la API de Buk (Colombia) según su documentación pública. No vienen de ningún tenant real de Buk.

- Empresa ficticia: **Andina Demo S.A.S.**; tenant ficticio \`andina-demo-fixture.buk.co\`.
- Personas ficticias. Cada colaborador lleva \`custom_attributes.pacta_fixture\` (Buk documenta \`custom_attributes\` como un objeto libre).
- Documentos **falsos a propósito**: 10 dígitos con prefijo \`999\`. Correos en \`.example\`. Teléfonos \`300 000 xxxx\`.
- Cuentas bancarias **solo** como \`****1234\`. Nunca un número completo.
- Montos en COP, plausibles para 2026 pero ficticios. El cálculo de nómina está simplificado (salud 4 %, pensión 4 %, FSP 1 %, sin retención en la fuente) y no es asesoría laboral.
- \`_pacta/\` **no** es Buk: son datos propios de Pacta (plantilla §9, fondos simulados, última cuenta y monto confirmados, calendario de beneficios, hora de cada captura).
- Se regeneran con \`npm run generate\`.
`);
console.log(`OK: ${SCENARIOS.length} escenarios generados en payloads/ y expected/`);
