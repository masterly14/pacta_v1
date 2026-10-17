import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { OrganizationRequiredError } from "../../../shared/auth/ensure-workspace.ts";
import { MailboxNotFoundError, MailboxOrgMismatchError } from "./complete-oauth.ts";
import { DocumentNotFoundError } from "./get-document.ts";

export function gmailHttpError(error: unknown): NextResponse {
  if (error instanceof OrganizationRequiredError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof MailboxOrgMismatchError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof MailboxNotFoundError || error instanceof DocumentNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Error interno";
  if (message.includes("no está definida")) {
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}
