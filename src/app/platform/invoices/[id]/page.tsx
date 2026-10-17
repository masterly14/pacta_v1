import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PlatformSection } from "@/components/platform/section";

export const metadata: Metadata = { title: "Factura" };

async function InvoiceIdentity({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <p className="text-sm text-muted-foreground">
      No hay una factura con el identificador{" "}
      <span className="font-mono text-foreground">{id}</span>.
    </p>
  );
}

export default function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <PlatformSection
      title="Factura"
      description="El detalle muestra la evidencia extraída y, cuando exista, la decisión registrada. Esta ruta no inventa datos."
    >
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Cargando factura…</p>
        }
      >
        <InvoiceIdentity params={params} />
      </Suspense>
      <Link
        href="/platform/invoices"
        className="mt-4 text-sm font-medium underline-offset-4 hover:underline"
      >
        Volver a facturas
      </Link>
    </PlatformSection>
  );
}
