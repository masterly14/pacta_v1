import { Suspense } from "react";
import { SignUp } from "@clerk/nextjs";
import { connection } from "next/server";

// Clerk lee la ruta y la sesión: la vista se renderiza en runtime, no en build.
async function DynamicSignUp() {
  await connection();
  return <SignUp />;
}

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Suspense fallback={null}>
        <DynamicSignUp />
      </Suspense>
    </main>
  );
}
