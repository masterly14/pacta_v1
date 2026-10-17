import { Composio } from "@composio/core";

let client: Composio | undefined;

/** Versión fechada del toolkit Gmail. `tools.execute` no acepta `latest` sin bypass. */
export const COMPOSIO_GMAIL_TOOLKIT_VERSION =
  process.env.COMPOSIO_TOOLKIT_VERSION_GMAIL?.trim() || "20251027_00";

export function getComposioApiKey(): string {
  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    throw new Error("COMPOSIO_API_KEY no está definida");
  }
  return apiKey;
}

export function getComposioAuthConfigId(): string {
  const id = process.env.COMPOSIO_AUTH_CONFIG_ID;
  if (!id) {
    throw new Error("COMPOSIO_AUTH_CONFIG_ID no está definida");
  }
  return id;
}

export function getComposioWebhookSecret(): string {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("COMPOSIO_WEBHOOK_SECRET no está definida");
  }
  return secret;
}

export function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error("APP_URL no está definida");
  }
  return url.replace(/\/$/, "");
}

export function getComposio(): Composio {
  if (!client) {
    client = new Composio({
      apiKey: getComposioApiKey(),
      toolkitVersions: { gmail: COMPOSIO_GMAIL_TOOLKIT_VERSION },
    });
  }
  return client;
}
