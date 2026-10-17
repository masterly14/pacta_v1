import type { Metadata } from "next";
import { PlatformSection } from "@/components/platform/section";

export const metadata: Metadata = { title: "Facturas" };

export default function InvoicesPage() {
  return (
    <PlatformSection
      title="Facturas"
      description="Documentos recibidos por correo o carga manual. Aquí se muestra lo extraído; la decisión de pago la toma el motor de reglas."
    >
      <p className="text-sm text-muted-foreground">
        Aún no llega ninguna factura.
      </p>
    </PlatformSection>
  );
}
