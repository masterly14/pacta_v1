import { Suspense } from "react";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { PlatformShell } from "@/components/platform/platform-shell";

export const metadata: Metadata = {
  title: {
    default: "Plataforma",
    template: "%s · Pacta",
  },
};

async function ProtectedPlatform({ children }: { children: React.ReactNode }) {
  await connection();
  await auth.protect();
  return <PlatformShell>{children}</PlatformShell>;
}

export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          aria-label="Cargando plataforma"
          className="flex flex-1"
        />
      }
    >
      <ProtectedPlatform>{children}</ProtectedPlatform>
    </Suspense>
  );
}
