import type { Metadata } from "next";
import { PlatformSection } from "@/components/platform/section";

export const metadata: Metadata = { title: "Contratos" };

export default function ContractsPage() {
  return (
    <PlatformSection
      title="Contratos"
      description="Condiciones para comparar con cada factura. Un contrato no autoriza el pago por sí solo."
    >
      <p className="text-sm text-muted-foreground">No hay contratos cargados.</p>
    </PlatformSection>
  );
}
