import { SignUp } from "@clerk/nextjs";
import { connection } from "next/server";
import { AuthScreen } from "@/components/auth-screen";

// Clerk lee la ruta y la sesión: la vista se renderiza en runtime, no en build.
async function DynamicSignUp() {
  await connection();
  return (
    <SignUp
      path="/sign-up"
      routing="path"
      signInUrl="/sign-in"
      fallbackRedirectUrl="/platform"
    />
  );
}

export default function SignUpPage() {
  return (
    <AuthScreen label="Cargando registro">
      <DynamicSignUp />
    </AuthScreen>
  );
}
