import type { Metadata } from "next";
import { Raleway } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clerkAppearance, clerkLocalization } from "@/lib/clerk";
import "./globals.css";

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-raleway",
});

export const metadata: Metadata = {
  title: "Pacta",
  description: "Agente de IA que decide si pagar, frenar o escalar facturas.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ClerkProvider
      localization={clerkLocalization}
      appearance={clerkAppearance}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/platform"
      signUpFallbackRedirectUrl="/platform"
      afterSignOutUrl="/"
    >
      <html
        lang="es"
        className={`${raleway.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
