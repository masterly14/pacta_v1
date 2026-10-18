"use client";
/**
 * Purpose: modal "Nuevo contrato": primero se elige el modo. Reactivo = se conecta a la fuente de
 *   datos y compara las facturas que llegan (el formulario de siempre). Proactivo = Pacta se adelanta
 *   y valida pagos recurrentes: se elige la plantilla (nómina, impuestos) o se inicia en blanco.
 * Runs in: browser.
 * Triggered by: el botón "Nuevo contrato" de /platform/contracts (solo administradores).
 * Receives → Returns: proveedores y fecha de hoy → botón + modal de dos pasos.
 * Talks to: ./contract-forms (ContractForm), next/navigation (router), shadcn Dialog, Button.
 */
import { ArrowLeft, Banknote, FilePlus2, Landmark, Plug, Radar, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ContractForm } from "./contract-forms";

type Step = "mode" | "reactive" | "proactive";

const TEMPLATES: { key: string; icon: LucideIcon; title: string; description: string }[] = [
  { key: "payroll", icon: Banknote, title: "Nómina", description: "Recursos humanos: lee la nómina del mes y valida cada pago antes de soltarlo." },
  { key: "fiscal", icon: Landmark, title: "Impuestos", description: "Tributación: compara la contabilidad con la liquidación confirmada y avisa antes del vencimiento." },
  { key: "blank", icon: FilePlus2, title: "Iniciar en blanco", description: "Arma tu propio flujo añadiendo y conectando pasos." },
];

function Choice({ icon: Icon, title, description, onClick }: { icon: LucideIcon; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1.5 rounded-xl p-4 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

export function NewContractDialog({ suppliers, today }: { suppliers: { id: string; name: string }[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("mode");

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setStep("mode"); // al reabrir se empieza por elegir el modo
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>Nuevo contrato</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        {step === "mode" && (
          <>
            <DialogHeader>
              <DialogTitle>Nuevo contrato</DialogTitle>
              <DialogDescription>¿Cómo trabaja este contrato?</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice
                icon={Plug}
                title="Reactivo"
                description="Se conecta a la fuente de datos: cada factura que llega se compara con el contrato y las diferencias se escalan."
                onClick={() => setStep("reactive")}
              />
              <Choice
                icon={Radar}
                title="Proactivo"
                description="Pacta se adelanta: reúne la evidencia por su cuenta y valida los pagos recurrentes antes de soltarlos."
                onClick={() => setStep("proactive")}
              />
            </div>
          </>
        )}

        {step === "reactive" && (
          <>
            <DialogHeader>
              <DialogTitle>Contrato reactivo</DialogTitle>
              <DialogDescription>Se crea con un flujo básico (vigencia → monto → cuenta). Después puedes abrir el editor para añadir condiciones, hitos, plazos y tolerancias.</DialogDescription>
            </DialogHeader>
            <ContractForm
              suppliers={suppliers}
              today={today}
              compact
              onCreated={() => {
                onOpenChange(false);
              }}
            />
            <Button variant="ghost" size="sm" className="w-fit" onClick={() => setStep("mode")}>
              <ArrowLeft aria-hidden /> Atrás
            </Button>
          </>
        )}

        {step === "proactive" && (
          <>
            <DialogHeader>
              <DialogTitle>Contrato proactivo</DialogTitle>
              <DialogDescription>Elige una plantilla para empezar o inicia en blanco.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <Choice key={t.key} icon={t.icon} title={t.title} description={t.description} onClick={() => router.push(`/obligations/${t.key}`)} />
              ))}
            </div>
            <Button variant="ghost" size="sm" className="w-fit" onClick={() => setStep("mode")}>
              <ArrowLeft aria-hidden /> Atrás
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
