import type { Metadata } from "next";
import { PlatformSection } from "@/components/platform/section";

export const metadata: Metadata = { title: "Historial" };

export default function PaymentHistoryPage() {
  return (
    <PlatformSection
      title="Historial de pagos"
      description="Movimientos importados desde un CSV. Sirven para detectar recurrencias y no conceden permiso de pago."
    >
      <p className="text-sm text-muted-foreground">
        Todavía no hay un extracto importado.
      </p>
    </PlatformSection>
  );
}
