import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { auth } from "@clerk/nextjs/server";
import { connection } from "next/server";
import { LandingPage } from "@/components/landing/landing-page";

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Pacta",
  description:
    "Pacta conoce las obligaciones programadas de tu empresa, identifica cuándo vencen, reúne la evidencia y paga. Si nota algo raro, te avisa.",
};

async function Landing() {
  await connection();
  const { userId } = await auth();

  return (
    <LandingPage
      className={geist.className}
      enterHref={userId ? "/platform" : "/sign-in"}
    />
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <LandingPage className={geist.className} enterHref="/sign-in" />
      }
    >
      <Landing />
    </Suspense>
  );
}
