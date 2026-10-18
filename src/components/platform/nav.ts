import {
  FileText,
  History,
  LayoutDashboard,
  Landmark,
  Plug,
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
  { href: "/platform/approvals", label: "Aprobaciones", icon: UserCheck },
  { href: "/platform/audit", label: "Auditoría", icon: History },
];
