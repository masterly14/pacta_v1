-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('whatsapp', 'slack', 'email');

-- CreateEnum
CREATE TYPE "NotificationRecipientStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "InboundMessageContext" AS ENUM ('solicitud_citada', 'unica_pendiente', 'ambigua', 'sin_aprobaciones_abiertas', 'solicitud_no_pendiente');

-- CreateTable
CREATE TABLE "notification_recipients" (
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

-- CreateTable
CREATE TABLE "inbound_channel_messages" (
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

-- CreateIndex
CREATE INDEX "notification_recipients_organization_id_idx" ON "notification_recipients"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_recipients_channel_address_key" ON "notification_recipients"("channel", "address");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_channel_messages_event_key_key" ON "inbound_channel_messages"("event_key");

-- CreateIndex
CREATE INDEX "inbound_channel_messages_organization_id_received_at_idx" ON "inbound_channel_messages"("organization_id", "received_at");

-- CreateIndex
CREATE INDEX "inbound_channel_messages_approval_request_id_idx" ON "inbound_channel_messages"("approval_request_id");

-- AddForeignKey
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_channel_messages" ADD CONSTRAINT "inbound_channel_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_channel_messages" ADD CONSTRAINT "inbound_channel_messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "notification_recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Garantías no expresables en Prisma (@db-guarantee)
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_whatsapp_address_check"
  CHECK ("channel" <> 'whatsapp' OR "address" ~ '^[1-9][0-9]{6,14}$');

-- ---------------------------------------------------------------------------
-- Estados y trazabilidad en español (valores almacenados). RENAME VALUE conserva los índices
-- parciales y los CHECK que comparan contra estos enums (referencian el valor, no el texto).
-- ---------------------------------------------------------------------------
ALTER TYPE "PaymentDecisionOutcome" RENAME VALUE 'approved' TO 'aprobada';
ALTER TYPE "PaymentDecisionOutcome" RENAME VALUE 'blocked' TO 'bloqueada';
ALTER TYPE "PaymentDecisionOutcome" RENAME VALUE 'requires_approval' TO 'requiere_aprobacion';
ALTER TYPE "PaymentDecisionSource" RENAME VALUE 'automatic' TO 'automatica';
ALTER TYPE "PaymentDecisionSource" RENAME VALUE 'human' TO 'humana';
ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'pending' TO 'pendiente';
ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'approved' TO 'aprobada';
ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'rejected' TO 'rechazada';
ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'cancelled' TO 'cancelada';

-- No se reescribe ninguna fila: payment_decisions y audit_events son append-only. Las decisiones
-- y eventos anteriores conservan sus valores originales (los JSON viejos se leen con
-- normalizeLegacyDecisionPayload en src/shared/schemas/payment-decision.ts).
