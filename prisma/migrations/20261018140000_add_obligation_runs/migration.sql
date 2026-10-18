-- CreateEnum
CREATE TYPE "ObligationKind" AS ENUM ('payroll', 'fiscal');

-- CreateEnum
CREATE TYPE "ObligationStatus" AS ENUM ('draft', 'active', 'paused');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('scheduled', 'collecting_evidence', 'evaluated', 'in_approval', 'ready_to_execute', 'simulated_executed', 'held', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "payment_obligations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "ObligationKind" NOT NULL,
    "status" "ObligationStatus" NOT NULL DEFAULT 'draft',
    "template" JSONB NOT NULL,
    "schedule" JSONB NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_by" TEXT,
    "activated_at" TIMESTAMPTZ(6),

    CONSTRAINT "payment_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_occurrences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "obligation_version" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'scheduled',
    "as_of" TIMESTAMPTZ(6),
    "evidence_sha" TEXT,
    "evaluation" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "obligation_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_line_decisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "counterparty_ref" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "line_type" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" CHAR(3),
    "decision" "PaymentDecisionOutcome" NOT NULL,
    "decision_source" "PaymentDecisionSource" NOT NULL,
    "reason_codes" JSONB NOT NULL,
    "rules" JSONB NOT NULL,
    "decision_key" TEXT NOT NULL,
    "evidence_sha" TEXT NOT NULL,
    "actor_id" TEXT,
    "comment" TEXT,
    "evaluated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_line_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_approval_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "comment" TEXT,

    CONSTRAINT "obligation_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_schedule_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "phase" TEXT NOT NULL,
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "as_of" TIMESTAMPTZ(6) NOT NULL,
    "result" JSONB,

    CONSTRAINT "obligation_schedule_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_simulated_payments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "executed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obligation_simulated_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_confirmations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "obligation_id" TEXT NOT NULL,
    "counterparty_ref" TEXT NOT NULL,
    "beneficiary_reference" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "confirmed_period" DATE NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "obligation_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_clock" (
    "organization_id" TEXT NOT NULL,
    "now" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_clock_pkey" PRIMARY KEY ("organization_id")
);

-- CreateIndex
CREATE INDEX "payment_obligations_organization_id_status_idx" ON "payment_obligations"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_obligations_organization_id_obligation_id_version_key" ON "payment_obligations"("organization_id", "obligation_id", "version");

-- CreateIndex
CREATE INDEX "obligation_occurrences_organization_id_status_due_date_idx" ON "obligation_occurrences"("organization_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_occurrences_organization_id_obligation_id_period_key" ON "obligation_occurrences"("organization_id", "obligation_id", "period_start");

-- CreateIndex
CREATE INDEX "obligation_line_decisions_organization_id_occurrence_id_lin_idx" ON "obligation_line_decisions"("organization_id", "occurrence_id", "line_id", "created_at");

-- CreateIndex
CREATE INDEX "obligation_line_decisions_organization_id_counterparty_ref__idx" ON "obligation_line_decisions"("organization_id", "counterparty_ref", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_approval_requests_decision_id_key" ON "obligation_approval_requests"("decision_id");

-- CreateIndex
CREATE INDEX "obligation_approval_requests_organization_id_status_request_idx" ON "obligation_approval_requests"("organization_id", "status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_schedule_events_organization_id_obligation_id_pe_key" ON "obligation_schedule_events"("organization_id", "obligation_id", "period_start", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_simulated_payments_occurrence_id_line_id_key" ON "obligation_simulated_payments"("occurrence_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_confirmations_organization_id_obligation_id_coun_key" ON "obligation_confirmations"("organization_id", "obligation_id", "counterparty_ref");

-- AddForeignKey
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_occurrences" ADD CONSTRAINT "obligation_occurrences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_line_decisions" ADD CONSTRAINT "obligation_line_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_line_decisions" ADD CONSTRAINT "obligation_line_decisions_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "obligation_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_approval_requests" ADD CONSTRAINT "obligation_approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_approval_requests" ADD CONSTRAINT "obligation_approval_requests_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "obligation_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_approval_requests" ADD CONSTRAINT "obligation_approval_requests_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "obligation_line_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_schedule_events" ADD CONSTRAINT "obligation_schedule_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_simulated_payments" ADD CONSTRAINT "obligation_simulated_payments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_simulated_payments" ADD CONSTRAINT "obligation_simulated_payments_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "obligation_occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_confirmations" ADD CONSTRAINT "obligation_confirmations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_clock" ADD CONSTRAINT "demo_clock_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Garantías que Prisma no expresa
-- ---------------------------------------------------------------------------

-- Una plantilla en borrador no tiene activación; una activa o pausada sí (quién y cuándo).
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_activation_check"
  CHECK (
    ("status" = 'draft' AND "activated_by" IS NULL AND "activated_at" IS NULL)
    OR ("status" <> 'draft' AND "activated_by" IS NOT NULL AND "activated_at" IS NOT NULL)
  );
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_version_check" CHECK ("version" > 0);

ALTER TABLE "obligation_occurrences" ADD CONSTRAINT "obligation_occurrences_period_check" CHECK ("period_end" >= "period_start");

-- Decisiones: importe positivo, moneda ISO 4217, una aprobación siempre trae importe y moneda,
-- y el actor humano existe si y solo si la decisión es humana.
ALTER TABLE "obligation_line_decisions" ADD CONSTRAINT "obligation_line_decisions_amount_check"
  CHECK ("amount_minor" IS NULL OR "amount_minor" > 0);
ALTER TABLE "obligation_line_decisions" ADD CONSTRAINT "obligation_line_decisions_currency_check"
  CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "obligation_line_decisions" ADD CONSTRAINT "obligation_line_decisions_approved_check"
  CHECK ("decision" <> 'approved' OR ("amount_minor" IS NOT NULL AND "currency" IS NOT NULL));
ALTER TABLE "obligation_line_decisions" ADD CONSTRAINT "obligation_line_decisions_actor_check"
  CHECK (
    ("decision_source" = 'automatic' AND "actor_id" IS NULL)
    OR ("decision_source" = 'human' AND "actor_id" IS NOT NULL)
  );

-- Idempotencia: la misma evidencia produce una sola decisión automática por línea.
CREATE UNIQUE INDEX "obligation_line_decisions_automatic_key"
  ON "obligation_line_decisions"("organization_id", "decision_key") WHERE "decision_source" = 'automatic';

-- Una solicitud pendiente por línea y ocurrencia.
CREATE UNIQUE INDEX "obligation_approval_requests_pending_key"
  ON "obligation_approval_requests"("occurrence_id", "line_id") WHERE "status" = 'pending';

-- Fases válidas del calendario.
ALTER TABLE "obligation_schedule_events" ADD CONSTRAINT "obligation_schedule_events_phase_check"
  CHECK ("phase" IN ('prepare', 'alert_early', 'alert_urgent', 'execute'));

-- Pago simulado e importe confirmado: importes positivos y moneda válida.
ALTER TABLE "obligation_simulated_payments" ADD CONSTRAINT "obligation_simulated_payments_amount_check"
  CHECK ("amount_minor" > 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "obligation_confirmations" ADD CONSTRAINT "obligation_confirmations_amount_check" CHECK ("amount_minor" > 0);

-- Solo inserción: las decisiones y los pagos simulados no se editan ni se borran
-- (usa la función `reject_append_only_change` de 20261017163245).
CREATE TRIGGER "obligation_line_decisions_append_only"
  BEFORE UPDATE OR DELETE ON "obligation_line_decisions"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();

CREATE TRIGGER "obligation_simulated_payments_append_only"
  BEFORE UPDATE OR DELETE ON "obligation_simulated_payments"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
