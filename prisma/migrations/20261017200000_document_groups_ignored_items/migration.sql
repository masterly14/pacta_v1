-- CreateEnum
CREATE TYPE "DocumentGroupKind" AS ENUM ('invoice_candidate', 'message_context');

-- CreateEnum
CREATE TYPE "DocumentRole" AS ENUM ('primary', 'supporting');

-- CreateEnum
CREATE TYPE "IgnoredItemKind" AS ENUM ('attachment', 'message');

-- CreateEnum
CREATE TYPE "IgnoredItemReason" AS ENUM ('unsupported_mime_type', 'empty_file', 'file_too_large', 'missing_content', 'duplicate_content', 'fetch_failed', 'no_usable_content');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "group_id" TEXT,
ADD COLUMN     "group_role" "DocumentRole";

-- CreateTable
CREATE TABLE "document_groups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "gmail_inbound_message_id" TEXT NOT NULL,
    "kind" "DocumentGroupKind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ignored_inbound_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "gmail_inbound_message_id" TEXT NOT NULL,
    "kind" "IgnoredItemKind" NOT NULL,
    "gmail_attachment_id" TEXT,
    "filename" TEXT,
    "mime_type" TEXT,
    "byte_size" INTEGER,
    "reason" "IgnoredItemReason" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ignored_inbound_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_groups_organization_id_idx" ON "document_groups"("organization_id");

-- CreateIndex
CREATE INDEX "document_groups_gmail_inbound_message_id_idx" ON "document_groups"("gmail_inbound_message_id");

-- CreateIndex
CREATE INDEX "ignored_inbound_items_organization_id_idx" ON "ignored_inbound_items"("organization_id");

-- CreateIndex
CREATE INDEX "ignored_inbound_items_gmail_inbound_message_id_idx" ON "ignored_inbound_items"("gmail_inbound_message_id");

-- CreateIndex
CREATE INDEX "documents_group_id_idx" ON "documents"("group_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "document_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_groups" ADD CONSTRAINT "document_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_groups" ADD CONSTRAINT "document_groups_gmail_inbound_message_id_fkey" FOREIGN KEY ("gmail_inbound_message_id") REFERENCES "gmail_inbound_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ignored_inbound_items" ADD CONSTRAINT "ignored_inbound_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ignored_inbound_items" ADD CONSTRAINT "ignored_inbound_items_gmail_inbound_message_id_fkey" FOREIGN KEY ("gmail_inbound_message_id") REFERENCES "gmail_inbound_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
