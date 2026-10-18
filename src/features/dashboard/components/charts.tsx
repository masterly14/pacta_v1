"use client";

/**
 * Purpose: small animated SVG charts for the dashboard (count-up numbers, sparkline, stacked daily
 *   bars, donut, radial gauge, horizontal bar list). No chart library: SVG + motion. Animations
 *   play once when the chart scrolls into view and are skipped with prefers-reduced-motion.
 * Runs in: browser (client components).
 * Triggered by: /platform (dashboard page).
 * Receives → Returns: plain numbers and labels from getDashboard → SVG/HTML.
 * Talks to: motion/react.
 */
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

// ---------------------------------------------------------------------------
// Número que cuenta hacia arriba
// ---------------------------------------------------------------------------

export function AnimatedNumber({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView || reduced) return;
    const controls = animate(0, value, { duration: 1.1, ease: EASE, onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduced, value]);

  // Sin animación (movimiento reducido) se muestra el valor final directamente.
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {(reduced ? value : shown).toLocaleString("en-US")}
      {suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (área + línea que se dibuja)
// ---------------------------------------------------------------------------

export function Sparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const reduced = useReducedMotion();
  const width = 120;
  const height = 36;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => [i * step, height - 2 - (v / max) * (height - 6)] as const);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("h-9 w-full overflow-visible", className)} aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill="url(#spark-fill)"
        initial={reduced ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8, delay: 0.4 }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: EASE }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Barras apiladas por día
// ---------------------------------------------------------------------------

export type StackSeries = { key: string; label: string; className: string };

// `label` llega ya formateado: un componente cliente no puede recibir funciones del servidor.
export function StackedBars({
  data,
  series,
}: {
  data: readonly ({ day: string; label: string } & Record<string, number | string>)[];
  series: readonly StackSeries[];
}) {
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((sum, s) => sum + Number(d[s.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const width = 900;
  const height = 200;
  const gap = 3;
  const barWidth = width / data.length - gap;
  const active = hover === null ? null : data[hover];

  return (
    <div className="relative">
      <div className="pointer-events-none absolute right-0 top-0 min-h-10 text-right text-xs text-muted-foreground">
        {active ? (
          <div className="rounded-md border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
            <div className="font-medium text-foreground">{active.label}</div>
            {series.map((s) => (
              <div key={s.key}>
                {s.label}: <span className="tabular-nums text-foreground">{Number(active[s.key] ?? 0)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <svg viewBox={`0 0 ${width} ${height + 18}`} className="h-auto w-full" role="img" aria-label="Decisiones por día">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={0} x2={width} y1={height - f * height} y2={height - f * height} className="stroke-border" strokeDasharray="2 4" />
        ))}
        {data.map((d, i) => {
          let y = height;
          const x = i * (barWidth + gap);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-default">
              <rect x={x} y={0} width={barWidth + gap} height={height} fill="transparent" />
              {series.map((s) => {
                const value = Number(d[s.key] ?? 0);
                if (value === 0) return null;
                const h = (value / max) * (height - 8);
                y -= h;
                return (
                  <motion.rect
                    key={s.key}
                    x={x}
                    width={barWidth}
                    rx={2}
                    className={cn(s.className, hover !== null && hover !== i && "opacity-40")}
                    style={{ transition: "opacity 150ms" }}
                    initial={reduced ? false : { y: height, height: 0 }}
                    whileInView={{ y, height: h }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.7, delay: i * 0.015, ease: EASE }}
                  />
                );
              })}
            </g>
          );
        })}
        {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) =>
          data[i] ? (
            <text
              key={i}
              x={i * (barWidth + gap) + barWidth / 2}
              y={height + 14}
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
              className="fill-muted-foreground text-[13px]"
            >
              {data[i]!.label}
            </text>
          ) : null,
        )}
      </svg>
      <Legend items={series.map((s) => ({ label: s.label, className: s.className }))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dona
// ---------------------------------------------------------------------------

export type DonutSegment = { label: string; value: number; className: string; detail?: string };

export function Donut({ segments, center, caption }: { segments: readonly DonutSegment[]; center: string; caption: string }) {
  const reduced = useReducedMotion();
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative size-36 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={caption}>
          <circle cx={50} cy={50} r={radius} fill="none" strokeWidth={10} className="stroke-muted" />
          {total > 0 &&
            segments.map((s, i) => {
              const length = (s.value / total) * circumference;
              const dash = Math.max(0, length - (segments.filter((x) => x.value > 0).length > 1 ? 1.5 : 0));
              const element = (
                <motion.circle
                  key={s.label}
                  cx={50}
                  cy={50}
                  r={radius}
                  fill="none"
                  strokeWidth={10}
                  strokeLinecap="butt"
                  className={s.className}
                  strokeDashoffset={-offset}
                  initial={reduced ? false : { strokeDasharray: `0 ${circumference}` }}
                  whileInView={{ strokeDasharray: `${dash} ${circumference}` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.9, delay: 0.15 * i, ease: EASE }}
                />
              );
              offset += length;
              return s.value > 0 ? element : null;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xl font-semibold tabular-nums">{center}</span>
          <span className="max-w-20 text-[10px] leading-tight text-muted-foreground">{caption}</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-2 text-sm">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
                <circle cx={5} cy={5} r={2.5} fill="none" strokeWidth={5} className={s.className} />
              </svg>
              {s.label}
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{s.value}</span>
              {s.detail ? ` · ${s.detail}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medidor radial (presupuesto)
// ---------------------------------------------------------------------------

export function RadialGauge({ percent, className }: { percent: number; className?: string }) {
  const reduced = useReducedMotion();
  const clamped = Math.min(100, Math.max(0, percent));
  const tone = clamped >= 90 ? "stroke-rose-500" : clamped >= 70 ? "stroke-amber-500" : "stroke-emerald-500";
  return (
    <div className={cn("relative size-16 shrink-0", className)}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx={50} cy={50} r={40} fill="none" strokeWidth={12} className="stroke-muted" />
        <motion.circle
          cx={50}
          cy={50}
          r={40}
          fill="none"
          strokeWidth={12}
          strokeLinecap="round"
          className={tone}
          initial={reduced ? false : { pathLength: 0 }}
          whileInView={{ pathLength: clamped / 100 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
        <AnimatedNumber value={Math.round(clamped)} suffix="%" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista de barras horizontales
// ---------------------------------------------------------------------------

export function BarList({ items, barClassName = "bg-foreground/80" }: { items: readonly { label: string; value: number; detail?: string }[]; barClassName?: string }) {
  const reduced = useReducedMotion();
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={item.label} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{item.value}</span>
              {item.detail ? ` · ${item.detail}` : ""}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn("h-full rounded-full", barClassName)}
              initial={reduced ? false : { width: 0 }}
              whileInView={{ width: `${(item.value / max) * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: 0.08 * i, ease: EASE }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Leyenda
// ---------------------------------------------------------------------------

function Legend({ items }: { items: readonly { label: string; className: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
            <rect width={10} height={10} rx={2} className={item.className} />
          </svg>
          {item.label}
        </span>
      ))}
    </div>
  );
}
