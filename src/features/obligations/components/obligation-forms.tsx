"use client";
/**
 * Purpose: formularios cliente de /platform/obligations (borrador con calendario, activar, pausar) y /platform/runs
 *   (reloj de demo, siembra de historia, resolver una línea). Los errores se muestran en línea y conservan lo escrito.
 * Runs in: navegador (componentes cliente).
 * Triggered by: renderizados por las páginas de obligaciones y corridas; envían a las acciones de servidor.
 * Receives → Returns: props (plantillas, escenarios, solicitud) → UI de formulario.
 * Talks to: ../actions, ../schedule/components/schedule-editor, useFormAction, shadcn Button, Input, Label.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormAction, type FormActionState } from "@/shared/forms/use-form-action";
import { activateAction, advanceClockAction, pauseAction, resolveLineAction, saveDraftAction, seedHistoryAction, setClockAction } from "../actions";
import { DEFAULT_SCHEDULE, type Schedule } from "../schedule/calendar";
import { ScheduleEditor } from "../schedule/components/schedule-editor";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Result({ state }: { state: FormActionState }) {
  if (state === null) return null;
  return (
    <p role="status" className={state.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
      {state.message}
    </p>
  );
}

export function DraftForm({ scenarios, today, defaultSchedule = DEFAULT_SCHEDULE, defaultScenario }: { scenarios: string[]; today: string; defaultSchedule?: Schedule; defaultScenario: string }) {
  const [schedule, setSchedule] = useState<Schedule>(defaultSchedule);
  const { state, pending, formRef, onSubmit } = useFormAction(saveDraftAction);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor="scenario">Fuente de RR. HH. (simulada)</Label>
        <select id="scenario" name="scenario" className={selectClass} defaultValue={defaultScenario}>
          {scenarios.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Datos ficticios con la forma de la API de Buk (Colombia). No es una conexión real.</p>
      </div>
      <ScheduleEditor today={today} defaultValue={schedule} onChange={setSchedule} />
      <input type="hidden" name="schedule" value={JSON.stringify(schedule)} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar como borrador"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

function VersionButton({ action, obligationId, version, label, variant }: { action: typeof activateAction; obligationId: string; version: number; label: string; variant?: "outline" | "default" }) {
  const { state, pending, formRef, onSubmit } = useFormAction(action);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex items-center gap-2">
      <input type="hidden" name="obligationId" value={obligationId} />
      <input type="hidden" name="version" value={version} />
      <Button type="submit" size="sm" variant={variant ?? "outline"} disabled={pending}>
        {pending ? "…" : label}
      </Button>
      <Result state={state} />
    </form>
  );
}

export const ActivateButton = (props: { obligationId: string; version: number }) => <VersionButton action={activateAction} label="Activar" variant="default" {...props} />;
export const PauseButton = (props: { obligationId: string; version: number }) => <VersionButton action={pauseAction} label="Pausar" {...props} />;

function AdvanceForm({ currentDate }: { currentDate: string }) {
  const { state, pending, formRef, onSubmit } = useFormAction(advanceClockAction);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="clock-to">Avanzar el reloj de demo hasta</Label>
        <Input id="clock-to" name="to" type="date" min={currentDate} required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Ejecutando días…" : "Avanzar y ejecutar"}
      </Button>
      <Result state={state} />
    </form>
  );
}

function SetClockForm() {
  const { state, pending, formRef, onSubmit } = useFormAction(setClockAction);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="clock-date">Fijar el reloj en (sin ejecutar)</Label>
        <Input id="clock-date" name="date" type="date" required />
      </div>
      <Button type="submit" variant="outline" disabled={pending}>
        Fijar
      </Button>
      <Result state={state} />
    </form>
  );
}

export function AdvanceClockForm({ currentDate }: { currentDate: string }) {
  return (
    <div className="flex flex-col gap-4">
      <AdvanceForm currentDate={currentDate} />
      <SetClockForm />
    </div>
  );
}

export function SeedHistoryForm() {
  const { state, pending, onSubmit } = useFormAction(seedHistoryAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Cargando…" : "Cargar historia fixture"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function ResolveLineForm({ requestId }: { requestId: string }) {
  const { state, pending, formRef, onSubmit } = useFormAction(resolveLineAction);
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Label htmlFor={`comment-${requestId}`} className="text-xs">
        Comentario (queda como precedente)
      </Label>
      <Input id={`comment-${requestId}`} name="comment" maxLength={1000} placeholder="Por qué apruebas o rechazas" />
      <div className="flex items-center gap-2">
        <Button type="submit" name="action" value="approve" size="sm" disabled={pending}>
          Aprobar
        </Button>
        <Button type="submit" name="action" value="reject" size="sm" variant="outline" disabled={pending}>
          Rechazar
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
