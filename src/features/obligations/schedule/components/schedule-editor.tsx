"use client";
/**
 * Purpose: editor del calendario de pago de una obligación (regla, día, ajuste por día hábil y anticipación) con vista previa
 *   de los próximos vencimientos y de la línea de tiempo de fases (preparar → avisos → ejecutar).
 * Runs in: navegador (componente cliente). No guarda nada: avisa los cambios por `onChange` y el asistente de obligaciones
 *   (F3b) los persiste como una versión nueva en borrador.
 * Receives → Returns: { defaultValue, today, earlyAlertDays, urgentAlertDays, onChange } → formulario + vista previa.
 * Talks to: ../calendar, ../dates, ../holidays (fixture de festivos), shadcn Input y Label.
 */
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUSINESS_DAY_ADJUST_LABELS, DEFAULT_SCHEDULE, SCHEDULE_RULE_LABELS, ScheduleSchema, type BusinessDayAdjust, type Schedule } from "../calendar";
import { computeDueDates, phasesFor, type SchedulePhase } from "../dates";
import { isColombiaHolidayFixture } from "../holidays";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const PHASE_LABEL: Record<SchedulePhase, string> = {
  prepare: "Preparar corrida",
  alert_early: "Aviso temprano",
  alert_urgent: "Aviso urgente",
  execute: "Ejecutar (simulado)",
};

const dateFormat = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatDate = (date: string) => dateFormat.format(new Date(`${date}T00:00:00Z`));

type Props = {
  defaultValue?: Schedule;
  /** Fecha de hoy (YYYY-MM-DD, Bogotá): desde ahí se calculan los próximos vencimientos. */
  today: string;
  earlyAlertDays?: number;
  urgentAlertDays?: number;
  onChange?: (schedule: Schedule) => void;
};

export function ScheduleEditor({ defaultValue = DEFAULT_SCHEDULE, today, earlyAlertDays = 7, urgentAlertDays = 3, onChange }: Props) {
  const [rule, setRule] = useState<Schedule["rule"]>(defaultValue.rule);
  const [day, setDay] = useState(defaultValue.rule === "day_of_month" ? defaultValue.day : 25);
  const [firstDay, setFirstDay] = useState(defaultValue.rule === "semi_monthly" ? defaultValue.firstDay : 15);
  const [adjust, setAdjust] = useState<BusinessDayAdjust>(defaultValue.businessDayAdjust);
  const [leadDays, setLeadDays] = useState(defaultValue.leadDays);

  const parsed = useMemo(() => {
    const candidate = rule === "month_end" ? { rule } : rule === "day_of_month" ? { rule, day } : { rule, firstDay };
    return ScheduleSchema.safeParse({ ...candidate, businessDayAdjust: adjust, leadDays });
  }, [rule, day, firstDay, adjust, leadDays]);

  const preview = useMemo(() => {
    if (!parsed.success) return [];
    return computeDueDates(parsed.data, today, 6, isColombiaHolidayFixture).map((due) => ({
      due,
      phases: phasesFor(due.dueDate, { leadDays: parsed.data.leadDays, earlyAlertDays, urgentAlertDays }, isColombiaHolidayFixture),
    }));
  }, [parsed, today, earlyAlertDays, urgentAlertDays]);

  function emit(next: Partial<{ rule: Schedule["rule"]; day: number; firstDay: number; adjust: BusinessDayAdjust; leadDays: number }>) {
    const nextRule = next.rule ?? rule;
    const candidate =
      nextRule === "month_end" ? { rule: nextRule } : nextRule === "day_of_month" ? { rule: nextRule, day: next.day ?? day } : { rule: nextRule, firstDay: next.firstDay ?? firstDay };
    const result = ScheduleSchema.safeParse({ ...candidate, businessDayAdjust: next.adjust ?? adjust, leadDays: next.leadDays ?? leadDays });
    if (result.success) onChange?.(result.data);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-rule">Cuándo se paga</Label>
          <select
            id="schedule-rule"
            className={selectClass}
            value={rule}
            onChange={(event) => {
              const value = event.target.value as Schedule["rule"];
              setRule(value);
              emit({ rule: value });
            }}
          >
            {(Object.keys(SCHEDULE_RULE_LABELS) as Schedule["rule"][]).map((value) => (
              <option key={value} value={value}>
                {SCHEDULE_RULE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        {rule === "day_of_month" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-day">Día del mes</Label>
            <Input
              id="schedule-day"
              type="number"
              min={1}
              max={31}
              value={day}
              onChange={(event) => {
                setDay(Number(event.target.value));
                emit({ day: Number(event.target.value) });
              }}
            />
            <p className="text-xs text-muted-foreground">Si el mes no tiene ese día, se usa el último.</p>
          </div>
        )}

        {rule === "semi_monthly" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="schedule-first-day">Primera quincena (día)</Label>
            <Input
              id="schedule-first-day"
              type="number"
              min={1}
              max={28}
              value={firstDay}
              onChange={(event) => {
                setFirstDay(Number(event.target.value));
                emit({ firstDay: Number(event.target.value) });
              }}
            />
            <p className="text-xs text-muted-foreground">La segunda se paga el último día del mes.</p>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-adjust">Si cae en fin de semana o festivo</Label>
          <select
            id="schedule-adjust"
            className={selectClass}
            value={adjust}
            onChange={(event) => {
              const value = event.target.value as BusinessDayAdjust;
              setAdjust(value);
              emit({ adjust: value });
            }}
          >
            {(Object.keys(BUSINESS_DAY_ADJUST_LABELS) as BusinessDayAdjust[]).map((value) => (
              <option key={value} value={value}>
                {BUSINESS_DAY_ADJUST_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="schedule-lead">Preparar la corrida (días antes)</Label>
          <Input
            id="schedule-lead"
            type="number"
            min={0}
            max={30}
            value={leadDays}
            onChange={(event) => {
              setLeadDays(Number(event.target.value));
              emit({ leadDays: Number(event.target.value) });
            }}
          />
          <p className="text-xs text-muted-foreground">Da tiempo de resolver excepciones antes del pago.</p>
        </div>

        {!parsed.success && (
          <p role="alert" className="text-sm text-destructive">
            {parsed.error.issues[0]?.message ?? "Calendario inválido."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">Próximos vencimientos</h3>
        <p className="text-xs text-muted-foreground">
          Festivos de Colombia: datos de fixture, por verificar. Las horas son las 09:00 de Bogotá. Nada de esto mueve dinero.
        </p>
        <ol className="flex flex-col gap-3">
          {preview.map(({ due, phases }) => (
            <li key={due.dueDate} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{formatDate(due.dueDate)}</span>
                <span className="text-xs text-muted-foreground">
                  Periodo {due.periodStart} a {due.periodEnd}
                  {due.nominalDueDate !== due.dueDate && ` · ajustado desde ${formatDate(due.nominalDueDate)}`}
                </span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {phases.map((slot) => (
                  <li key={slot.phase}>
                    <span className="font-medium text-foreground">{PHASE_LABEL[slot.phase]}</span> · {formatDate(slot.date)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
