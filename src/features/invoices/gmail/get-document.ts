import { createPrismaMailboxRepo, type MailboxRepo } from "./mailbox-repo.ts";

export class DocumentNotFoundError extends Error {
  constructor() {
    super("Documento no encontrado");
    this.name = "DocumentNotFoundError";
  }
}

export async function getOrganizationDocument(
  input: { documentId: string; organizationId: string },
  deps?: { repo?: MailboxRepo },
): Promise<{
  id: string;
  publicUrl: string;
  fileRef: string;
  contentType: string;
  filename: string | null;
}> {
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const document = await repo.getDocument(input.documentId);
  if (!document || document.organizationId !== input.organizationId) {
    throw new DocumentNotFoundError();
  }
  return {
    id: document.id,
    publicUrl: document.publicUrl,
    fileRef: document.fileRef,
    contentType: document.mimeType,
    filename: document.originalFilename,
  };
}
