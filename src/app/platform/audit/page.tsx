import type { Metadata } from "next";
import { PlatformSection } from "@/components/platform/section";

export const metadata: Metadata = { title: "Auditoría" };

export default function AuditPage() {
  return (
    <PlatformSection
      title="Auditoría"
      description="Decisiones anteriores, con la regla, la evidencia y quién actuó. No se reescriben."
    >
      <p className="text-sm text-muted-foreground">
        Aún no hay decisiones registradas.
      </p>
    </PlatformSection>
  );
}