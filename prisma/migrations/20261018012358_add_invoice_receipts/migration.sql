-- CreateEnum
CREATE TYPE "InvoiceDocumentKind" AS ENUM ('invoice', 'receipt');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "document_kind" "InvoiceDocumentKind",
ADD COLUMN     "paid_on" DATE,
ADD COLUMN     "payment_method" TEXT;

-- CreateIndex
CREATE INDEX "invoices_organization_id_document_kind_paid_on_idx" ON "invoices"("organization_id", "document_kind", "paid_on");

