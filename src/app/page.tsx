import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Pacta</h1>
      <p className="max-w-md text-muted-foreground">
        Agente de IA para facturas: decide si pagar, frenar o escalar a una
        persona según las reglas de la empresa. Proyecto de hackathon, no mueve
        dinero real.
      </p>
      <div className="flex gap-3">
        <Link href="/sign-in" className={buttonVariants()}>
          Iniciar sesión
        </Link>
        <Link href="/sign-up" className={buttonVariants({ variant: "outline" })}>
          Crear cuenta
        </Link>
      </div>
    </main>
  );
}
