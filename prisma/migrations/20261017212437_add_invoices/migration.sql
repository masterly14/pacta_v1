-- CreateEnum
CREATE TYPE "InvoiceIntakeSource" AS ENUM ('email', 'dashboard');

-- CreateEnum
CREATE TYPE "InvoiceSupplierMatch" AS ENUM ('matched', 'ambiguous', 'not_found');

-- CreateEnum
CREATE TYPE "InvoiceExtractionStatus" AS ENUM ('pending', 'processing', 'extracted', 'failed');

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source" "InvoiceIntakeSource" NOT NULL,
    "document_group_id" TEXT,
    "gmail_inbound_message_id" TEXT,
    "primary_document_id" TEXT,
    "extraction_status" "InvoiceExtractionStatus" NOT NULL DEFAULT 'pending',
    "extraction_error" TEXT,
    "supplier_id" TEXT,
    "supplier_match_status" "InvoiceSupplierMatch",
    "name" TEXT,
    "invoice_number" TEXT,
    "amount_minor" INTEGER,
    "currency" CHAR(3),
    "invoice_date" DATE,
    "due_date" DATE,
    "context_json" JSONB,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_document_group_id_key" ON "invoices"("document_group_id");

-- CreateIndex
CREATE INDEX "invoices_organization_id_received_at_idx" ON "invoices"("organization_id", "received_at");

-- CreateIndex
CREATE INDEX "invoices_organization_id_extraction_status_idx" ON "invoices"("organization_id", "extraction_status");

-- CreateIndex
CREATE INDEX "invoices_gmail_inbound_message_id_idx" ON "invoices"("gmail_inbound_message_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_group_id_fkey" FOREIGN KEY ("document_group_id") REFERENCES "document_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_gmail_inbound_message_id_fkey" FOREIGN KEY ("gmail_inbound_message_id") REFERENCES "gmail_inbound_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_primary_document_id_fkey" FOREIGN KEY ("primary_document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

