import { getAppUrl, getComposio } from "../src/lib/composio.ts";

async function main() {
  const webhookUrl = `${getAppUrl()}/api/webhooks/composio`;
  const composio = getComposio();
  const subscription = await composio.triggers.setWebhookSubscription({
    webhookUrl,
    version: "V3",
  });
  const secret =
    subscription && typeof subscription === "object" && "secret" in subscription
      ? String(subscription.secret)
      : null;
  console.log("Webhook URL:", webhookUrl);
  console.log("Suscripción:", JSON.stringify(subscription, null, 2));
  if (secret) {
    console.log("Copia este valor a COMPOSIO_WEBHOOK_SECRET (no lo regeneres en cada deploy):");
    console.log(secret);
  } else {
    console.log("Si Composio no imprimió un secret, usa el que ya está en el dashboard del proyecto.");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
