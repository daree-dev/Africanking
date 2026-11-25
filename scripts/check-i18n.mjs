#!/usr/bin/env node
/**
 * i18n completeness check
 *
 * Reports:
 *   [MISSING in <locale>]  — key present in the other locale but absent here
 *   [UNUSED key]           — key present in translations but never called via t()
 *   [UNKNOWN call]         — t("key") call site whose key is absent from all locales
 *
 * Exit code: 0 = clean, 1 = issues found.
 *
 * Usage:
 *   node scripts/check-i18n.mjs
 */

import { readFileSync, readdirSync, statSync } from "fs"
import { join, resolve } from "path"

const ROOT = resolve(import.meta.dirname, "..")
const I18N_FILE = join(ROOT, "apps/web/lib/i18n-context.tsx")
const SCAN_DIRS = [
  join(ROOT, "apps/web/app"),
  join(ROOT, "apps/web/components"),
  join(ROOT, "apps/web/hooks"),
]

// ── 1. Parse translation keys from the i18n file ──────────────────────────────

const source = readFileSync(I18N_FILE, "utf8")

function extractKeys(source, locale) {
  // Find the locale object block: `es: { ... }` or `en: { ... }`
  const localePattern = new RegExp(`\\b${locale}:\\s*\\{`, "g")
  const start = localePattern.exec(source)
  if (!start) return new Set()

  let depth = 0
  let i = start.index + start[0].length - 1 // position of opening {
  let blockStart = i
  while (i < source.length) {
    if (source[i] === "{") depth++
    else if (source[i] === "}") {
      depth--
      if (depth === 0) break
    }
    i++
  }
  const block = source.slice(blockStart, i + 1)
  const keyPattern = /"([^"]+)":\s*["(`]/g
  const keys = new Set()
  let m
  while ((m = keyPattern.exec(block)) !== null) {
    keys.add(m[1])
  }
  return keys
}

const esKeys = extractKeys(source, "es")
const enKeys = extractKeys(source, "en")
const allKeys = new Set([...esKeys, ...enKeys])

// ── 2. Collect all t("…") call sites across source files ─────────────────────

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...walk(full))
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

const sourceFiles = SCAN_DIRS.flatMap(dir => {
  try { return walk(dir) } catch { return [] }
})

const calledKeys = new Map() // key -> Set<"file:line">
const tCallPattern = /\bt\(\s*["']([^"']+)["']\s*\)/g

for (const file of sourceFiles) {
  const content = readFileSync(file, "utf8")
  const lines = content.split("\n")
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo]
    let m
    while ((m = tCallPattern.exec(line)) !== null) {
      const key = m[1]
      if (!calledKeys.has(key)) calledKeys.set(key, new Set())
      calledKeys.get(key).add(`${file.replace(ROOT + "/", "")}:${lineNo + 1}`)
    }
    tCallPattern.lastIndex = 0
  }
}

// ── 3. Report ─────────────────────────────────────────────────────────────────

let issues = 0

// Missing keys between locales
for (const key of allKeys) {
  if (!esKeys.has(key)) {
    console.log(`[MISSING in es]   ${key}`)
    issues++
  }
  if (!enKeys.has(key)) {
    console.log(`[MISSING in en]   ${key}`)
    issues++
  }
}

// Unused keys (defined but never called)
for (const key of allKeys) {
  if (!calledKeys.has(key)) {
    console.log(`[UNUSED key]      ${key}`)
    // Unused keys are warnings only — don't fail the build
  }
}

// Unknown call sites (called but not defined)
for (const [key, sites] of calledKeys) {
  if (!allKeys.has(key)) {
    for (const site of sites) {
      console.log(`[UNKNOWN call]    ${site}  t("${key}")`)
      issues++
    }
  }
}

if (issues === 0) {
  console.log("✓ i18n check passed — all keys present in both locales.")
} else {
  console.log(`\n✗ ${issues} issue(s) found. Fix before merging.`)
}

process.exit(issues > 0 ? 1 : 0)
