import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, getR2Config, r2ObjectKey, r2PublicUrl, type R2Config } from "../../../lib/r2.ts";
import type { BlobStorePort } from "./ports.ts";

export function createR2Store(config?: R2Config): BlobStorePort {
  return {
    async put(input) {
      const resolved = config ?? getR2Config();
      const key = r2ObjectKey(input.pathname, resolved.prefix);
      await getR2Client(resolved).send(
        new PutObjectCommand({
          Bucket: resolved.bucket,
          Key: key,
          Body: Buffer.from(input.body),
          ContentType: input.contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return {
        fileRef: key,
        publicUrl: r2PublicUrl(resolved.publicBaseUrl, key),
      };
    },

    async get(fileRef) {
      const resolved = config ?? getR2Config();
      const key = r2ObjectKey(fileRef, resolved.prefix);
      const result = await getR2Client(resolved).send(
        new GetObjectCommand({
          Bucket: resolved.bucket,
          Key: key,
        }),
      );
      const bytes = result.Body ? new Uint8Array(await result.Body.transformToByteArray()) : new Uint8Array();
      return {
        body: bytes,
        contentType: result.ContentType ?? "application/octet-stream",
      };
    },
  };
}
