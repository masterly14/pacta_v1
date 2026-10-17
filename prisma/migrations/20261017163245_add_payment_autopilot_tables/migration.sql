-- CreateEnum
CREATE TYPE "PaymentAuthorizationScope" AS ENUM ('one_time', 'recurring');

-- CreateEnum
CREATE TYPE "PaymentAuthorizationStatus" AS ENUM ('active', 'revoked', 'consumed');

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');

-- CreateEnum
CREATE TYPE "PaymentDecisionOutcome" AS ENUM ('approved', 'blocked', 'requires_approval');

-- CreateEnum
CREATE TYPE "PaymentDecisionSource" AS ENUM ('automatic', 'human');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "beneficiary_account_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "auto_approval_limit_minor" INTEGER NOT NULL,
    "monthly_budget_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_authorizations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "beneficiary_account_ref" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "max_amount_minor" INTEGER NOT NULL,
    "scope" "PaymentAuthorizationScope" NOT NULL,
    "frequency" "PaymentFrequency",
    "valid_from" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "status" "PaymentAuthorizationStatus" NOT NULL DEFAULT 'active',
    "authorized_by" TEXT NOT NULL,
    "source_approval_request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" TEXT,

    CONSTRAINT "payment_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_permissions" (
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "can_approve" BOOLEAN NOT NULL DEFAULT false,
    "approval_limit_minor" INTEGER,
    "can_manage_policies" BOOLEAN NOT NULL DEFAULT false,
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "approval_permissions_pkey" PRIMARY KEY ("user_id","organization_id")
);

-- CreateTable
CREATE TABLE "payment_decisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "invoice_number" TEXT,
    "amount_minor" INTEGER,
    "currency" CHAR(3),
    "decision" "PaymentDecisionOutcome" NOT NULL,
    "decision_source" "PaymentDecisionSource" NOT NULL,
    "reason_codes" JSONB NOT NULL,
    "rules_evaluated" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "policy_version" INTEGER,
    "actor_id" TEXT,
    "approval_request_id" TEXT,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "comment" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_import_batches" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "imported_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "import_batch_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "posted_on" DATE NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "external_ref" TEXT,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_normalized_name_key" ON "suppliers"("organization_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "payment_policies_organization_id_version_key" ON "payment_policies"("organization_id", "version");

-- CreateIndex
CREATE INDEX "payment_authorizations_organization_id_supplier_id_status_idx" ON "payment_authorizations"("organization_id", "supplier_id", "status");

-- CreateIndex
CREATE INDEX "payment_decisions_organization_id_invoice_id_idx" ON "payment_decisions"("organization_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payment_decisions_organization_id_supplier_id_invoice_numbe_idx" ON "payment_decisions"("organization_id", "supplier_id", "invoice_number");

-- CreateIndex
CREATE INDEX "payment_decisions_organization_id_decision_evaluated_at_idx" ON "payment_decisions"("organization_id", "decision", "evaluated_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_decision_id_key" ON "approval_requests"("decision_id");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_status_requested_at_idx" ON "approval_requests"("organization_id", "status", "requested_at");

-- CreateIndex
CREATE INDEX "bank_import_batches_organization_id_created_at_idx" ON "bank_import_batches"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "bank_transactions_organization_id_supplier_id_posted_on_idx" ON "bank_transactions"("organization_id", "supplier_id", "posted_on");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_organization_id_fingerprint_key" ON "bank_transactions"("organization_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_organization_id_external_ref_key" ON "bank_transactions"("organization_id", "external_ref");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_entity_type_entity_id_idx" ON "audit_events"("organization_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_policies" ADD CONSTRAINT "payment_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_permissions" ADD CONSTRAINT "approval_permissions_user_id_organization_id_fkey" FOREIGN KEY ("user_id", "organization_id") REFERENCES "organization_memberships"("user_id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "payment_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_import_batches" ADD CONSTRAINT "bank_import_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "bank_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Garantías que Prisma no expresa (docs/plans/developer-b-payment-decisions.md)
-- ---------------------------------------------------------------------------

-- Importes y monedas
ALTER TABLE "payment_policies" ADD CONSTRAINT "payment_policies_amounts_check"
  CHECK ("version" > 0 AND "auto_approval_limit_minor" >= 0 AND "monthly_budget_minor" >= 0 AND "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "payment_authorizations" ADD CONSTRAINT "payment_authorizations_terms_check"
  CHECK (
    "max_amount_minor" > 0
    AND "currency" ~ '^[A-Z]{3}$'
    AND "valid_until" >= "valid_from"
    AND (("scope" = 'recurring' AND "frequency" IS NOT NULL) OR ("scope" = 'one_time' AND "frequency" IS NULL))
  );

-- Un aprobador siempre tiene un límite explícito (no hay aprobadores ilimitados)
ALTER TABLE "approval_permissions" ADD CONSTRAINT "approval_permissions_limit_check"
  CHECK (
    ("can_approve" = false AND "approval_limit_minor" IS NULL)
    OR ("can_approve" = true AND "approval_limit_minor" IS NOT NULL AND "approval_limit_minor" > 0)
  );

-- Una decisión humana tiene actor y resuelve una solicitud; una automática no tiene actor
ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_actor_check"
  CHECK (
    ("decision_source" = 'automatic' AND "actor_id" IS NULL)
    OR ("decision_source" = 'human' AND "actor_id" IS NOT NULL AND "approval_request_id" IS NOT NULL)
  );

-- Una aprobación requiere versión de política, importe y moneda (para reservar presupuesto)
ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_approved_check"
  CHECK ("decision" <> 'approved' OR ("policy_version" IS NOT NULL AND "amount_minor" IS NOT NULL AND "currency" IS NOT NULL));

-- Idempotencia: una factura se aprueba (y reserva presupuesto) a lo sumo una vez
CREATE UNIQUE INDEX "payment_decisions_one_approved_per_invoice"
  ON "payment_decisions"("organization_id", "invoice_id") WHERE "decision" = 'approved';

-- A lo sumo una solicitud pendiente por factura
CREATE UNIQUE INDEX "approval_requests_one_pending_per_invoice"
  ON "approval_requests"("organization_id", "invoice_id") WHERE "status" = 'pending';

-- Registros append-only: las decisiones y la auditoría no se editan ni se borran
CREATE FUNCTION "reject_append_only_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payment_decisions_append_only"
  BEFORE UPDATE OR DELETE ON "payment_decisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
