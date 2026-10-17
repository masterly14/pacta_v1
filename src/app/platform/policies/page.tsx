import type { Metadata } from "next";
import { PlatformSection } from "@/components/platform/section";

export const metadata: Metadata = { title: "Políticas" };

export default function PoliciesPage() {
  return (
    <PlatformSection
      title="Políticas"
      description="Límites, presupuesto y autorizaciones explícitas. Solo estas reglas pueden producir una aprobación."
    >
      <p className="text-sm text-muted-foreground">
        Esta organización aún no tiene políticas guardadas.
      </p>
    </PlatformSection>
  );
}
