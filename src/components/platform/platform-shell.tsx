import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { PlatformMenu, PlatformNavLinks } from "./platform-nav";

export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1">
      <aside className="hidden w-56 shrink-0 flex-col border-r md:flex">
        <div className="px-4 py-5">
          <Link
            href="/platform"
            className="text-base font-semibold tracking-tight"
          >
            Pacta
          </Link>
        </div>
        <PlatformNavLinks className="px-2" />
        <div className="mt-auto border-t p-3">
          <UserButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:px-6">
          <PlatformMenu />
          <OrganizationSwitcher
            hidePersonal={false}
            afterSelectOrganizationUrl="/platform/invoices"
            afterCreateOrganizationUrl="/platform/invoices"
          />
          <div className="ml-auto md:hidden">
            <UserButton />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
