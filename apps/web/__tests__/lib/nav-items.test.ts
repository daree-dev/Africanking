import { describe, it, expect } from "vitest"
import { getNavItems, isNavItemActive } from "@/lib/navigation/nav-items"

const roles = {
  anonymous: null,
  member: { cooperative_ids: ["c1"], admin_cooperative_ids: [], is_super_admin: false },
  coopAdmin: { cooperative_ids: ["c1", "c2"], admin_cooperative_ids: ["c1", "c2"], is_super_admin: false },
  platformAdmin: { cooperative_ids: [], admin_cooperative_ids: [], is_super_admin: true },
  both: { cooperative_ids: ["c1"], admin_cooperative_ids: ["c1"], is_super_admin: true },
}

describe("getNavItems", () => {
  it.each([
    ["anonymous", []],
    ["member", []],
    ["coopAdmin", ["/dashboard/cooperative"]],
    ["platformAdmin", ["/dashboard/admin"]],
    ["both", ["/dashboard/cooperative", "/dashboard/admin"]],
  ] as const)("shows the right admin entries for %s", (role, expected) => {
    expect(getNavItems(roles[role]).admin.map((i) => i.href)).toEqual(expected)
  })

  it("never lists a route twice or exposes the legacy /admin entry", () => {
    for (const session of Object.values(roles)) {
      const { main, admin } = getNavItems(session)
      const hrefs = [...main, ...admin].map((i) => i.href)
      expect(new Set(hrefs).size).toBe(hrefs.length)
      expect(hrefs).not.toContain("/admin")
    }
  })

  it("labels platform and cooperative admin distinctly", () => {
    const { admin } = getNavItems(roles.both)
    expect(admin.map((i) => i.labelKey)).toEqual(["nav.cooperativeAdmin", "nav.platformAdmin"])
  })
})

describe("isNavItemActive", () => {
  it("matches nested routes without prefix collisions", () => {
    expect(isNavItemActive("/dashboard", "/dashboard")).toBe(true)
    expect(isNavItemActive("/dashboard/cooperative", "/dashboard")).toBe(false)
    expect(isNavItemActive("/dashboard/cooperative/members", "/dashboard/cooperative")).toBe(true)
    expect(isNavItemActive("/dashboard/cooperative-x", "/dashboard/cooperative")).toBe(false)
  })
})
