import type { LucideIcon } from "lucide-react"
import { Home, History, Zap, Award, Building2, Shield } from "lucide-react"
import { ADMIN_ROUTES, getAdminScopes, type AdminScope, type RoleSession } from "./admin-routes"

export interface NavItem {
  icon: LucideIcon
  labelKey: string
  href: string
  /** Present only on administrative entries. */
  adminScope?: AdminScope
}

const BASE_ITEMS: NavItem[] = [
  { icon: Home, labelKey: "sidebar.dashboard", href: "/dashboard" },
  { icon: Award, labelKey: "sidebar.certificates", href: "/certificates" },
  { icon: History, labelKey: "sidebar.activity", href: "/activity" },
  { icon: Zap, labelKey: "sidebar.consumption", href: "/consumption" },
]

const ADMIN_ITEMS: Record<AdminScope, NavItem> = {
  cooperative: {
    icon: Building2,
    labelKey: "nav.cooperativeAdmin",
    href: ADMIN_ROUTES.cooperative,
    adminScope: "cooperative",
  },
  platform: {
    icon: Shield,
    labelKey: "nav.platformAdmin",
    href: ADMIN_ROUTES.platform,
    adminScope: "platform",
  },
}

/**
 * Builds the navigation for both the desktop and mobile sidebars from one
 * definition so the two can never drift apart. Each admin surface appears at
 * most once.
 */
export function getNavItems(session: RoleSession | null | undefined): { main: NavItem[]; admin: NavItem[] } {
  const scopes = getAdminScopes(session)
  // Cooperative admin first: it's the day-to-day surface for most admins.
  const admin = (["cooperative", "platform"] as const).filter((s) => scopes.includes(s)).map((s) => ADMIN_ITEMS[s])
  return { main: BASE_ITEMS, admin }
}

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard"
  return pathname === href || pathname.startsWith(`${href}/`)
}
