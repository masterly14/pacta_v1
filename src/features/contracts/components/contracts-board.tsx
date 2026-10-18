"use client";
/**
 * Purpose: tablero de Contratos: resumen en tarjetas, filtros por tipo (todos, proactivos,
 *   reactivos, terminados) y una cuadrícula que ocupa todo el ancho, con la acción principal
 *   ("Nuevo contrato") en la misma fila que los filtros.
 * Runs in: browser (el filtro es estado de pantalla).
 * Triggered by: /platform/contracts, con las tarjetas ya calculadas en el servidor.
 * Receives → Returns: items serializables + acción → resumen, filtros y cuadrícula de tarjetas.
 * Talks to: next/link, lucide-react, shadcn Badge, Button.
 */
import { FileText, Plug, Radar } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BoardItem = {
  id: string;
  kind: "proactive" | "reactive";
  typeLabel: string; // p. ej. "Proactivo · Nómina" o "Reactivo"
  title: string;
  subtitle: string | null;
  status: { label: string; tone: "active" | "attention" | "muted" };
  stats: { label: string; value: string }[];
  actions: { href: string; label: string; primary?: boolean }[];
  terminated: boolean;
};

export type BoardSummary = { label: string; value: string; hint?: string }[];

type Filter = "all" | "proactive" | "reactive" | "terminated";

const TONE: Record<BoardItem["status"]["tone"], "default" | "secondary" | "outline"> = { active: "default", attention: "secondary", muted: "outline" };

export function ContractsBoard({ items, summary, action }: { items: BoardItem[]; summary: BoardSummary; action: React.ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");

  const live = items.filter((i) => !i.terminated);
  const counts: Record<Filter, number> = {
    all: live.length,
    proactive: live.filter((i) => i.kind === "proactive").length,
    reactive: live.filter((i) => i.kind === "reactive").length,
    terminated: items.filter((i) => i.terminated).length,
  };
  const visible = items.filter((i) => (filter === "terminated" ? i.terminated : !i.terminated && (filter === "all" || i.kind === filter)));
  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "Todos" },
    { id: "proactive", label: "Proactivos" },
    { id: "reactive", label: "Reactivos" },
    { id: "terminated", label: "Terminados" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summary.map((s) => (
          <div key={s.label} className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-black/5">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{s.value}</dd>
            {s.hint !== undefined && <p className="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>}
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filtrar contratos" className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <Button key={f.id} role="tab" aria-selected={filter === f.id} size="sm" variant={filter === f.id ? "secondary" : "ghost"} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="ml-1 text-xs tabular-nums text-muted-foreground">{counts[f.id]}</span>
            </Button>
          ))}
        </div>
        {action}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl py-16 text-center ring-1 ring-black/5">
          <FileText className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">No hay contratos en esta vista</p>
          <p className="max-w-sm text-xs text-muted-foreground">Crea uno con «Nuevo contrato»: reactivo para comparar facturas, o proactivo para que Pacta valide pagos recurrentes.</p>
        </div>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
          {visible.map((item) => {
            const Icon = item.kind === "proactive" ? Radar : Plug;
            return (
              <li key={`${item.kind}-${item.id}`} className={cn("flex flex-col rounded-xl bg-card shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md", item.terminated && "opacity-75")}>
                <div className="flex items-center justify-between gap-2 px-4 pt-4">
                  <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="grid size-7 place-items-center rounded-lg bg-muted">
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    {item.typeLabel}
                  </span>
                  <Badge variant={TONE[item.status.tone]}>{item.status.label}</Badge>
                </div>
                <div className="px-4 pt-3">
                  <h3 className="text-base font-semibold tracking-tight">{item.title}</h3>
                  {item.subtitle !== null && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.subtitle}</p>}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 px-4 text-sm">
                  {item.stats.map((s) => (
                    <div key={s.label} className="min-w-0">
                      <dt className="text-[0.7rem] text-muted-foreground">{s.label}</dt>
                      <dd className="truncate font-medium tabular-nums">{s.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-auto flex items-center gap-2 px-4 pt-4 pb-4">
                  {item.actions.map((a) => (
                    <Link key={a.href} href={a.href} className={cn(buttonVariants({ size: "sm", variant: a.primary ? "default" : "outline" }))}>
                      {a.label}
                    </Link>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
