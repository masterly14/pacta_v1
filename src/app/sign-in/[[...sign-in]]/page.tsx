import { Suspense } from "react";
import { SignIn } from "@clerk/nextjs";
import { connection } from "next/server";

// Clerk lee la ruta y la sesión: la vista se renderiza en runtime, no en build.
async function DynamicSignIn() {
  await connection();
  return <SignIn />;
}

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={null}>
        <DynamicSignIn />
      </Suspense>
    </main>
  );
}
