import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { pageWindow } from "./page-window";

// Paginación por URL (?page=N): funciona sin JavaScript y cada página se puede enlazar.
export function Pagination({
  page,
  pageCount,
  hrefFor,
  className,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const item = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition-colors";
  return (
    <nav aria-label="Paginación" className={cn("flex items-center justify-center gap-1", className)}>
      <PageLink href={hrefFor(page - 1)} disabled={page === 1} className={item} label="Página anterior">
        <ChevronLeft className="size-4" />
      </PageLink>
      {pageWindow(page, pageCount).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className={cn(item, "text-muted-foreground")} aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(item, p === page ? "bg-foreground font-medium text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
          >
            {p}
          </Link>
        ),
      )}
      <PageLink href={hrefFor(page + 1)} disabled={page === pageCount} className={item} label="Página siguiente">
        <ChevronRight className="size-4" />
      </PageLink>
    </nav>
  );
}

function PageLink({ href, disabled, className, label, children }: { href: string; disabled: boolean; className: string; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <span aria-disabled className={cn(className, "text-muted-foreground/40")}>
        {children}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <Link href={href} className={cn(className, "text-muted-foreground hover:bg-muted hover:text-foreground")}>
      {children}
      <span className="sr-only">{label}</span>
    </Link>
  );
}
