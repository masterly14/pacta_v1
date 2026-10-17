-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('email_body', 'invoice_document');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "gmail_inbound_message_id" TEXT NOT NULL,
    "file_ref" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "original_filename" TEXT,
    "source" "DocumentSource" NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_organization_id_idx" ON "documents"("organization_id");

-- CreateIndex
CREATE INDEX "documents_gmail_inbound_message_id_idx" ON "documents"("gmail_inbound_message_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_gmail_inbound_message_id_fkey" FOREIGN KEY ("gmail_inbound_message_id") REFERENCES "gmail_inbound_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
