"use client"

import { useRouter } from "next/navigation"
import { useI18n } from "@/lib/i18n-context"
import { LogOut } from "lucide-react"
import { useWallet } from "@/lib/wallet-context"
import { NavMenu } from "@/components/nav-menu"
import Link from "next/link"

export function Sidebar() {
  const router = useRouter()
  const { disconnectWallet } = useWallet()
  const { t } = useI18n()

  const handleDisconnect = () => {
    disconnectWallet()
    router.push("/")
  }

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-sidebar-border flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <Link href="/dashboard" className="flex items-center gap-3">
          <img src="/beenergy-assets/BeEnergy-logo-white.svg" alt="BeEnergy" className="h-7 w-auto" />
        </Link>
      </div>

      <NavMenu />

      <div className="p-3 border-t border-sidebar-border">
        <button
          type="button"
          onClick={handleDisconnect}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          {t("sidebar.disconnect")}
        </button>
      </div>
    </aside>
  )
}
