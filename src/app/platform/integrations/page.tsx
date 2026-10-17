import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { GmailIntegrations } from "@/features/invoices/gmail/gmail-integrations";

export const metadata: Metadata = { title: "Integraciones" };

export default function IntegrationsPage() {
  return (
    <PlatformSection
      title="Integraciones"
      description="Conecta buzones de la organización para recibir facturas. Un correo conectado no autoriza pagos."
    >
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando integraciones…</p>}>
        <GmailIntegrations />
      </Suspense>
    </PlatformSection>
  );
}
