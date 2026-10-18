-- CreateTable
CREATE TABLE "archived_invoices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "archived_by" TEXT,
    "archived_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archived_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "archived_invoices_organization_id_invoice_id_key" ON "archived_invoices"("organization_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "archived_invoices" ADD CONSTRAINT "archived_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

