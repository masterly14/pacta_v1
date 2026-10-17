import { S3Client } from "@aws-sdk/client-s3";

/** Bucket R2 de Monark (`monark-media`) en la cuenta Cloudflare del equipo. */
export const MONARK_R2_ACCOUNT_ID = "336fc3046e47821b89a1647a3387a537";
export const MONARK_R2_BUCKET = "monark-media";
export const MONARK_R2_PUBLIC_BASE_URL = "https://pub-93e729bb52a7484eb99df64ce8ba41bf.r2.dev";
export const PACTA_R2_PREFIX = "pacta/invoices";

export type R2Config = {
  accountId: string;
  bucket: string;
  endpoint: string;
  publicBaseUrl: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() || MONARK_R2_ACCOUNT_ID;
  const bucket = process.env.R2_BUCKET?.trim() || MONARK_R2_BUCKET;
  const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL?.trim() || MONARK_R2_PUBLIC_BASE_URL).replace(/\/$/, "");
  const prefix = (process.env.R2_PREFIX?.trim() || PACTA_R2_PREFIX).replace(/^\/+|\/+$/g, "");
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCESS_KEY_ID y R2_SECRET_ACCESS_KEY no están definidas");
  }
  return {
    accountId,
    bucket,
    endpoint: process.env.R2_ENDPOINT?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
    publicBaseUrl,
    prefix,
    accessKeyId,
    secretAccessKey,
  };
}

export function r2ObjectKey(pathname: string, prefix: string): string {
  const relative = pathname.replace(/^\/+/, "");
  if (relative.startsWith(`${prefix}/`)) {
    return relative;
  }
  return `${prefix}/${relative}`;
}

export function r2PublicUrl(publicBaseUrl: string, key: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

let client: S3Client | undefined;
let clientEndpoint: string | undefined;

export function getR2Client(config: R2Config = getR2Config()): S3Client {
  if (!client || clientEndpoint !== config.endpoint) {
    client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    clientEndpoint = config.endpoint;
  }
  return client;
}
