import { describe, it, expect } from "vitest";
import {
  resolveCooperativeScope,
  canAccessCooperativeResource,
  type CooperativeActor,
} from "../src/lib/cooperative-model";

const coopA = "coop-a";
const coopB = "coop-b";

const platformAdmin: CooperativeActor = {
  id: "user-platform",
  role: "platform_admin",
  cooperativeId: null,
};

const coopAdminA: CooperativeActor = {
  id: "user-admin-a",
  role: "cooperative_admin",
  cooperativeId: coopA,
};

const memberA: CooperativeActor = {
  id: "user-member-a",
  role: "member",
  cooperativeId: coopA,
};

const memberB: CooperativeActor = {
  id: "user-member-b",
  role: "member",
  cooperativeId: coopB,
};

describe("cooperative tenancy", () => {
  it("derives scope from the actor, not client-supplied cooperative IDs", () => {
    expect(resolveCooperativeScope(memberA)).toBe(coopA);
    expect(resolveCooperativeScope(memberB)).toBe(coopB);
    expect(resolveCooperativeScope(platformAdmin)).toBeNull();
  });

  it("prevents a member from accessing another cooperative's records", () => {
    expect(canAccessCooperativeResource(memberA, coopA)).toBe(true);
    expect(canAccessCooperativeResource(memberA, coopB)).toBe(false);
    expect(canAccessCooperativeResource(memberB, coopA)).toBe(false);
  });

  it("prevents a cooperative admin from crossing cooperative boundaries", () => {
    expect(canAccessCooperativeResource(coopAdminA, coopA)).toBe(true);
    expect(canAccessCooperativeResource(coopAdminA, coopB)).toBe(false);
  });

  it("allows platform administrators to access any cooperative", () => {
    expect(canAccessCooperativeResource(platformAdmin, coopA)).toBe(true);
    expect(canAccessCooperativeResource(platformAdmin, coopB)).toBe(true);
  });

  it("denies access when the actor has no cooperative scope", () => {
    const unscoped: CooperativeActor = {
      id: "user-unscoped",
      role: "member",
      cooperativeId: null,
    };
    expect(canAccessCooperativeResource(unscoped, coopA)).toBe(false);
  });
});
