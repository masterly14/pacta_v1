/**
 * Purpose: calendario de pago de una obligación como DATO (no como un cron por usuario). Define cuándo vence cada
 *   ocurrencia; un único tick compara la fecha de hoy con este calendario (ver tick.ts en F3b).
 * Runs in: servidor, cliente (vista previa) y pruebas. Puro.
 * Receives → Returns: JSON de formulario o de BD → Schedule validado con Zod.
 * Nota: la plantilla compartida (`ObligationTemplate.calendar`) solo conoce `month_end`; este esquema es propio y se
 *   guarda en su propia columna para no tocar contratos compartidos.
 */
import { z } from "zod";

/** Si la fecha cae en fin de semana o festivo: se deja igual, se adelanta o se pasa al siguiente día hábil. */
export const BusinessDayAdjustSchema = z.enum(["none", "previous", "next"]);

const common = {
  businessDayAdjust: BusinessDayAdjustSchema.default("previous"),
  /** Días antes del vencimiento en que se prepara la corrida (se genera la ocurrencia y se reúne la evidencia). */
  leadDays: z.int().min(0).max(30).default(7),
};

export const ScheduleSchema = z.discriminatedUnion("rule", [
  /** Se paga el último día del mes. */
  z.strictObject({ rule: z.literal("month_end"), ...common }),
  /** Se paga el día N de cada mes; si el mes no tiene ese día, el último. */
  z.strictObject({ rule: z.literal("day_of_month"), day: z.int().min(1).max(31), ...common }),
  /** Dos pagos al mes: el día `firstDay` y el último día. Los periodos son 1–firstDay y firstDay+1–fin de mes. */
  z.strictObject({ rule: z.literal("semi_monthly"), firstDay: z.int().min(1).max(28).default(15), ...common }),
]);

export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleInput = z.input<typeof ScheduleSchema>;
export type BusinessDayAdjust = z.infer<typeof BusinessDayAdjustSchema>;

/** Calendario por omisión: fin de mes, día hábil anterior, preparación 7 días antes. */
export const DEFAULT_SCHEDULE: Schedule = ScheduleSchema.parse({ rule: "month_end" });

export const SCHEDULE_RULE_LABELS: Record<Schedule["rule"], string> = {
  month_end: "Fin de mes",
  day_of_month: "Un día fijo del mes",
  semi_monthly: "Quincenal (día fijo y fin de mes)",
};

export const BUSINESS_DAY_ADJUST_LABELS: Record<BusinessDayAdjust, string> = {
  none: "No ajustar",
  previous: "Día hábil anterior",
  next: "Día hábil siguiente",
};
