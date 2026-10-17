import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Document, GmailConnection, GmailInboundMessage, IgnoredInboundItem } from "@prisma/client";
import { completeGmailOauth } from "./complete-oauth.ts";
import { connectMailbox } from "./connect-mailbox.ts";
import { downloadGmailMessage } from "./download-gmail-message.ts";
import { getOrganizationDocument } from "./get-document.ts";
import { ingestComposioWebhook, ingestSignedWebhook } from "./ingest-webhook.ts";
import type { CreateDocumentInput, CreateInboundInput, CreatePendingMailboxInput, MailboxRepo } from "./mailbox-repo.ts";
import type { BlobStorePort, FetchedGmailMessage, GmailComposioPort } from "./ports.ts";

const orgId = "org_demo";
const otherOrg = "org_other";
const userId = "user_demo";
const now = new Date("2026-10-17T16:00:00.000Z");

function memoryRepo(): MailboxRepo & {
  connections: Map<string, GmailConnection>;
  inbounds: Map<string, GmailInboundMessage>;
  documents: Map<string, Document>;
  groups: Map<string, { id: string; kind: string; inboundId: string }>;
  ignoredItems: IgnoredInboundItem[];
} {
  const connections = new Map<string, GmailConnection>();
  const inbounds = new Map<string, GmailInboundMessage>();
  const documents = new Map<string, Document>();
  const groups = new Map<string, { id: string; kind: string; inboundId: string }>();
  let ignoredItems: IgnoredInboundItem[] = [];

  const stamp = (input: CreatePendingMailboxInput): GmailConnection => ({
    ...input,
    composioTriggerId: null,
    emailAddress: null,
    status: "pending",
    connectedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    connections,
    inbounds,
    documents,
    groups,
    get ignoredItems() {
      return ignoredItems;
    },
    async createPending(input) {
      const row = stamp(input);
      connections.set(row.id, row);
      return row;
    },
    async getById(id) {
      return connections.get(id) ?? null;
    },
    async getByConnectedAccountId(connectedAccountId) {
      return [...connections.values()].find((row) => row.composioConnectedAccountId === connectedAccountId) ?? null;
    },
    async listByOrganization(organizationId) {
      return [...connections.values()].filter((row) => row.organizationId === organizationId);
    },
    async markActive(input) {
      const current = connections.get(input.id);
      if (!current) {
        throw new Error("missing");
      }
      const next: GmailConnection = {
        ...current,
        emailAddress: input.emailAddress,
        composioTriggerId: input.composioTriggerId,
        status: "active",
        connectedAt: input.connectedAt,
        revokedAt: null,
      };
      connections.set(input.id, next);
      return next;
    },
    async markFailed(id) {
      const current = connections.get(id);
      if (!current) {
        throw new Error("missing");
      }
      const next = { ...current, status: "failed" as const };
      connections.set(id, next);
      return next;
    },
    async markExpired(connectedAccountId) {
      const current = [...connections.values()].find((row) => row.composioConnectedAccountId === connectedAccountId);
      if (!current || current.status === "revoked") {
        return current ?? null;
      }
      const next = { ...current, status: "expired" as const };
      connections.set(current.id, next);
      return next;
    },
    async markRevoked(id, revokedAt) {
      const current = connections.get(id);
      if (!current) {
        throw new Error("missing");
      }
      const next: GmailConnection = {
        ...current,
        status: "revoked",
        revokedAt,
        emailAddress: null,
        composioTriggerId: null,
      };
      connections.set(id, next);
      return next;
    },
    async createInbound(input: CreateInboundInput) {
      const duplicate = [...inbounds.values()].find(
        (row) =>
          row.composioEventId === input.composioEventId
          || (row.gmailConnectionId === input.gmailConnectionId && row.gmailMessageId === input.gmailMessageId),
      );
      if (duplicate) {
        return { created: false, row: duplicate };
      }
      const row: GmailInboundMessage = {
        ...input,
        processingStatus: "received",
        invoiceId: null,
        createdAt: now,
        updatedAt: now,
      };
      inbounds.set(row.id, row);
      return { created: true, row };
    },
    async getInboundById(id) {
      return inbounds.get(id) ?? null;
    },
    async setInboundStatus(id, status) {
      const current = inbounds.get(id);
      if (current) {
        inbounds.set(id, { ...current, processingStatus: status });
      }
    },
    async createDocument(input: CreateDocumentInput) {
      const row: Document = { ...input, groupId: null, groupRole: null, createdAt: now };
      documents.set(row.id, row);
      return row;
    },
    async getDocument(id) {
      return documents.get(id) ?? null;
    },
    async listDocumentsByInbound(inboundId) {
      return [...documents.values()].filter((doc) => doc.gmailInboundMessageId === inboundId);
    },
    async replaceIgnoredItems({ organizationId, inboundId, items }) {
      ignoredItems = [
        ...ignoredItems.filter((row) => row.gmailInboundMessageId !== inboundId),
        ...items.map((item, index) => ({
          ...item,
          id: `ign_${inboundId}_${index}`,
          organizationId,
          gmailInboundMessageId: inboundId,
          createdAt: now,
        })),
      ];
    },
    async listIgnoredItems({ organizationId, inboundId }) {
      return ignoredItems.filter((row) => row.organizationId === organizationId && row.gmailInboundMessageId === inboundId);
    },
    async replaceDocumentGroups({ inboundId, groups: planned }) {
      for (const [id, group] of groups) {
        if (group.inboundId === inboundId) {
          groups.delete(id);
        }
      }
      for (const doc of documents.values()) {
        if (doc.gmailInboundMessageId === inboundId) {
          documents.set(doc.id, { ...doc, groupId: null, groupRole: null });
        }
      }
      for (const group of planned) {
        groups.set(group.id, { id: group.id, kind: group.kind, inboundId });
        for (const member of group.members) {
          const doc = documents.get(member.documentId);
          if (doc) {
            documents.set(doc.id, { ...doc, groupId: group.id, groupRole: member.role });
          }
        }
      }
    },
  };
}

function fakeComposio(overrides: Partial<GmailComposioPort> = {}): GmailComposioPort {
  const message: FetchedGmailMessage = {
    messageId: "18f1gmail",
    threadId: "thread-1",
    sender: "proveedor@example.com",
    subject: "Factura",
    text: "Adjunto PDF",
    attachments: [
      { attachmentId: "att-pdf", filename: "invoice.pdf", mimeType: "application/pdf", bytes: null },
      { attachmentId: "att-exe", filename: "virus.exe", mimeType: "application/x-msdownload", bytes: null },
    ],
  };
  return {
    async linkAccount() {
      return { connectedAccountId: "ca_work", redirectUrl: "https://connect.composio.dev/link/abc" };
    },
    async waitForAccount(id) {
      return { id, status: "ACTIVE" };
    },
    async getAccount(id) {
      return { id, status: "ACTIVE" };
    },
    async getGmailProfile() {
      return { email: "facturas@demo.com" };
    },
    async createInboxTrigger() {
      return { triggerId: "ti_inbox" };
    },
    async deleteTrigger() {},
    async deleteAccount() {},
    async parseWebhook() {
      return { type: "composio.trigger.message", rawPayload: {} };
    },
    async fetchMessage() {
      return message;
    },
    async fetchAttachment(input) {
      if (input.attachmentId === "att-pdf") {
        return {
          attachmentId: input.attachmentId,
          filename: "invoice.pdf",
          mimeType: "application/pdf",
          bytes: new TextEncoder().encode("%PDF-1.4"),
        };
      }
      return {
        attachmentId: input.attachmentId,
        filename: "virus.exe",
        mimeType: "application/x-msdownload",
        bytes: new TextEncoder().encode("MZ"),
      };
    },
    ...overrides,
  };
}

function memoryBlob(): BlobStorePort & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async put(input) {
      files.set(input.pathname, input.body);
      return {
        fileRef: `pacta/invoices/${input.pathname}`,
        publicUrl: `https://pub-93e729bb52a7484eb99df64ce8ba41bf.r2.dev/pacta/invoices/${input.pathname}`,
      };
    },
    async get(fileRef) {
      const body = files.get(fileRef) ?? [...files.entries()].find(([key]) => fileRef.endsWith(key))?.[1];
      if (!body) {
        throw new Error("missing blob");
      }
      return { body, contentType: "application/octet-stream" };
    },
  };
}

function triggerEnvelope() {
  return {
    id: "msg_2f1c9e4a-3b6d-4a1e-9c2f-7d8e5a6b4c31",
    timestamp: "2026-10-17T16:05:00Z",
    type: "composio.trigger.message",
    metadata: {
      log_id: "log_abc",
      trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
      trigger_id: "ti_inbox",
      connected_account_id: "ca_work",
      auth_config_id: "ac_gmail",
      user_id: orgId,
    },
    data: {
      message_id: "18f1gmail",
      thread_id: "18f1thread",
      sender: "proveedor@example.com",
      subject: "Factura 42",
    },
  };
}

describe("connectMailbox", () => {
  it("usa organizationId del comando de sesión, no un org del cliente", async () => {
    const repo = memoryRepo();
    const composio = fakeComposio({
      async linkAccount(input) {
        assert.equal(input.userId, orgId);
        return { connectedAccountId: "ca_work", redirectUrl: "https://connect.composio.dev/link/abc" };
      },
    });
    const link = await connectMailbox(
      { organizationId: orgId, userId, alias: "finanzas" },
      { composio, repo, authConfigId: "ac_gmail", appUrl: "https://app.pacta.test" },
    );
    assert.equal(link.status, "pending");
    assert.equal(link.redirectUrl.startsWith("https://"), true);
    const stored = [...repo.connections.values()][0];
    assert.equal(stored?.organizationId, orgId);
    assert.equal(stored?.composioUserId, orgId);
  });
});

describe("completeGmailOauth", () => {
  it("rechaza cuenta FAILED y no deja el buzón active sin email", async () => {
    const repo = memoryRepo();
    await repo.createPending({
      id: "gc_1",
      organizationId: orgId,
      connectedByUserId: userId,
      composioUserId: orgId,
      composioConnectedAccountId: "ca_work",
      composioAuthConfigId: "ac_gmail",
      alias: null,
    });
    const result = await completeGmailOauth(
      { connectionId: "gc_1", organizationId: orgId },
      {
        repo,
        composio: fakeComposio({
          async waitForAccount(id) {
            return { id, status: "FAILED" };
          },
          async getGmailProfile() {
            throw new Error("no se debe leer el perfil");
          },
        }),
      },
    );
    assert.equal(result.status, "failed");
    assert.equal(repo.connections.get("gc_1")?.status, "failed");
    assert.equal(repo.connections.get("gc_1")?.emailAddress, null);
  });
});

describe("ingestComposioWebhook", () => {
  it("responde 401 si la firma del webhook falla", async () => {
    const accepted = await ingestSignedWebhook(async () => {
      throw new Error("invalid signature");
    });
    assert.equal(accepted.httpStatus, 401);
  });

  it("ignora un connected_account_id desconocido", async () => {
    const repo = memoryRepo();
    const result = await ingestComposioWebhook(triggerEnvelope(), { repo });
    assert.equal(result.outcome, "ignored");
  });

  it("no duplica un mismo evento", async () => {
    const repo = memoryRepo();
    await repo.createPending({
      id: "gc_1",
      organizationId: orgId,
      connectedByUserId: userId,
      composioUserId: orgId,
      composioConnectedAccountId: "ca_work",
      composioAuthConfigId: "ac_gmail",
      alias: null,
    });
    await repo.markActive({
      id: "gc_1",
      emailAddress: "facturas@demo.com",
      composioTriggerId: "ti_inbox",
      connectedAt: now,
    });
    const first = await ingestComposioWebhook(triggerEnvelope(), { repo });
    const second = await ingestComposioWebhook(triggerEnvelope(), { repo });
    assert.equal(first.outcome, "received");
    assert.equal(second.outcome, "duplicate");
    assert.equal(repo.inbounds.size, 1);
  });
});

describe("downloadGmailMessage", () => {
  it("guarda un PDF y descarta un adjunto no permitido", async () => {
    const repo = memoryRepo();
    const blob = memoryBlob();
    await repo.createPending({
      id: "gc_1",
      organizationId: orgId,
      connectedByUserId: userId,
      composioUserId: orgId,
      composioConnectedAccountId: "ca_work",
      composioAuthConfigId: "ac_gmail",
      alias: null,
    });
    await repo.markActive({
      id: "gc_1",
      emailAddress: "facturas@demo.com",
      composioTriggerId: "ti_inbox",
      connectedAt: now,
    });
    await repo.createInbound({
      id: "inb_1",
      organizationId: orgId,
      gmailConnectionId: "gc_1",
      composioEventId: "msg_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
      gmailMessageId: "18f1gmail",
      gmailThreadId: null,
      sender: "a@example.com",
      subject: "x",
      receivedAt: now,
    });
    const result = await downloadGmailMessage("inb_1", { repo, blob, composio: fakeComposio() });
    assert.equal(result.status, "received");
    const docs = [...repo.documents.values()];
    assert.equal(docs.some((doc) => doc.mimeType === "application/pdf" && doc.sha256.length === 64), true);
    assert.equal(docs.some((doc) => doc.publicUrl.includes("pacta/invoices/") && doc.publicUrl.startsWith("https://")), true);
    assert.equal(docs.some((doc) => doc.originalFilename === "virus.exe"), false);
    assert.equal(repo.inbounds.get("inb_1")?.processingStatus, "received");
    assert.deepEqual(
      repo.ignoredItems.map((item) => [item.gmailAttachmentId, item.reason]),
      [["att-exe", "unsupported_mime_type"]],
    );
  });

  async function seededRepo() {
    const repo = memoryRepo();
    await repo.createPending({
      id: "gc_1",
      organizationId: orgId,
      connectedByUserId: userId,
      composioUserId: orgId,
      composioConnectedAccountId: "ca_work",
      composioAuthConfigId: "ac_gmail",
      alias: null,
    });
    await repo.markActive({ id: "gc_1", emailAddress: "facturas@demo.com", composioTriggerId: "ti_inbox", connectedAt: now });
    await repo.createInbound({
      id: "inb_1",
      organizationId: orgId,
      gmailConnectionId: "gc_1",
      composioEventId: "msg_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
      gmailMessageId: "18f1gmail",
      gmailThreadId: null,
      sender: "a@example.com",
      subject: "x",
      receivedAt: now,
    });
    return repo;
  }

  type FakeAttachment = { id: string; mimeType: string; bytes: Uint8Array | null; fail?: boolean };

  function composioWith(text: string | null, attachments: FakeAttachment[]): GmailComposioPort {
    const failing = new Set(attachments.filter((item) => item.fail).map((item) => item.id));
    return fakeComposio({
      async fetchMessage() {
        return {
          messageId: "18f1gmail",
          threadId: null,
          sender: null,
          subject: null,
          text,
          attachments: attachments.map((item) => ({
            attachmentId: item.id,
            filename: `${item.id}.bin`,
            mimeType: item.mimeType,
            bytes: null,
          })),
        };
      },
      async fetchAttachment(input) {
        if (failing.has(input.attachmentId)) {
          failing.delete(input.attachmentId);
          throw new Error("transient");
        }
        const item = attachments.find((candidate) => candidate.id === input.attachmentId);
        return { attachmentId: input.attachmentId, filename: `${input.attachmentId}.bin`, mimeType: item?.mimeType ?? null, bytes: item?.bytes ?? null };
      },
    });
  }

  const bytes = (text: string) => new TextEncoder().encode(text);

  it("un correo con una factura y cuerpo agrupa el cuerpo como apoyo", async () => {
    const repo = await seededRepo();
    const composio = composioWith("Factura adjunta", [{ id: "a1", mimeType: "application/pdf", bytes: bytes("pdf-1") }]);
    await downloadGmailMessage("inb_1", { repo, blob: memoryBlob(), composio });
    const docs = [...repo.documents.values()];
    assert.equal(repo.groups.size, 1);
    assert.equal(new Set(docs.map((doc) => doc.groupId)).size, 1);
    assert.deepEqual(
      docs.map((doc) => [doc.source, doc.groupRole]).sort(),
      [["email_body", "supporting"], ["invoice_document", "primary"]],
    );
  });

  it("con varias facturas cada adjunto es un grupo y el cuerpo queda como contexto aparte", async () => {
    const repo = await seededRepo();
    const composio = composioWith("Dos facturas", [
      { id: "a1", mimeType: "application/pdf", bytes: bytes("pdf-1") },
      { id: "a2", mimeType: "image/png", bytes: bytes("png-2") },
    ]);
    await downloadGmailMessage("inb_1", { repo, blob: memoryBlob(), composio });
    const groups = [...repo.groups.values()];
    assert.equal(groups.filter((group) => group.kind === "invoice_candidate").length, 2);
    assert.equal(groups.filter((group) => group.kind === "message_context").length, 1);
    const attachments = [...repo.documents.values()].filter((doc) => doc.source === "invoice_document");
    assert.equal(new Set(attachments.map((doc) => doc.groupId)).size, 2);
    const body = [...repo.documents.values()].find((doc) => doc.source === "email_body");
    assert.equal(groups.find((group) => group.id === body?.groupId)?.kind, "message_context");
    assert.equal(body?.groupRole, "supporting");
  });

  it("sin adjuntos el cuerpo es el candidato", async () => {
    const repo = await seededRepo();
    await downloadGmailMessage("inb_1", { repo, blob: memoryBlob(), composio: composioWith("Factura 42 por 100 USD", []) });
    const [group] = [...repo.groups.values()];
    assert.equal(group?.kind, "invoice_candidate");
    assert.equal([...repo.documents.values()][0]?.groupRole, "primary");
  });

  it("registra por qué se ignoró cada adjunto", async () => {
    const repo = await seededRepo();
    const composio = composioWith("hola", [
      { id: "ok", mimeType: "application/pdf", bytes: bytes("pdf-1") },
      { id: "exe", mimeType: "application/x-msdownload", bytes: bytes("MZ") },
      { id: "vacio", mimeType: "application/pdf", bytes: new Uint8Array(0) },
      { id: "sinbytes", mimeType: "image/png", bytes: null },
      { id: "grande", mimeType: "application/pdf", bytes: new Uint8Array(10 * 1024 * 1024 + 1) },
      { id: "copia", mimeType: "application/pdf", bytes: bytes("pdf-1") },
    ]);
    const result = await downloadGmailMessage("inb_1", { repo, blob: memoryBlob(), composio });
    assert.equal(result.status, "received");
    assert.deepEqual(
      repo.ignoredItems.map((item) => [item.gmailAttachmentId, item.reason]),
      [
        ["exe", "unsupported_mime_type"],
        ["vacio", "empty_file"],
        ["sinbytes", "missing_content"],
        ["grande", "file_too_large"],
        ["copia", "duplicate_content"],
      ],
    );
  });

  it("un correo sin contenido útil queda ignorado con motivo", async () => {
    const repo = await seededRepo();
    const result = await downloadGmailMessage("inb_1", { repo, blob: memoryBlob(), composio: composioWith("  ", []) });
    assert.equal(result.status, "ignored");
    assert.deepEqual(repo.ignoredItems.map((item) => [item.kind, item.reason]), [["message", "no_usable_content"]]);
    assert.equal(repo.groups.size, 0);
  });

  it("un adjunto que falla deja el correo en failed y el reintento no duplica documentos", async () => {
    const repo = await seededRepo();
    const blob = memoryBlob();
    const composio = composioWith("Facturas", [
      { id: "a1", mimeType: "application/pdf", bytes: bytes("pdf-1") },
      { id: "a2", mimeType: "application/pdf", bytes: bytes("pdf-2"), fail: true },
    ]);
    const first = await downloadGmailMessage("inb_1", { repo, blob, composio });
    assert.equal(first.status, "failed");
    assert.deepEqual(repo.ignoredItems.map((item) => [item.gmailAttachmentId, item.reason]), [["a2", "fetch_failed"]]);
    assert.equal(repo.documents.size, 2);

    const retry = await downloadGmailMessage("inb_1", { repo, blob, composio });
    assert.equal(retry.status, "received");
    assert.equal(repo.documents.size, 3);
    assert.equal(repo.ignoredItems.length, 0);
    assert.equal(repo.groups.size, 3);
    assert.equal([...repo.documents.values()].every((doc) => doc.groupId !== null), true);
  });
});

describe("getOrganizationDocument", () => {
  it("no entrega un documento de otra organización", async () => {
    const repo = memoryRepo();
    await repo.createDocument({
      id: "doc_1",
      organizationId: otherOrg,
      gmailInboundMessageId: "inb_x",
      fileRef: "pacta/invoices/org/other/file.pdf",
      publicUrl: "https://pub-93e729bb52a7484eb99df64ce8ba41bf.r2.dev/pacta/invoices/org/other/file.pdf",
      mimeType: "application/pdf",
      sha256: "a".repeat(64),
      originalFilename: "x.pdf",
      source: "invoice_document",
      byteSize: 8,
      receivedAt: now,
    });
    await assert.rejects(
      () => getOrganizationDocument({ documentId: "doc_1", organizationId: orgId }, { repo }),
      { name: "DocumentNotFoundError" },
    );
  });
});
