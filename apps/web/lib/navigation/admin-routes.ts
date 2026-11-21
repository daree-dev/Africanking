/**
 * Single source of truth for the administrator information architecture.
 *
 * There are exactly two administrative surfaces, separated by role:
 *
 *  - Platform admin  (`/dashboard/admin`)       — session.is_super_admin
 *      Cross-cooperative statistics, certificate pipeline overview, recent
 *      on-chain activity and HDROP token issuance (on-chain minter role is
 *      still enforced by the contract and re-checked in the panel).
 *
 *  - Cooperative admin (`/dashboard/cooperative`) — session.admin_cooperative_ids
 *      Operations scoped to the cooperatives the user administers: members,
 *      meters, readings and assigning generation credits to members.
 *
 * The legacy `/admin` route is kept only as a redirect so existing bookmarks
 * and shared links keep working (see `buildLegacyAdminRedirect`).
 *
 * NOTE: these helpers drive navigation and UX only. Authorization is enforced
 * by the API (`requireSuperAdmin`, `requireAdmin`, `requireMember`).
 */

export type AdminScope = "platform" | "cooperative"

export interface RoleSession {
  cooperative_ids: string[]
  admin_cooperative_ids: string[]
  is_super_admin: boolean
}

export const ADMIN_ROUTES = {
  platform: "/dashboard/admin",
  cooperative: "/dashboard/cooperative",
  cooperativeMembers: "/dashboard/cooperative/members",
} as const

/** Legacy entry points that must keep resolving during the migration. */
export const LEGACY_ADMIN_ROUTES = ["/admin"] as const

/** Sections rendered on the canonical platform-admin page, in display order. */
export const PLATFORM_ADMIN_SECTIONS = [
  "overview",
  "cooperatives",
  "pipeline",
  "activity",
  "token-issuance",
] as const
export type PlatformAdminSection = (typeof PLATFORM_ADMIN_SECTIONS)[number]

export function isPlatformAdminSection(value: string | null | undefined): value is PlatformAdminSection {
  return !!value && (PLATFORM_ADMIN_SECTIONS as readonly string[]).includes(value)
}

/**
 * Actions available on each admin surface. Every action lives on exactly one
 * surface so the two dashboards never offer the same control twice.
 */
export const ADMIN_ACTIONS: Record<AdminScope, readonly string[]> = {
  platform: ["view-platform-stats", "view-all-cooperatives", "view-certificate-pipeline", "issue-hdrop-tokens"],
  cooperative: ["manage-members", "add-meter", "submit-reading", "create-credit-batch", "assign-credits-to-members"],
}

export function getAdminScopes(session: RoleSession | null | undefined): AdminScope[] {
  if (!session) return []
  const scopes: AdminScope[] = []
  if (session.is_super_admin) scopes.push("platform")
  if (session.admin_cooperative_ids.length > 0) scopes.push("cooperative")
  return scopes
}

export function hasAdminScope(session: RoleSession | null | undefined, scope: AdminScope): boolean {
  return getAdminScopes(session).includes(scope)
}

/**
 * Where an administrator should land when they open "Administration".
 * Platform admins land on the platform view; cooperative admins on their
 * cooperative. Non-admins get `null`.
 */
export function resolveAdminHome(session: RoleSession | null | undefined): string | null {
  const scopes = getAdminScopes(session)
  if (scopes.includes("platform")) return ADMIN_ROUTES.platform
  if (scopes.includes("cooperative")) return ADMIN_ROUTES.cooperative
  return null
}

/**
 * Maps the legacy `/admin` deep link onto the canonical platform-admin route,
 * preserving any query parameters and targeting the token-issuance section
 * (the only action that lived on the legacy page) unless a valid section was
 * explicitly requested.
 */
export function buildLegacyAdminRedirect(
  searchParams: Record<string, string | string[] | undefined> | URLSearchParams = {},
): string {
  const params = new URLSearchParams()
  const entries =
    searchParams instanceof URLSearchParams
      ? Array.from(searchParams.entries())
      : Object.entries(searchParams).flatMap(([k, v]) =>
          v === undefined ? [] : Array.isArray(v) ? v.map((item) => [k, item] as [string, string]) : [[k, v] as [string, string]],
        )
  for (const [k, v] of entries) params.append(k, v)
  if (!isPlatformAdminSection(params.get("section"))) {
    params.set("section", "token-issuance")
  }
  return `${ADMIN_ROUTES.platform}?${params.toString()}`
}
