// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, within } from "@testing-library/react"

const push = vi.fn()
let session: unknown = null
let pathname = "/dashboard"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => pathname,
}))
vi.mock("@/lib/i18n-context", () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock("@/lib/auth-context", () => ({ useAuth: () => ({ session }) }))

import { NavMenu } from "@/components/nav-menu"

describe("NavMenu", () => {
  beforeEach(() => {
    push.mockClear()
    pathname = "/dashboard"
  })

  it("shows no admin group for regular members", () => {
    session = { cooperative_ids: ["c1"], admin_cooperative_ids: [], is_super_admin: false }
    render(<NavMenu />)
    expect(screen.queryByText("sidebar.admin")).toBeNull()
    expect(screen.queryByText("nav.platformAdmin")).toBeNull()
    expect(screen.queryByText("nav.cooperativeAdmin")).toBeNull()
  })

  it("renders each admin surface exactly once for a dual-role user", () => {
    session = { cooperative_ids: ["c1"], admin_cooperative_ids: ["c1"], is_super_admin: true }
    render(<NavMenu />)
    expect(screen.getAllByRole("button", { name: "nav.platformAdmin" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "nav.cooperativeAdmin" })).toHaveLength(1)
    const adminList = screen.getByRole("list", { name: "sidebar.admin" })
    expect(within(adminList).getAllByRole("button")).toHaveLength(2)
  })

  it("marks the current admin page and navigates on click", () => {
    session = { cooperative_ids: ["c1"], admin_cooperative_ids: ["c1"], is_super_admin: false }
    pathname = "/dashboard/cooperative/members"
    const onNavigate = vi.fn()
    render(<NavMenu onNavigate={onNavigate} />)
    const coop = screen.getByRole("button", { name: "nav.cooperativeAdmin" })
    expect(coop.getAttribute("aria-current")).toBe("page")
    coop.click()
    expect(push).toHaveBeenCalledWith("/dashboard/cooperative")
    expect(onNavigate).toHaveBeenCalled()
  })
})
