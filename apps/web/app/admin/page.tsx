import { redirect } from "next/navigation"
import { buildLegacyAdminRedirect } from "@/lib/navigation/admin-routes"

/**
 * Legacy entry point. The HDROP token-issuance panel that used to live here
 * is now a section of the canonical platform-admin page. Keep this redirect
 * until external links/bookmarks to `/admin` have aged out.
 */
export default async function LegacyAdminRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(buildLegacyAdminRedirect(await searchParams))
}
