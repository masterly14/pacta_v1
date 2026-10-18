/**
 * Purpose: elegir el caso de uso de obligaciones recurrentes: nómina (recursos humanos) o impuestos
 *   (tributación). Cada uno abre su flujo en React Flow a pantalla completa, con datos ficticios y
 *   pago simulado.
 * Runs in: server (React Server Component, sin datos de runtime).
 * Triggered by: GET /platform/obligations (entrada "Obligaciones" del menú).
 * Receives → Returns: request → dos tarjetas de caso de uso.
 * Talks to: PlatformSection, shadcn Card, Badge; next/link.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Landmark } from "lucide-react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Obligaciones" };

const USE_CASES = [
  {
    href: "/obligations/payroll",
    icon: Banknote,
    title: "Nómina",
    area: "Recursos humanos",
    source: "Buk (simulado)",
    description:
      "Pacta lee la nómina del mes, aplica las reglas de la empresa (retirados, cambios de cuenta, primas, fondos) y simula el pago de las líneas que puede aprobar.",
    steps: "7 pasos · 12 escenarios de prueba",
  },
  {
    href: "/obligations/fiscal",
    icon: Landmark,
    title: "Impuestos",
    area: "Tributación",
    source: "Contabilidad (simulada)",
    description:
      "Pacta compara el borrador de la contabilidad con la liquidación que confirma una persona, avisa antes del vencimiento y simula el pago. No calcula impuestos.",
    steps: "8 pasos · 2 escenarios de prueba",
  },
] as const;

export default function ObligationsPage() {
  return (
    <PlatformSection
      title="Obligaciones"
      description="Pagos recurrentes que Pacta valida antes de soltarlos. Elige un caso de uso: cada uno es un flujo de pasos que puedes recorrer. Todo es simulado: aprobada significa aprobada para pago simulado y no se mueve dinero."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {USE_CASES.map(({ href, icon: Icon, title, area, source, description, steps }) => (
          <Card key={href}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="size-5 text-muted-foreground" aria-hidden />
                {title}
              </CardTitle>
              <CardDescription>
                {area} · fuente: {source}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <p className="text-muted-foreground">{description}</p>
              <div className="flex items-center justify-between gap-2">
                <Badge variant="outline">{steps}</Badge>
                <Link href={href} className={cn(buttonVariants({ size: "sm" }))}>
                  Abrir flujo
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PlatformSection>
  );
}
