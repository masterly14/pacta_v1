-- Notification recipients and inbound channel messages (WhatsApp / Slack). Stored values are
-- English; only the text people receive is Spanish.
--
-- Idempotent: the shared development database already has these tables from an unmerged
-- migration (20261018000000_add_notification_inbound) whose InboundMessageContext values were
-- Spanish. There the enum values are renamed; on a fresh database everything is created.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationChannel') THEN
    CREATE TYPE "NotificationChannel" AS ENUM ('whatsapp', 'slack', 'email');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationRecipientStatus') THEN
    CREATE TYPE "NotificationRecipientStatus" AS ENUM ('active', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InboundMessageContext') THEN
    CREATE TYPE "InboundMessageContext" AS ENUM ('quoted_request', 'single_pending', 'ambiguous', 'no_open_approvals', 'request_not_pending');
  ELSIF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'InboundMessageContext' AND e.enumlabel = 'solicitud_citada'
  ) THEN
    ALTER TYPE "InboundMessageContext" RENAME VALUE 'solicitud_citada' TO 'quoted_request';
    ALTER TYPE "InboundMessageContext" RENAME VALUE 'unica_pendiente' TO 'single_pending';
    ALTER TYPE "InboundMessageContext" RENAME VALUE 'ambigua' TO 'ambiguous';
    ALTER TYPE "InboundMessageContext" RENAME VALUE 'sin_aprobaciones_abiertas' TO 'no_open_approvals';
    ALTER TYPE "InboundMessageContext" RENAME VALUE 'solicitud_no_pendiente' TO 'request_not_pending';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notification_recipients" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "status" "NotificationRecipientStatus" NOT NULL DEFAULT 'active',
    "verified_at" TIMESTAMPTZ(6),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inbound_channel_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "event_key" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "reply_to_provider_message_id" TEXT,
    "text" TEXT,
    "button_payload" TEXT,
    "claimed_action" TEXT,
    "context" "InboundMessageContext" NOT NULL,
    "approval_request_id" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_channel_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notification_recipients_organization_id_idx" ON "notification_recipients"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_recipients_channel_address_key" ON "notification_recipients"("channel", "address");
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_channel_messages_event_key_key" ON "inbound_channel_messages"("event_key");
CREATE INDEX IF NOT EXISTS "inbound_channel_messages_organization_id_received_at_idx" ON "inbound_channel_messages"("organization_id", "received_at");
CREATE INDEX IF NOT EXISTS "inbound_channel_messages_approval_request_id_idx" ON "inbound_channel_messages"("approval_request_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_recipients_organization_id_fkey') THEN
    ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_channel_messages_organization_id_fkey') THEN
    ALTER TABLE "inbound_channel_messages" ADD CONSTRAINT "inbound_channel_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_channel_messages_recipient_id_fkey') THEN
    ALTER TABLE "inbound_channel_messages" ADD CONSTRAINT "inbound_channel_messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "notification_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- Garantía no expresable en Prisma (@db-guarantee).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_recipients_whatsapp_address_check') THEN
    ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_whatsapp_address_check"
      CHECK ("channel" <> 'whatsapp' OR "address" ~ '^[1-9][0-9]{6,14}$');
  END IF;
END $$;
