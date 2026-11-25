"use client"

import { useId } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useI18n } from "@/lib/i18n-context"
import { useAuth } from "@/lib/auth-context"
import { getNavItems, isNavItemActive, type NavItem } from "@/lib/navigation/nav-items"
import { cn } from "@/lib/utils"

interface NavMenuProps {
  onNavigate?: () => void
}

/** Navigation list shared by the desktop sidebar and the mobile sheet. */
export function NavMenu({ onNavigate }: NavMenuProps) {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const { t } = useI18n()
  const { session } = useAuth()
  const { main, admin } = getNavItems(session)
  const adminHeadingId = useId()

  const renderItem = (item: NavItem) => {
    const Icon = item.icon
    const active = isNavItemActive(pathname, item.href)
    return (
      <li key={item.href}>
        <button
          type="button"
          onClick={() => {
            router.push(item.href)
            onNavigate?.()
          }}
          aria-current={active ? "page" : undefined}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-left text-sm",
            active
              ? "bg-sidebar-accent text-sidebar-primary font-semibold"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <Icon className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          <span>{t(item.labelKey)}</span>
        </button>
      </li>
    )
  }

  return (
    <nav className="flex-1 p-3 space-y-4" aria-label={t("nav.primary")}>
      <ul className="space-y-0.5">{main.map(renderItem)}</ul>
      {admin.length > 0 && (
        <div>
          <p id={adminHeadingId} className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50">
            {t("sidebar.admin")}
          </p>
          <ul aria-labelledby={adminHeadingId} className="space-y-0.5">
            {admin.map(renderItem)}
          </ul>
        </div>
      )}
    </nav>
  )
}
