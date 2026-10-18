/**
 * FIXTURE / Pacta — Esquemas Zod de las respuestas de la API de Buk (Colombia).
 *
 * Fuente única: Swagger 2.0 público de Buk para Colombia
 *   https://demo.buk.cl/api/colombia/es/api_docs   (copia: docs-ref/buk-swagger-colombia-es.json)
 *   UI: https://demo.buk.cl/apidocs?country=colombia
 * Consultado: 2026-10-17.
 *
 * Reglas:
 *  - Cada objeto es `.strict()`: si un payload trae un campo que no está en la doc, la validación falla.
 *  - Cada campo lleva el nombre exacto y el tipo de la definición Swagger citada en el comentario.
 *  - La doc no declara campos obligatorios ni `nullable`. Por eso los campos son `.nullable().optional()`,
 *    salvo los marcados [PACTA-REQ]: Pacta los exige para mapear (decisión de Pacta, no de Buk).
 *  - Desviaciones explícitas de la doc van marcadas [PACTA-ASUNCIÓN] o [DESVIACIÓN-DOC].
 */
import { z } from "zod";

const str = z.string().nullable().optional();
const int = z.number().int().nullable().optional();
const num = z.number().nullable().optional();
const bool = z.boolean().nullable().optional();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const date = dateStr.nullable().optional();
const obj = z.record(z.string(), z.unknown()).nullable().optional();

/** #/definitions/Pagination */
export const PaginationSchema = z
  .object({
    next: z.string().nullable().optional(), // [PACTA-ASUNCIÓN] null cuando no hay página siguiente (la doc no lo dice)
    previous: z.string().nullable().optional(),
    count: z.number().int(),
    total_pages: z.number().int(),
  })
  .strict();
export type Pagination = z.infer<typeof PaginationSchema>;

/** Sobre paginado documentado en las respuestas 200: `{ pagination, data: [...] }` */
export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({ pagination: PaginationSchema, data: z.array(item) }).strict();

/** #/definitions/bad_request y respuestas 404 documentadas: `{ errors: string[] }` */
export const ErrorsSchema = z.object({ errors: z.array(z.string()) }).strict();

/** #/definitions/BossModel (allOf BasePersonIdentifier) */
export const BossSchema = z.object({ document_number: str, document_type: str, id: int, rut: str }).strict();

/** #/definitions/JobResponseCountry (campo `current_job` del colaborador) */
export const JobResponseCountrySchema = z
  .object({
    id: z.number().int(), // [PACTA-REQ]
    company_id: int,
    start_date: date,
    type_of_contract: str, // valores de JobInputCountryPatch.type_of_contract: "Indefinido", "Plazo fijo", ...
    end_of_contract: date,
    notice_date: date,
    regular_hours: int,
    risk_type: str, // JobInputCountry.risk_type: minimo|bajo|medio|alto|maximo
    end_date: date,
    contract_finishing_date_1: date,
    contract_finishing_date_2: date,
    cost_center: str,
    periodicity: str, // JobInputCountryPatch.periodicity: mensual|diaria|hora
    zone_assignment: bool, // [DESVIACIÓN-DOC] la doc dice type "bool" (no estándar); se modela boolean
    custom_attributes: obj,
    area_id: int,
    role_id: int,
    leader_id: int,
    retention_taxes: str,
    retention_taxes_type: str,
    retention_taxes_rate: num, // doc: "float"
    currency_code: str,
    wage: num, // doc: float. Salario base del trabajo (COP, unidades mayores)
    wage_type: str, // JobInputCountry.wage_type: variable|fijo
    boss: BossSchema.nullable().optional(),
    without_wage: bool,
  })
  .strict();

/** #/definitions/EmployeeResponseCountry (allOf BasePersonIdentifier) — GET /employees/{id}, items de GET /employees/active */
export const EmployeeSchema = z
  .object({
    // BasePersonIdentifier
    document_number: str,
    document_type: str, // cc|ce|ti|pa|cd|sc|rc|pe|pt|otro (según descripción de la doc)
    period_type: str,
    person_id: int,
    id: z.number().int(), // [PACTA-REQ]
    picture_url: str,
    first_name: str,
    surname: str,
    second_surname: str,
    full_name: z.string(), // [PACTA-REQ]
    rut: z.string(), // [PACTA-REQ] En Colombia contiene el número de documento (sin puntos ni guion)
    code_sheet: str,
    email: str,
    personal_email: str,
    address: str,
    district: str,
    location_id: int,
    region: str,
    office_phone: str,
    phone: str,
    gender: str,
    birthday: str,
    university: str,
    degree: str,
    active_since: str,
    status: z.string(), // [PACTA-REQ] filtro documentado: activo|inactivo|pendiente
    payment_currency: z.enum(["COP"]).nullable().optional(),
    payment_method: str, // EmployeeInputCountry.payment_method: Cheque|No Generar Pago|Transferencia Bancaria
    bank: str, // EmployeeInputCountry.bank: lista cerrada de bancos colombianos (ver openapi.yaml)
    account_type: str, // EmployeeInputCountry.account_type: Corriente|Ahorro
    /**
     * [DESVIACIÓN-DOC deliberada] Buk devuelve el número de cuenta completo.
     * Regla de datos de Pacta: nunca guardar ni mostrar un número completo. Los fixtures traen
     * SOLO la forma enmascarada `****1234`, y el adaptador real enmascara al recibir (ver mapper.maskAccount).
     */
    account_number: str,
    payment_document_type: str, // EmployeeInputCountry.payment_document_type: cc|ce|ti|pa|cd|sc|rc|pe|pt
    payment_document_number: str,
    private_role: bool,
    progressive_vacations_start: date,
    nationality: str,
    country_code: str,
    civil_status: str,
    health_company: str,
    pension_regime: int, // doc: integer (semántica no documentada; los fixtures usan null)
    pension_fund: str,
    afc: str,
    custom_attributes: obj,
    active_until: date, // fecha de término (doc: format date)
    termination_reason: str,
    current_job: JobResponseCountrySchema.nullable().optional(),
    family_responsabilities: obj, // #/definitions/EmployeeFamilyResponsability (no se usa; fixtures: null)
  })
  .strict();
export type BukEmployee = z.infer<typeof EmployeeSchema>;

/**
 * GET /employees/{id}: la doc define la respuesta 200 como EmployeeResponseCountry SIN sobre `data`.
 * [PACTA-ASUNCIÓN defensiva] el adaptador acepta también `{ data: Employee }` por si la API real lo envuelve.
 */
export const EmployeeDetailResponseSchema = z.union([EmployeeSchema, z.object({ data: EmployeeSchema }).strict()]);
export const EmployeesActiveResponseSchema = paginated(EmployeeSchema);

/** #/definitions/SettlementLine */
export const SettlementLineSchema = z
  .object({
    type: z.string(), // [PACTA-REQ] [PACTA-ASUNCIÓN] vocabulario haber|descuento|aporte|informativo tomado de la doc de Ítems
    subtype: str,
    income_type: str,
    name: z.string(), // [PACTA-REQ]
    amount: z.number(), // [PACTA-REQ] doc: float, COP unidades mayores
    resettlement: bool,
    taxable: bool,
    imponible: bool,
    anticipo: bool,
    credit_type: str,
    institution: str,
    description: str,
    code: str, // [PACTA-ASUNCIÓN] valores de `code`/`item_code` no documentados; los fixtures usan códigos propios
    item_code: str,
  })
  .strict();

/** #/definitions/Settlement — items de GET /payroll_detail/month */
export const SettlementSchema = z
  .object({
    liquidacion_id: z.number().int(), // [PACTA-REQ]
    person_id: int,
    employee_id: z.number().int(), // [PACTA-REQ]
    month: z.string(), // [PACTA-REQ] [PACTA-ASUNCIÓN] formato "10" (la doc solo dice string)
    year: z.string(), // [PACTA-REQ]
    worked_days: num,
    noworked_days: num,
    income_gross: num,
    income_net: num,
    income_afp: num,
    income_ips: num,
    total_income_taxable: num,
    total_income_notaxable: num,
    total_legal_discounts: num,
    total_other_discounts: num,
    closed: bool,
    liquid_reach: z.number(), // [PACTA-REQ] [PACTA-ASUNCIÓN] monto a transferir = liquid_reach (doc: number/integer)
    taxable_base: num,
    rut: str,
    lines_settlement: z.array(SettlementLineSchema), // [PACTA-REQ]
  })
  .strict();
export type BukSettlement = z.infer<typeof SettlementSchema>;
export const PayrollDetailMonthResponseSchema = paginated(SettlementSchema);

/** #/definitions/Variable — items de GET /process_periods */
export const ProcessPeriodSchema = z
  .object({
    id: z.number().int(),
    month: z.string().regex(/^\d{4}-\d{2}$/), // doc: "YYYY-MM"
    end_date: dateStr, // doc: "YYYY-MM-DD"
    status: z.string(), // doc: ej. "abierto". [PACTA-ASUNCIÓN] mismo vocabulario que Process.status: abierto|revision|cerrado
  })
  .strict();
export const ProcessPeriodsResponseSchema = paginated(ProcessPeriodSchema);

/** #/definitions/TerminatedJob — items de GET /jobs/events/terminations */
export const TerminatedJobSchema = z
  .object({
    id: z.number().int(), // [PACTA-REQ] id del trabajo (se usa en GET /jobs/{id}/termination)
    code: str,
    role_id: int,
    company_id: int,
    employee_id: z.number().int(), // [PACTA-REQ]
    area_id: int,
    weekly_hours: int,
    weekly_days: z.array(z.string()).nullable().optional(),
    currency: str,
    base_wage: int,
    supervisor_id: int,
    contract_term: date,
    start_date: date,
    end_date: dateStr, // [PACTA-REQ]
    termination_reason: str, // JobTerminateInput.termination_reason: renuncia|mutuo_acuerdo|...
    custom_attributes: obj,
  })
  .strict();
export const TerminationsResponseSchema = paginated(TerminatedJobSchema);

/**
 * #/definitions/FiniquitoHaberes y FiniquitoDescuentos.
 * [DESVIACIÓN-DOC] la doc tipa `nombre` como number, lo que es claramente un error (es un nombre).
 * Se modela string y queda anotado en openapi.yaml (x-pacta-deviation).
 */
export const FiniquitoItemSchema = z.object({ nombre: z.string(), monto: z.number() }).strict();

/** #/definitions/Finiquito (allOf FiniquitoBase) — GET /jobs/{id}/termination responde `{ data: Finiquito }` */
export const FiniquitoSchema = z
  .object({
    // FiniquitoBase
    fecha: date,
    fecha_aviso: date,
    fecha_pago: date,
    razon: str,
    anos_de_servicio: num,
    indemnizacion_legal_por_anos_servicios: num,
    indemnizacion_legal_por_meses_obra: num,
    indemnizacion_sustitutiva_previo_aviso: num,
    indemnizacion_pactada_contractualmente: num,
    indemnizacion_voluntaria: num,
    indemnizacion_vacaciones: num,
    descuento_seguro_cesantia: num,
    otros_descuentos: num,
    monto_indemnizacion_no_renta: num,
    reajuste_indemnizacion: num,
    interes_indemnizacion: num,
    en_liquidacion: bool,
    custom_attributes: obj,
    // Finiquito
    id: z.number().int(),
    fecha_inicio: date,
    monto: z.number(), // [PACTA-REQ] [PACTA-ASUNCIÓN] total neto a pagar de la liquidación final
    monto_sin_liquidacion: num,
    razon_print: str,
    dias_indemnizacion_por_obra: num,
    dias_feriados_corridos: num,
    descuentos: z.array(FiniquitoItemSchema),
    haberes: z.array(FiniquitoItemSchema),
    indemnizacion_tributable: num,
    impuesto_indemnizacion: num,
    remuneraciones_pendientes: num,
    asignaciones_no_imponibles_pendientes: num,
  })
  .strict();
export const TerminationResponseSchema = z.object({ data: FiniquitoSchema }).strict();

/**
 * Absences::Licence::Response = allOf(Absence::Response, LicenceBase, LicenceType, {licence_type_code, licence_number,
 * medic_name, custom_attributes}, MedicIdentifier). Items de GET /absences/licence.
 */
export const LicenceSchema = z
  .object({
    // Absence::Response
    id: z.number().int(),
    start_date: dateStr, // required en la doc
    end_date: date,
    days_count: z.number().int(), // required en la doc (días corridos)
    day_percent: num,
    contribution_days: num,
    workday_stage: str,
    application_date: date,
    application_end_date: date,
    justification: str,
    employee_id: z.number().int(), // [PACTA-REQ]
    status: str, // ej. "aprobado"
    created_at: date,
    updated_at: date,
    // LicenceBase
    licence_type_id: int,
    format: z.enum(["electronica", "fisica"]), // required en LicenceBase
    // LicenceType
    type: z.enum(["remunerada", "no_remunerada", "maternidad_paternidad", "luto", "calamidad_domestica", "suspension", "dia_familia"]),
    codigo_incapacidad_colombia: str, // CIE-10
    descripcion_codigo_incapacidad_colombia: str,
    // propiedades propias
    licence_type_code: str,
    licence_number: str,
    medic_name: str,
    custom_attributes: obj,
    // MedicIdentifier
    medic_rut: str,
  })
  .strict();
export type BukLicence = z.infer<typeof LicenceSchema>;
export const LicencesResponseSchema = paginated(LicenceSchema);

/**
 * Webhooks (pestaña Webhooks de https://demo.buk.cl/apidocs y artículo "Configuración de Webhooks en Buk – Colombia").
 * Buk hace POST con `{ "data": { ... } }`. Solo notifica; el detalle se consulta por API.
 */
export const EmployeeWebhookSchema = z
  .object({
    data: z
      .object({
        employee_id: z.number().int(),
        date: z.string().datetime({ offset: true }),
        event_type: z.enum([
          "employee_create",
          "employee_update",
          "employee_plan_update",
          "employee_responsibility_update",
          "job_hire",
          "job_termination",
          "job_movement",
        ]),
        tenant_url: z.string(),
        employment_status: z.enum(["activo", "pendiente", "terminado"]),
        metadata: z
          .object({
            relevant_for_bukas: z.boolean().optional(),
            plan_id: z.number().int().optional(),
            responsibility_id: z.number().int().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export const LicenceWebhookSchema = z
  .object({
    data: z
      .object({
        licence_id: z.number().int(),
        date: z.string().datetime({ offset: true }),
        event_type: z.enum(["licence_create", "licence_update", "licence_destroy"]),
        tenant_url: z.string(),
      })
      .strict(),
  })
  .strict();

export const BukWebhookSchema = z.union([EmployeeWebhookSchema, LicenceWebhookSchema]);
export type BukWebhook = z.infer<typeof BukWebhookSchema>;

/** Mapa endpoint -> esquema, usado por el validador y el cliente. */
export const ENDPOINT_SCHEMAS = {
  "GET /process_periods": ProcessPeriodsResponseSchema,
  "GET /employees/active": EmployeesActiveResponseSchema,
  "GET /employees/{id}": EmployeeDetailResponseSchema,
  "GET /payroll_detail/month": PayrollDetailMonthResponseSchema,
  "GET /jobs/events/terminations": TerminationsResponseSchema,
  "GET /jobs/{id}/termination": TerminationResponseSchema,
  "GET /absences/licence": LicencesResponseSchema,
} as const;
export type EndpointKey = keyof typeof ENDPOINT_SCHEMAS;
