-- The shared database was created when these enums used Spanish labels.
-- Prisma and the app expect the English labels from the original migration.
-- A database that already has the English labels is left unchanged.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PaymentDecisionOutcome' AND e.enumlabel = 'aprobada'
  ) THEN
    ALTER TABLE "payment_decisions" DROP CONSTRAINT "payment_decisions_actor_check";
    ALTER TABLE "payment_decisions" DROP CONSTRAINT "payment_decisions_approved_check";
    ALTER TABLE "payment_decisions" DROP CONSTRAINT "payment_decisions_authorization_check";
    DROP INDEX "payment_decisions_one_approved_per_invoice";
    DROP INDEX "approval_requests_one_pending_per_invoice";

    ALTER TYPE "PaymentDecisionOutcome" RENAME VALUE 'aprobada' TO 'approved';
    ALTER TYPE "PaymentDecisionOutcome" RENAME VALUE 'bloqueada' TO 'blocked';
    ALTER TYPE "PaymentDecisionOutcome" RENAME VALUE 'requiere_aprobacion' TO 'requires_approval';

    ALTER TYPE "PaymentDecisionSource" RENAME VALUE 'automatica' TO 'automatic';
    ALTER TYPE "PaymentDecisionSource" RENAME VALUE 'humana' TO 'human';

    ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'pendiente' TO 'pending';
    ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'aprobada' TO 'approved';
    ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'rechazada' TO 'rejected';
    ALTER TYPE "ApprovalRequestStatus" RENAME VALUE 'cancelada' TO 'cancelled';

    ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_actor_check"
      CHECK (
        ("decision_source" = 'automatic' AND "actor_id" IS NULL)
        OR ("decision_source" = 'human' AND "actor_id" IS NOT NULL AND "approval_request_id" IS NOT NULL)
      );

    ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_approved_check"
      CHECK ("decision" <> 'approved' OR ("policy_version" IS NOT NULL AND "amount_minor" IS NOT NULL AND "currency" IS NOT NULL));

    ALTER TABLE "payment_decisions" ADD CONSTRAINT "payment_decisions_authorization_check"
      CHECK ("authorization_id" IS NULL OR "decision" = 'approved');

    CREATE UNIQUE INDEX "payment_decisions_one_approved_per_invoice"
      ON "payment_decisions"("organization_id", "invoice_id") WHERE "decision" = 'approved';

    CREATE UNIQUE INDEX "approval_requests_one_pending_per_invoice"
      ON "approval_requests"("organization_id", "invoice_id") WHERE "status" = 'pending';
  END IF;
END $$;
