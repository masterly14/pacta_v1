import { esES } from "@clerk/localizations";

/** Español de Clerk, con los títulos alineados a la portada. */
export const clerkLocalization = {
  ...esES,
  formFieldInputPlaceholder__signUpPassword: "Crea una contraseña",
  signIn: {
    ...esES.signIn,
    start: {
      ...esES.signIn!.start,
      title: "Iniciar sesión",
      subtitle: "Continúa con las facturas de tu organización.",
      actionLink: "Crear cuenta",
      actionText: "¿No tienes cuenta?",
    },
  },
  signUp: {
    ...esES.signUp,
    start: {
      ...esES.signUp!.start,
      title: "Crear cuenta",
      subtitle: "Registra el acceso de tu organización.",
      actionLink: "Iniciar sesión",
      actionText: "¿Ya tienes cuenta?",
    },
  },
};

export const clerkAppearance = {
  variables: {
    colorPrimary: "#171717",
    colorBackground: "#ffffff",
    colorText: "#171717",
    colorTextSecondary: "#737373",
    colorInputBackground: "#ffffff",
    colorInputText: "#171717",
    colorDanger: "#dc2626",
    borderRadius: "0.625rem",
    fontFamily: "Raleway, ui-sans-serif, system-ui, sans-serif",
    fontFamilyButtons: "Raleway, ui-sans-serif, system-ui, sans-serif",
  },
};
