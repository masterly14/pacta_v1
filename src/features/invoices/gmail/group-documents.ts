export type GroupableDocument = {
  id: string;
  source: "email_body" | "invoice_document";
};

export type PlannedGroup = {
  kind: "invoice_candidate" | "message_context";
  members: Array<{ documentId: string; role: "primary" | "supporting" }>;
};

/**
 * Agrupa los documentos de un correo sin inferir lo que no consta:
 * - cada adjunto de factura es su propia posible factura (no se fusionan adjuntos);
 * - el cuerpo apoya a la única factura si hay una sola; con varias no se puede
 *   atribuir, así que queda en un grupo de contexto aparte;
 * - sin adjuntos, el cuerpo es el candidato (la factura puede venir en el texto).
 */
export function planDocumentGroups(documents: GroupableDocument[]): PlannedGroup[] {
  const body = documents.find((doc) => doc.source === "email_body") ?? null;
  const attachments = documents.filter((doc) => doc.source === "invoice_document");

  if (attachments.length === 0) {
    return body ? [{ kind: "invoice_candidate", members: [{ documentId: body.id, role: "primary" }] }] : [];
  }

  const groups: PlannedGroup[] = attachments.map((doc) => ({
    kind: "invoice_candidate",
    members: [{ documentId: doc.id, role: "primary" }],
  }));

  if (body) {
    const supporting = { documentId: body.id, role: "supporting" } as const;
    if (groups.length === 1) {
      groups[0].members.push(supporting);
    } else {
      groups.push({ kind: "message_context", members: [supporting] });
    }
  }
  return groups;
}
