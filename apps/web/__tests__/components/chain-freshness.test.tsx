import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nProvider } from "@/lib/i18n-context"
import { ChainFreshnessIndicator } from "@/components/shared/chain-freshness"
import { PendingChainWritesList } from "@/components/shared/pending-chain-writes"

const NOW = 1_700_000_000_000
const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>)

describe("ChainFreshnessIndicator", () => {
  it("shows live data with its age", () => {
    const html = render(<ChainFreshnessIndicator status="live" fetchedAt={NOW - 5 * 60_000} now={NOW} />)
    expect(html).toContain('data-freshness="live"')
    expect(html).toContain("Actualizado hace 5 min")
    expect(html).toContain('role="status"')
  })

  it("flags cached data as stale with the retry schedule", () => {
    const html = render(
      <ChainFreshnessIndicator
        status="stale"
        fetchedAt={NOW - 2 * 3_600_000}
        retry={{ attempt: 2, maxAttempts: 5, nextRetryAt: NOW + 12_000 }}
        onRetry={() => {}}
        now={NOW}
      />,
    )
    expect(html).toContain('data-freshness="stale"')
    expect(html).toContain("mostrando datos guardados de hace 2 h")
    expect(html).toContain("Reintento 2/5 en 12s")
    expect(html).toContain("Reintentar")
  })

  it("says unavailable instead of rendering a value", () => {
    const html = render(<ChainFreshnessIndicator status="unavailable" fetchedAt={null} onRetry={() => {}} now={NOW} />)
    expect(html).toContain("sin datos confirmados")
  })

  it("hides the retry button while data is live", () => {
    const html = render(<ChainFreshnessIndicator status="live" fetchedAt={NOW} onRetry={() => {}} now={NOW} />)
    expect(html).not.toContain("Reintentar")
  })
})

describe("PendingChainWritesList", () => {
  it("renders nothing when there are no pending writes", () => {
    expect(render(<PendingChainWritesList writes={[]} />)).toBe("")
  })

  it("lists each pending hash with an explorer link", () => {
    const html = render(
      <PendingChainWritesList
        writes={[{ hash: "abcdef0123456789", operation: "token.mint_energy", submittedAt: NOW, expiresAt: null, description: "Mint 5 HDROP" }]}
      />,
    )
    expect(html).toContain("Transacciones esperando confirmación")
    expect(html).toContain("Mint 5 HDROP")
    expect(html).toContain("stellar.expert/explorer/testnet/tx/abcdef0123456789")
  })
})
