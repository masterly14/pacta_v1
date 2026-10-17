import { Suspense, type ReactNode } from "react";

export function AuthScreen({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Suspense
        fallback={
          <div
            aria-busy="true"
            aria-label={label}
            className="h-96 w-full max-w-sm animate-pulse rounded-xl border bg-muted/40"
          />
        }
      >
        {children}
      </Suspense>
    </main>
  );
}
