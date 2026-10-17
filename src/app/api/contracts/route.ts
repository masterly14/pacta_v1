/**
 * Purpose: POST /api/contracts — register a contract from JSON (same rules as the form).
 * Runs in: server (Next.js route handler, Node).
 * Triggered by: an authenticated HTTP request (Clerk session; proxy.ts protects /api).
 * Receives → Returns: JSON ContractInput body → 201 { contractId } | 400 | 401 | 403 | 409 overlapping contract | 500.
 * Talks to: ensureWorkspaceFromSession, features/contracts (schemas, server).
 */
import { NextResponse } from "next/server";
import { ContractInputSchema } from "@/features/contracts/schemas";
import { contractActorFromWorkspace, createContract } from "@/features/contracts/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON" }, { status: 400 });
  }

  const parsed = ContractInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const actor = contractActorFromWorkspace(await ensureWorkspaceFromSession());
    const result = await createContract(actor, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.reason === "forbidden" ? 403 : result.reason === "conflict" ? 409 : 400 });
    }
    return NextResponse.json({ contractId: result.contractId }, { status: 201 });
  } catch (error) {
    if (error instanceof OrganizationRequiredError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("[contracts/api] falló el registro", error);
    return NextResponse.json({ error: "No se pudo registrar el contrato" }, { status: 500 });
  }
}
