import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveWhatsAppHandshake, verifyWhatsAppSignature } from "./verify";

const SECRET = "app_secret_demo";
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

describe("verifyWhatsAppSignature", () => {
  it("acepta la firma correcta del cuerpo crudo", () => {
    expect(verifyWhatsAppSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rechaza cuerpo alterado, secreto distinto y cabeceras ausentes o malformadas", () => {
    expect(verifyWhatsAppSignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, sign(body, "otro"), SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, null, SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, "sha256=abc", SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, sign(body).replace("sha256=", "sha1="), SECRET)).toBe(false);
    expect(verifyWhatsAppSignature(body, sign(body), "")).toBe(false);
  });
});

describe("resolveWhatsAppHandshake", () => {
  const params = (token: string, mode = "subscribe") => new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "1158201444" });

  it("devuelve el challenge solo con el token correcto", () => {
    expect(resolveWhatsAppHandshake(params("tok"), "tok")).toBe("1158201444");
    expect(resolveWhatsAppHandshake(params("malo"), "tok")).toBeNull();
    expect(resolveWhatsAppHandshake(params("tok", "otro"), "tok")).toBeNull();
    expect(resolveWhatsAppHandshake(new URLSearchParams(), "tok")).toBeNull();
    expect(resolveWhatsAppHandshake(params(""), "")).toBeNull();
  });
});
