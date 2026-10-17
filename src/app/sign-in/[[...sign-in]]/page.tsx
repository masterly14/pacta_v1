import { SignIn } from "@clerk/nextjs";
import { connection } from "next/server";
import { AuthScreen } from "@/components/auth-screen";

// Clerk lee la ruta y la sesión: la vista se renderiza en runtime, no en build.
async function DynamicSignIn() {
  await connection();
  return (
    <SignIn
      path="/sign-in"
      routing="path"
      signUpUrl="/sign-up"
      fallbackRedirectUrl="/platform"
    />
  );
}

export default function SignInPage() {
  return (
    <AuthScreen label="Cargando inicio de sesión">
      <DynamicSignIn />
    </AuthScreen>
  );
}
