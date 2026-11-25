import { describe, it, expect } from "vitest"
import {
  ADMIN_ACTIONS,
  ADMIN_ROUTES,
  buildLegacyAdminRedirect,
  getAdminScopes,
  resolveAdminHome,
} from "@/lib/navigation/admin-routes"

const member = { cooperative_ids: ["c1"], admin_cooperative_ids: [], is_super_admin: false }
const coopAdmin = { cooperative_ids: ["c1"], admin_cooperative_ids: ["c1"], is_super_admin: false }
const platformAdmin = { cooperative_ids: [], admin_cooperative_ids: [], is_super_admin: true }
const both = { cooperative_ids: ["c1"], admin_cooperative_ids: ["c1"], is_super_admin: true }

describe("role routing", () => {
  it("resolves admin scopes per role", () => {
    expect(getAdminScopes(null)).toEqual([])
    expect(getAdminScopes(member)).toEqual([])
    expect(getAdminScopes(coopAdmin)).toEqual(["cooperative"])
    expect(getAdminScopes(platformAdmin)).toEqual(["platform"])
    expect(getAdminScopes(both)).toEqual(["platform", "cooperative"])
  })

  it("lands each admin on their canonical surface", () => {
    expect(resolveAdminHome(null)).toBeNull()
    expect(resolveAdminHome(member)).toBeNull()
    expect(resolveAdminHome(coopAdmin)).toBe(ADMIN_ROUTES.cooperative)
    expect(resolveAdminHome(platformAdmin)).toBe(ADMIN_ROUTES.platform)
    expect(resolveAdminHome(both)).toBe(ADMIN_ROUTES.platform)
  })
})

describe("legacy /admin deep links", () => {
  it("redirects to the token-issuance section of the canonical route", () => {
    expect(buildLegacyAdminRedirect({})).toBe("/dashboard/admin?section=token-issuance")
  })

  it("preserves query parameters, including repeated ones", () => {
    const url = new URL(buildLegacyAdminRedirect({ ref: "email", tag: ["a", "b"] }), "http://x")
    expect(url.pathname).toBe("/dashboard/admin")
    expect(url.searchParams.get("ref")).toBe("email")
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"])
    expect(url.searchParams.get("section")).toBe("token-issuance")
  })

  it("keeps an explicitly requested valid section and replaces unknown ones", () => {
    expect(buildLegacyAdminRedirect({ section: "pipeline" })).toBe("/dashboard/admin?section=pipeline")
    expect(buildLegacyAdminRedirect(new URLSearchParams("section=../../evil"))).toBe(
      "/dashboard/admin?section=token-issuance",
    )
  })

  it("never redirects off-site", () => {
    const target = buildLegacyAdminRedirect({ next: "https://evil.example" })
    expect(target.startsWith("/dashboard/admin?")).toBe(true)
  })
})

describe("admin actions", () => {
  it("assigns every action to exactly one admin surface", () => {
    const all = [...ADMIN_ACTIONS.platform, ...ADMIN_ACTIONS.cooperative]
    expect(new Set(all).size).toBe(all.length)
  })
})
