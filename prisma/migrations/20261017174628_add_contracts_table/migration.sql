-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('active', 'terminated');

-- CreateEnum
CREATE TYPE "ContractFrequency" AS ENUM ('one_time', 'weekly', 'monthly', 'quarterly', 'yearly');

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'active',
    "agreed_amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "frequency" "ContractFrequency" NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "beneficiary_account_ref" TEXT,
    "description" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminated_at" TIMESTAMPTZ(6),
    "terminated_by" TEXT,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_organization_id_supplier_id_status_idx" ON "contracts"("organization_id", "supplier_id", "status");

-- CreateIndex
CREATE INDEX "contracts_organization_id_created_at_idx" ON "contracts"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garantías que Prisma no expresa (documentadas con @db-guarantee en schema.prisma)
-- ---------------------------------------------------------------------------

-- Términos válidos y estado de terminación coherente
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_terms_check"
  CHECK (
    "agreed_amount_minor" > 0
    AND "currency" ~ '^[A-Z]{3}$'
    AND ("valid_to" IS NULL OR "valid_to" >= "valid_from")
    AND (
      ("status" = 'active' AND "terminated_at" IS NULL AND "terminated_by" IS NULL)
      OR ("status" = 'terminated' AND "terminated_at" IS NOT NULL AND "terminated_by" IS NOT NULL)
    )
  );
