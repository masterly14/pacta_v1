/**
 * Purpose: vista previa del editor de calendario de pago (fechas de vencimiento y fases), sin guardar nada.
 * Runs in: servidor (carcasa + fecha de hoy) + cliente (ScheduleEditor guarda el estado de pantalla).
 * Triggered by: GET /platform/obligations/calendar. Todavía no está en el menú global: el asistente de obligaciones
 *   (F3b) monta el mismo editor y persiste el calendario como una versión nueva en borrador.
 * Receives → Returns: petición → HTML dentro de la plataforma.
 * Talks to: PlatformSection, features/obligations/schedule/components/schedule-editor.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { ScheduleEditor } from "@/features/obligations/schedule/components/schedule-editor";

export const metadata: Metadata = { title: "Calendario de pago" };

// Fecha de hoy en Bogotá (UTC-5): el calendario se calcula con fechas de calendario de esa zona.
const bogotaToday = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

async function CalendarEditor() {
  await connection(); // la fecha de hoy se lee por petición, nunca en el prerender
  return <ScheduleEditor today={bogotaToday()} />;
}

export default function ScheduleCalendarPage() {
  return (
    <PlatformSection
      title="Calendario de pago"
      description="Define cuándo vence cada pago recurrente. Pacta prepara la corrida con anticipación, avisa y solo ejecuta (en simulación) el día del vencimiento, tras volver a validar."
    >
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando calendario…</p>}>
        <CalendarEditor />
      </Suspense>
    </PlatformSection>
  );
}
