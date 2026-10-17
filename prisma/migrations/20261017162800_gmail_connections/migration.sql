-- CreateEnum
CREATE TYPE "GmailConnectionStatus" AS ENUM ('pending', 'active', 'failed', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "GmailInboundProcessingStatus" AS ENUM ('received', 'processing', 'processed', 'failed', 'ignored');

-- CreateTable
CREATE TABLE "gmail_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connected_by_user_id" TEXT NOT NULL,
    "composio_user_id" TEXT NOT NULL,
    "composio_connected_account_id" TEXT NOT NULL,
    "composio_auth_config_id" TEXT NOT NULL,
    "composio_trigger_id" TEXT,
    "email_address" TEXT,
    "alias" TEXT,
    "status" "GmailConnectionStatus" NOT NULL,
    "connected_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gmail_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_inbound_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "gmail_connection_id" TEXT NOT NULL,
    "composio_event_id" TEXT NOT NULL,
    "gmail_message_id" TEXT NOT NULL,
    "gmail_thread_id" TEXT,
    "sender" TEXT,
    "subject" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "processing_status" "GmailInboundProcessingStatus" NOT NULL,
    "invoice_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gmail_inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gmail_connections_composio_connected_account_id_key" ON "gmail_connections"("composio_connected_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_connections_composio_trigger_id_key" ON "gmail_connections"("composio_trigger_id");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_connections_email_address_key" ON "gmail_connections"("email_address");

-- CreateIndex
CREATE INDEX "gmail_connections_organization_id_idx" ON "gmail_connections"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_inbound_messages_composio_event_id_key" ON "gmail_inbound_messages"("composio_event_id");

-- CreateIndex
CREATE INDEX "gmail_inbound_messages_organization_id_received_at_idx" ON "gmail_inbound_messages"("organization_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_inbound_messages_gmail_connection_id_gmail_message_id_key" ON "gmail_inbound_messages"("gmail_connection_id", "gmail_message_id");

-- AddForeignKey
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_connections" ADD CONSTRAINT "gmail_connections_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_inbound_messages" ADD CONSTRAINT "gmail_inbound_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_inbound_messages" ADD CONSTRAINT "gmail_inbound_messages_gmail_connection_id_fkey" FOREIGN KEY ("gmail_connection_id") REFERENCES "gmail_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
