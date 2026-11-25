"use client"

import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useWallet } from "@/lib/wallet-context"
import { useAuth } from "@/lib/auth-context"
import { useI18n } from "@/lib/i18n-context"
import { useAdminStats } from "@/hooks/useAdminStats"
import { Sidebar } from "@/components/sidebar"
import { DashboardHeader } from "@/components/dashboard-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { Building2, Users, Zap, Award, Shield, ShieldAlert, ArrowRight, ExternalLink } from "lucide-react"
import { InfoTooltip } from "@/components/shared/info-tooltip"
import { getStellarExpertUrl } from "@/lib/utils"
import { MintTokenPanel } from "@/components/admin/mint-token-panel"
import {
  ADMIN_ROUTES,
  PLATFORM_ADMIN_SECTIONS,
  hasAdminScope,
  isPlatformAdminSection,
} from "@/lib/navigation/admin-routes"

export default function PlatformAdminPage() {
  return (
    <Suspense fallback={null}>
      <PlatformAdminContent />
    </Suspense>
  )
}

function PlatformAdminContent() {
  const { isConnected, isPending: walletPending } = useWallet()
  const { session, isLoading: authLoading } = useAuth()
  const { t } = useI18n()
  const router = useRouter()
  const { stats, loading, error } = useAdminStats()
  const searchParams = useSearchParams()
  const requestedSection = searchParams.get("section")

  useEffect(() => {
    if (!walletPending && !authLoading && !isConnected) {
      router.push("/")
    }
  }, [isConnected, walletPending, authLoading, router])

  const isAccessDenied = !authLoading && !walletPending && session && !session.is_super_admin
  const isPageLoading = authLoading || walletPending || loading

  const isCooperativeAdmin = hasAdminScope(session, "cooperative")

  // Deep links (`?section=token-issuance`, legacy `/admin`) scroll to the
  // requested section once the content has rendered.
  useEffect(() => {
    if (isPageLoading || isAccessDenied || !isPlatformAdminSection(requestedSection)) return
    document.getElementById(`admin-${requestedSection}`)?.scrollIntoView({ block: "start" })
  }, [isPageLoading, isAccessDenied, requestedSection])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="md:ml-64">
        <DashboardHeader />

        <div className="p-4 md:p-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-primary" aria-hidden="true" />
              <h1 className="text-2xl font-bold">{t("superAdmin.title")}</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{t("adminIa.platformScope")}</p>
          </div>

          {isPageLoading && (
            <div className="flex items-center justify-center py-12">
              <Spinner className="size-8" />
            </div>
          )}

          {isAccessDenied && (
            <Card>
              <CardContent className="p-12 text-center">
                <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-muted-foreground">{t("superAdmin.accessDenied")}</p>
                {isCooperativeAdmin && (
                  <Link href={ADMIN_ROUTES.cooperative} className="inline-block mt-4 text-sm text-primary hover:underline">
                    {t("adminIa.goToCooperativeAdmin")} →
                  </Link>
                )}
              </CardContent>
            </Card>
          )}

          {error && !isPageLoading && (
            <Card>
              <CardContent className="p-8 text-center text-destructive">{error}</CardContent>
            </Card>
          )}

          {!isPageLoading && !isAccessDenied && session?.is_super_admin && (
            <nav aria-label={t("adminIa.sections")} className="mb-6 flex flex-wrap gap-2">
              {PLATFORM_ADMIN_SECTIONS.map((section) => (
                <a
                  key={section}
                  href={`?section=${section}`}
                  onClick={(e) => {
                    e.preventDefault()
                    router.replace(`${ADMIN_ROUTES.platform}?section=${section}`, { scroll: false })
                    document.getElementById(`admin-${section}`)?.scrollIntoView({ block: "start" })
                  }}
                  aria-current={requestedSection === section ? "location" : undefined}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted aria-[current=location]:bg-primary/10 aria-[current=location]:text-primary"
                >
                  {t(`adminIa.section.${section}`)}
                </a>
              ))}
            </nav>
          )}

          {!isPageLoading && !isAccessDenied && stats && (
            <>
              {/* Global Stats */}
              <section id="admin-overview" aria-label={t("adminIa.section.overview")} className="scroll-mt-20 grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1 mb-2">
                      <Building2 className="w-5 h-5 text-primary" />
                      <InfoTooltip text={t("superAdmin.tooltip.cooperatives")} />
                    </div>
                    <p className="text-2xl font-bold">{stats.totals.cooperatives}</p>
                    <p className="text-xs text-muted-foreground">{t("superAdmin.cooperatives")}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1 mb-2">
                      <Users className="w-5 h-5 text-energy-green" />
                      <InfoTooltip text={t("superAdmin.tooltip.members")} />
                    </div>
                    <p className="text-2xl font-bold">{stats.totals.members}</p>
                    <p className="text-xs text-muted-foreground">{t("superAdmin.members")}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1 mb-2">
                      <Zap className="w-5 h-5 text-solar-orange" />
                      <InfoTooltip text={t("superAdmin.tooltip.kwhCertified")} />
                    </div>
                    <p className="text-2xl font-bold">{stats.totals.total_kwh_certified.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{t("superAdmin.kwhCertified")}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="flex items-center justify-center gap-1 mb-2">
                      <Award className="w-5 h-5 text-web3-purple" />
                      <InfoTooltip text={t("superAdmin.tooltip.totalCertificates")} />
                    </div>
                    <p className="text-2xl font-bold">{stats.totals.certificates_total}</p>
                    <p className="text-xs text-muted-foreground">{t("superAdmin.totalCertificates")}</p>
                  </CardContent>
                </Card>
              </section>

              {/* All Cooperatives Table */}
              <Card id="admin-cooperatives" className="mb-6 scroll-mt-20">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Building2 className="w-5 h-5" />
                    {t("superAdmin.allCooperatives")}
                    <InfoTooltip text={t("superAdmin.tooltip.allCooperatives")} />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {stats.cooperatives.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t("superAdmin.noCooperatives")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="pb-2 font-medium">{t("common.name")}</th>
                            <th className="pb-2 font-medium">{t("common.technology")}</th>
                            <th className="pb-2 font-medium">{t("common.province")}</th>
                            <th className="pb-2 font-medium">{t("superAdmin.members")}</th>
                            <th className="pb-2 font-medium">Certs</th>
                            <th className="pb-2 font-medium">{t("common.kwh")}</th>
                            <th className="pb-2 font-medium">{t("common.status")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.cooperatives.map((coop) => (
                            <tr key={coop.id} className="border-b border-border/50">
                              <td className="py-3 font-medium">{coop.name}</td>
                              <td className="py-3">{coop.technology}</td>
                              <td className="py-3">{coop.province || "—"}</td>
                              <td className="py-3">{coop.member_count}</td>
                              <td className="py-3">{coop.certificates_count}</td>
                              <td className="py-3">{coop.total_kwh.toLocaleString()}</td>
                              <td className="py-3"><StatusBadge status={coop.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Certificate Pipeline */}
              <Card id="admin-pipeline" className="mb-6 scroll-mt-20">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Award className="w-5 h-5" />
                    {t("superAdmin.pipeline")}
                    <InfoTooltip text={t("superAdmin.tooltip.pipeline")} />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-center gap-4 py-4">
                    <div className="text-center p-4 rounded-lg bg-solar-yellow/10 border border-solar-yellow/20 flex-1">
                      <p className="text-2xl font-bold text-solar-yellow">{stats.totals.certificates_pending}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("superAdmin.pending")}</p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div className="text-center p-4 rounded-lg bg-energy-green/10 border border-energy-green/20 flex-1">
                      <p className="text-2xl font-bold text-energy-green">{stats.totals.certificates_available}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("superAdmin.available")}</p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
                    <div className="text-center p-4 rounded-lg bg-solar-orange/10 border border-solar-orange/20 flex-1">
                      <p className="text-2xl font-bold text-solar-orange">{stats.totals.certificates_retired}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("superAdmin.retired")}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* System Health */}
              <div id="admin-activity" className="grid lg:grid-cols-2 gap-4 md:gap-6 scroll-mt-20">
                {/* Recent Mints */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {t("superAdmin.recentMints")}
                      <InfoTooltip text={t("superAdmin.tooltip.recentMints")} />
                    </CardTitle>
                    <CardDescription>Stellar Testnet</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {stats.recent_mints.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No mints yet</p>
                    ) : (
                      <div className="space-y-3">
                        {stats.recent_mints.map((mint) => (
                          <div key={mint.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                            <div className="w-8 h-8 rounded-full bg-energy-green/10 flex items-center justify-center">
                              <Zap className="w-4 h-4 text-energy-green" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{mint.total_kwh.toLocaleString()} kWh</p>
                              <p className="text-xs text-muted-foreground">{mint.technology} · {new Date(mint.created_at).toLocaleDateString()}</p>
                            </div>
                            {mint.mint_tx_hash && (
                              <a
                                href={getStellarExpertUrl(mint.mint_tx_hash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Recent Retirements */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      {t("superAdmin.recentRetirements")}
                      <InfoTooltip text={t("superAdmin.tooltip.recentRetirements")} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {stats.recent_retirements.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No retirements yet</p>
                    ) : (
                      <div className="space-y-3">
                        {stats.recent_retirements.map((ret) => (
                          <div key={ret.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                            <div className="w-8 h-8 rounded-full bg-solar-orange/10 flex items-center justify-center">
                              <Award className="w-4 h-4 text-solar-orange" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{ret.total_kwh.toLocaleString()} kWh</p>
                              <p className="text-xs text-muted-foreground">{ret.technology} · {new Date(ret.created_at).toLocaleDateString()}</p>
                            </div>
                            <StatusBadge status={ret.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {/* Token issuance — moved here from the legacy /admin page. Rendered
              independently of the stats request so a stats outage does not
              hide it. The on-chain minter role is re-checked by the panel and
              enforced by the token contract. */}
          {!isPageLoading && !isAccessDenied && session?.is_super_admin && (
            <section id="admin-token-issuance" aria-labelledby="admin-token-issuance-title" className="mt-6 scroll-mt-20">
              <h2 id="admin-token-issuance-title" className="text-lg font-semibold mb-1">
                {t("adminIa.section.token-issuance")}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">{t("adminIa.tokenIssuanceHelp")}</p>
              <MintTokenPanel />
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
