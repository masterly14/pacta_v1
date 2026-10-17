import type { Metadata } from "next";
import { PlatformSection } from "@/components/platform/section";

export const metadata: Metadata = { title: "Aprobaciones" };

export default function ApprovalsPage() {
  return (
    <PlatformSection
      title="Aprobaciones"
      description="Facturas que una persona debe resolver. Antes de confirmar, se vuelven a evaluar las reglas vigentes."
    >
      <p className="text-sm text-muted-foreground">
        No hay nada esperando aprobación.
      </p>
    </PlatformSection>
  );
}
