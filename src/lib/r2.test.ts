import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PACTA_R2_PREFIX, r2ObjectKey, r2PublicUrl } from "./r2.ts";

describe("r2ObjectKey", () => {
  it("agrupa las capturas de Pacta bajo el prefijo de Monark", () => {
    assert.equal(
      r2ObjectKey("org/org_demo/gmail/inb_1/doc_1.pdf", PACTA_R2_PREFIX),
      "pacta/invoices/org/org_demo/gmail/inb_1/doc_1.pdf",
    );
    assert.equal(
      r2ObjectKey("pacta/invoices/org/org_demo/gmail/inb_1/doc_1.pdf", PACTA_R2_PREFIX),
      "pacta/invoices/org/org_demo/gmail/inb_1/doc_1.pdf",
    );
  });
});

describe("r2PublicUrl", () => {
  it("arma la URL pública r2.dev", () => {
    const url = r2PublicUrl(
      "https://pub-93e729bb52a7484eb99df64ce8ba41bf.r2.dev",
      "pacta/invoices/org/org_demo/gmail/inb_1/doc 1.pdf",
    );
    assert.equal(
      url,
      "https://pub-93e729bb52a7484eb99df64ce8ba41bf.r2.dev/pacta/invoices/org/org_demo/gmail/inb_1/doc%201.pdf",
    );
  });
});
