import type { GmailConnectionStatus } from "@/shared/schemas/gmail-connection";
import { cn } from "@/lib/utils";

const STATUS_COPY: Record<
  GmailConnectionStatus,
  { label: string; tone: "online" | "away" | "offline" | "idle" | "unknown" }
> = {
  active: { label: "Conectado", tone: "online" },
  pending: { label: "Pendiente", tone: "away" },
  failed: { label: "Falló", tone: "offline" },
  expired: { label: "Expiró", tone: "offline" },
  revoked: { label: "Revocado", tone: "unknown" },
};

const TONE_DOT: Record<(typeof STATUS_COPY)[GmailConnectionStatus]["tone"], string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-red-500",
  idle: "bg-sky-500",
  unknown: "bg-zinc-400",
};

export function MailboxStatus({ status }: { status: GmailConnectionStatus }) {
  const { label, tone } = STATUS_COPY[status];
  const ping = tone === "online" || tone === "away";

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
      <span className="relative flex size-2">
        {ping ? (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-60",
              TONE_DOT[tone],
            )}
          />
        ) : null}
        <span className={cn("relative inline-flex size-2 rounded-full", TONE_DOT[tone])} />
      </span>
      {label}
    </span>
  );
}
