-- CreateEnum
CREATE TYPE "ContractFlowStatus" AS ENUM ('draft', 'active', 'superseded');

-- CreateTable
CREATE TABLE "contract_flow_versions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "graph" JSONB NOT NULL,
    "graph_sha256" TEXT NOT NULL,
    "status" "ContractFlowStatus" NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_by" TEXT,
    "activated_at" TIMESTAMPTZ(6),

    CONSTRAINT "contract_flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_flow_versions_contract_id_version_key" ON "contract_flow_versions"("contract_id", "version");

-- CreateIndex
CREATE INDEX "contract_flow_versions_organization_id_contract_id_status_idx" ON "contract_flow_versions"("organization_id", "contract_id", "status");

-- AddForeignKey
ALTER TABLE "contract_flow_versions" ADD CONSTRAINT "contract_flow_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_flow_versions" ADD CONSTRAINT "contract_flow_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garantías que Prisma no expresa (documentadas con @db-guarantee en schema.prisma)
-- ---------------------------------------------------------------------------

-- Una sola versión activa y un solo borrador por contrato
CREATE UNIQUE INDEX "contract_flow_versions_one_active"
  ON "contract_flow_versions"("contract_id") WHERE "status" = 'active';
CREATE UNIQUE INDEX "contract_flow_versions_one_draft"
  ON "contract_flow_versions"("contract_id") WHERE "status" = 'draft';

-- Una versión activada queda congelada: solo puede pasar de active a superseded
CREATE FUNCTION "contract_flow_versions_freeze"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'draft' THEN
      RAISE EXCEPTION 'Una versión de flujo activada no se borra';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'draft' THEN
    IF NEW."graph" IS DISTINCT FROM OLD."graph"
      OR NEW."graph_sha256" IS DISTINCT FROM OLD."graph_sha256"
      OR NEW."version" IS DISTINCT FROM OLD."version"
      OR NEW."schema_version" IS DISTINCT FROM OLD."schema_version"
      OR NEW."contract_id" IS DISTINCT FROM OLD."contract_id"
      OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id" THEN
      RAISE EXCEPTION 'Una versión de flujo activada es inmutable';
    END IF;
    IF NOT (OLD."status" = NEW."status" OR (OLD."status" = 'active' AND NEW."status" = 'superseded')) THEN
      RAISE EXCEPTION 'Transición de estado de flujo no permitida: % -> %', OLD."status", NEW."status";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contract_flow_versions_frozen"
  BEFORE UPDATE OR DELETE ON "contract_flow_versions"
  FOR EACH ROW EXECUTE FUNCTION "contract_flow_versions_freeze"();

-- ---------------------------------------------------------------------------
-- Backfill: cada contrato existente recibe la versión 1, un grafo lineal equivalente a la
-- comparación plana anterior (Inicio → Monto fijo → [Cuenta] → Fin). Los contratos terminados
-- quedan como 'superseded'. El hash se calcula sobre el texto jsonb de Postgres.
-- ---------------------------------------------------------------------------
WITH built AS (
  SELECT
    c."id" AS contract_id,
    c."organization_id",
    c."status",
    c."created_by",
    c."created_at",
    jsonb_build_object(
      'schemaVersion', 1,
      'nodes',
        jsonb_build_array(
          jsonb_build_object('id', 'start', 'type', 'start', 'position', jsonb_build_object('x', 0, 'y', 0),
            'data', jsonb_build_object('frequency', c."frequency"::text, 'validFrom', to_char(c."valid_from", 'YYYY-MM-DD'),
              'validTo', CASE WHEN c."valid_to" IS NULL THEN NULL ELSE to_char(c."valid_to", 'YYYY-MM-DD') END)),
          jsonb_build_object('id', 'amount', 'type', 'amount', 'position', jsonb_build_object('x', 260, 'y', 0),
            'data', jsonb_build_object('mode', 'fixed', 'currency', c."currency", 'amountMinor', c."agreed_amount_minor", 'toleranceBps', 0))
        )
        || CASE WHEN c."beneficiary_account_ref" IS NULL THEN '[]'::jsonb ELSE
          jsonb_build_array(jsonb_build_object('id', 'beneficiary', 'type', 'beneficiary', 'position', jsonb_build_object('x', 520, 'y', 0),
            'data', jsonb_build_object('accountRef', c."beneficiary_account_ref"))) END
        || jsonb_build_array(jsonb_build_object('id', 'end', 'type', 'end',
            'position', jsonb_build_object('x', CASE WHEN c."beneficiary_account_ref" IS NULL THEN 520 ELSE 780 END, 'y', 0),
            'data', jsonb_build_object('outcome', 'expect_payment'))),
      'edges',
        CASE WHEN c."beneficiary_account_ref" IS NULL THEN
          jsonb_build_array(
            jsonb_build_object('id', 'e1', 'source', 'start', 'target', 'amount', 'sourceHandle', 'default'),
            jsonb_build_object('id', 'e2', 'source', 'amount', 'target', 'end', 'sourceHandle', 'default'))
        ELSE
          jsonb_build_array(
            jsonb_build_object('id', 'e1', 'source', 'start', 'target', 'amount', 'sourceHandle', 'default'),
            jsonb_build_object('id', 'e2', 'source', 'amount', 'target', 'beneficiary', 'sourceHandle', 'default'),
            jsonb_build_object('id', 'e3', 'source', 'beneficiary', 'target', 'end', 'sourceHandle', 'default'))
        END
    ) AS graph
  FROM "contracts" c
)
INSERT INTO "contract_flow_versions"
  ("id", "organization_id", "contract_id", "version", "schema_version", "graph", "graph_sha256",
   "status", "created_by", "created_at", "activated_by", "activated_at")
SELECT
  'cfv_' || replace(gen_random_uuid()::text, '-', ''),
  b.organization_id, b.contract_id, 1, 1, b.graph,
  encode(sha256(convert_to(b.graph::text, 'UTF8')), 'hex'),
  CASE WHEN b."status" = 'active' THEN 'active'::"ContractFlowStatus" ELSE 'superseded'::"ContractFlowStatus" END,
  b.created_by, b.created_at, b.created_by, b.created_at
FROM built b;
