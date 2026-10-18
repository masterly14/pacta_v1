"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { Menu } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { platformNav } from "./nav";

function isCurrent(pathname: string, href: string) {
  // /platform es el resumen: solo activo en su propia ruta, no en cada subpágina.
  if (href === "/platform") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlatformNavLinks({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  // Un id por instancia (barra lateral y menú móvil) para que el resaltado no salte entre ambas.
  const layoutId = `platform-nav-active-${useId()}`;
  const reduced = useReducedMotion();

  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      {platformNav.map((item) => {
        const active = isCurrent(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {/* El fondo del elemento activo se desliza al cambiar de página. */}
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-muted"
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <Icon className="relative size-4 shrink-0 transition-transform duration-200 group-hover:scale-110" />
            <span className="relative">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function PlatformMenu() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" />
        }
      >
        <Menu />
        <span className="sr-only">Abrir menú</span>
      </SheetTrigger>
      <SheetContent side="left" className="w-64">
        <SheetHeader>
          <SheetTitle>Pacta</SheetTitle>
        </SheetHeader>
        <PlatformNavLinks
          className="px-2"
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
