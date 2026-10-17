import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { membershipRoleFromClerk } from "./membership-role.ts";

describe("membershipRoleFromClerk", () => {
  it("mapea org:admin a admin", () => {
    assert.equal(membershipRoleFromClerk("org:admin"), "admin");
    assert.equal(membershipRoleFromClerk("admin"), "admin");
  });

  it("cualquier otro valor (incluido ausente) es member, nunca un rol inventado con más privilegios", () => {
    assert.equal(membershipRoleFromClerk("org:member"), "member");
    assert.equal(membershipRoleFromClerk("member"), "member");
    assert.equal(membershipRoleFromClerk(undefined), "member");
    assert.equal(membershipRoleFromClerk(null), "member");
    assert.equal(membershipRoleFromClerk("org:billing"), "member");
  });
});
