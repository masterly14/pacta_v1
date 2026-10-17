export type LinkedComposioAccount = {
  connectedAccountId: string;
  redirectUrl: string;
};

export type ComposioAccountSnapshot = {
  id: string;
  status: string;
};

export type FetchedGmailAttachment = {
  attachmentId: string;
  filename: string | null;
  mimeType: string | null;
  bytes: Uint8Array | null;
};

export type FetchedGmailMessage = {
  messageId: string;
  threadId: string | null;
  sender: string | null;
  subject: string | null;
  text: string | null;
  attachments: FetchedGmailAttachment[];
};

export type ParsedWebhook = {
  type: string;
  rawPayload: unknown;
};

export type GmailComposioPort = {
  linkAccount(input: { userId: string; authConfigId: string; callbackUrl: string }): Promise<LinkedComposioAccount>;
  waitForAccount(connectedAccountId: string, timeoutMs: number): Promise<ComposioAccountSnapshot>;
  getAccount(connectedAccountId: string): Promise<ComposioAccountSnapshot | null>;
  getGmailProfile(input: { userId: string; connectedAccountId: string }): Promise<{ email: string | null }>;
  createInboxTrigger(input: { userId: string; connectedAccountId: string }): Promise<{ triggerId: string }>;
  deleteTrigger(triggerId: string): Promise<void>;
  deleteAccount(connectedAccountId: string): Promise<void>;
  parseWebhook(request: Request, secret: string): Promise<ParsedWebhook>;
  fetchMessage(input: {
    userId: string;
    connectedAccountId: string;
    messageId: string;
  }): Promise<FetchedGmailMessage>;
  fetchAttachment(input: {
    userId: string;
    connectedAccountId: string;
    messageId: string;
    attachmentId: string;
    // Composio exige el nombre del archivo para descargar el adjunto.
    filename: string | null;
  }): Promise<FetchedGmailAttachment>;
};

export type StoredBlob = {
  fileRef: string;
  publicUrl: string;
};

export type BlobStorePort = {
  put(input: {
    pathname: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<StoredBlob>;
  get(fileRef: string): Promise<{ body: Uint8Array; contentType: string }>;
};
