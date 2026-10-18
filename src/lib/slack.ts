// Configuración de Slack. Los secretos solo se leen en servidor.

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} no está definida`);
  }
  return value;
}

export function getSlackBotToken(): string {
  return required("SLACK_BOT_TOKEN");
}

export function getSlackSigningSecret(): string {
  return required("SLACK_SIGNING_SECRET");
}

// Canal destino de las notificaciones (ID tipo C0123ABCD). Ausente ⇒ Slack deshabilitado, no error.
export function getSlackDefaultChannelId(): string | null {
  return process.env.SLACK_DEFAULT_CHANNEL_ID?.trim() || null;
}

// Base absoluta para los enlaces al dashboard.
export function getAppUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}
