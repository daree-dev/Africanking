"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useI18n } from "@/lib/i18n-context"
import { LogOut, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWallet } from "@/lib/wallet-context"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { NavMenu } from "@/components/nav-menu"
import Link from "next/link"

export function MobileSidebar() {
  const router = useRouter()
  const { disconnectWallet } = useWallet()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const handleDisconnect = () => {
    disconnectWallet()
    router.push("/")
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu">
          <Menu className="w-6 h-6" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-sidebar-border">
            <Link href="/dashboard" className="flex items-center gap-3">
              <img src="/beenergy-assets/BeEnergy-logo-white.svg" alt="BeEnergy" className="h-7 w-auto" />
            </Link>
          </div>

          <NavMenu onNavigate={() => setOpen(false)} />

          {/* Disconnect Button */}
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
        </div>
      </SheetContent>
    </Sheet>
  )
}
