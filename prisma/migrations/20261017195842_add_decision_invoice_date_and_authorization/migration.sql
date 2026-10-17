-- AlterTable
ALTER TABLE "payment_decisions" ADD COLUMN     "authorization_id" TEXT,
ADD COLUMN     "invoice_date" DATE;

-- CreateIndex
CREATE INDEX "payment_decisions_authorization_id_decision_invoice_date_idx" ON "payment_decisions"("authorization_id", "decision", "invoice_date");

-- AddForeignKey
ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_authorization_id_fkey" FOREIGN KEY ("authorization_id") REFERENCES "payment_authorizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Garantía que Prisma no expresa: solo una aprobación consume una autorización.
ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_authorization_check"
  CHECK ("authorization_id" IS NULL OR "decision" = 'approved');
