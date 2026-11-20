import { NextResponse } from "next/server"
import * as fs from "fs"
import * as path from "path"

/**
 * GET /api/health
 *
 * Returns service liveness and a safe build identifier sourced from the
 * release manifest generated at build time (scripts/generate-manifest.ts).
 *
 * No credentials, secrets, or user data are included in this response.
 * The manifest is loaded at module initialisation so the file read is
 * paid once per cold start, not per request.
 */

interface ReleaseManifest {
  build_id: string
  git: {
    short_sha: string
    commit_date: string
    branch: string
    tags: string[]
  }
  network: {
    stellar_network: string
    vercel_env: string
    vercel_region: string
  }
  generated_at: string
}

function loadManifest(): Partial<ReleaseManifest> {
  // Manifest is written to <repo-root>/dist/release-manifest.json at build time.
  // Fall back gracefully when running in development without a prior build.
  const candidates = [
    path.resolve(process.cwd(), "../../dist/release-manifest.json"),
    path.resolve(process.cwd(), "dist/release-manifest.json"),
  ]
  for (const candidate of candidates) {
    try {
      const raw = fs.readFileSync(candidate, "utf8")
      return JSON.parse(raw) as ReleaseManifest
    } catch {
      // try next candidate
    }
  }
  return {}
}

const manifest = loadManifest()

export async function GET() {
  const body = {
    status: "ok",
    service: "@be-energy/api",
    build_id: manifest.build_id ?? "dev",
    git: manifest.git
      ? {
          short_sha: manifest.git.short_sha,
          commit_date: manifest.git.commit_date,
          branch: manifest.git.branch,
        }
      : null,
    network: manifest.network
      ? {
          stellar_network: manifest.network.stellar_network,
          env: manifest.network.vercel_env,
          region: manifest.network.vercel_region,
        }
      : null,
    manifest_generated_at: manifest.generated_at ?? null,
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(body, {
    headers: {
      // Allow external monitors to cache briefly; never cache stale health data
      "Cache-Control": "no-store",
    },
  })
}
