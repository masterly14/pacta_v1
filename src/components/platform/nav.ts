import {
  FileText,
  CalendarClock,
  History,
  LayoutDashboard,
  Landmark,
  Plug,
  Repeat,
  ScrollText,
  Shield,
  UserCheck,
  type LucideIcon,
} from "lucide-react";

export type PlatformNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const platformNav: PlatformNavItem[] = [
  { href: "/platform", label: "Resumen", icon: LayoutDashboard },
  { href: "/platform/invoices", label: "Facturas", icon: FileText },
  { href: "/platform/integrations", label: "Integraciones", icon: Plug },
  { href: "/platform/contracts", label: "Contratos", icon: ScrollText },
  { href: "/platform/payment-history", label: "Historial", icon: Landmark },
  { href: "/platform/policies", label: "Políticas", icon: Shield },
  { href: "/platform/obligations", label: "Obligaciones", icon: Repeat },
  { href: "/platform/runs", label: "Corridas", icon: CalendarClock },
  { href: "/platform/approvals", label: "Aprobaciones", icon: UserCheck },
  { href: "/platform/audit", label: "Auditoría", icon: History },
];
