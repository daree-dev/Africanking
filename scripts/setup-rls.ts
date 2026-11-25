import { config } from "dotenv"
import { createClient } from "@supabase/supabase-js"

config({ path: "apps/web/.env.local" })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

// Service-role client is server-only. This script must never be bundled into
// browser code; it is executed via `tsx`/`node` in CI and deployment pipelines.
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ============================================
// Tenant table inventory
// Each entry declares the least-privilege policies expected for that table.
// `expectedPolicies` is the auditable invariant: deployment fails if any
// listed policy is missing after the migration runs.
// ============================================
type PolicySpec = {
  name: string
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL"
  using?: string
  check?: string
}

type TableSpec = {
  table: string
  policies: PolicySpec[]
}

const TENANT_TABLES: TableSpec[] = [
  {
    table: "cooperatives",
    policies: [
      { name: "cooperatives_select", command: "SELECT", using: "true" },
      { name: "cooperatives_deny_anon", command: "INSERT", check: "false" },
    ],
  },
  {
    table: "prosumers",
    policies: [{ name: "prosumers_deny_anon", command: "ALL", using: "false" }],
  },
  {
    table: "meters",
    policies: [{ name: "meters_deny_anon", command: "ALL", using: "false" }],
  },
  {
    table: "readings",
    policies: [{ name: "readings_deny_anon", command: "ALL", using: "false" }],
  },
  {
    table: "certificates",
    policies: [
      { name: "certificates_select", command: "SELECT", using: "true" },
      { name: "certificates_deny_write", command: "INSERT", check: "false" },
    ],
  },
  {
    table: "retirements",
    policies: [
      { name: "retirements_select", command: "SELECT", using: "true" },
      { name: "retirements_deny_write", command: "INSERT", check: "false" },
    ],
  },
  {
    table: "mint_log",
    policies: [{ name: "mint_log_deny_anon", command: "ALL", using: "false" }],
  },
  {
    table: "auth_challenges",
    policies: [{ name: "auth_challenges_deny_anon", command: "ALL", using: "false" }],
  },
  {
    table: "rate_limits",
    policies: [{ name: "rate_limits_deny_anon", command: "ALL", using: "false" }],
  },
  {
    table: "audit_log",
    policies: [{ name: "audit_log_deny_anon", command: "ALL", using: "false" }],
  },
]

function buildPolicySql(spec: PolicySpec, table: string): string {
  const parts = [`CREATE POLICY ${spec.name} ON ${table} FOR ${spec.command}`]
  if (spec.using !== undefined) parts.push(`USING (${spec.using})`)
  if (spec.check !== undefined) parts.push(`WITH CHECK (${spec.check})`)
  return parts.join(" ") + ";"
}

const SQL = `
-- ============================================
-- BeEnergy RLS Policies (defense in depth)
-- Service role key bypasses all RLS — this is expected for API routes
-- ============================================

-- Enable RLS on all tenant tables
${TENANT_TABLES.map((t) => `ALTER TABLE ${t.table} ENABLE ROW LEVEL SECURITY;`).join("\n")}

-- Least-privilege policies per access path
${TENANT_TABLES.map((t) =>
  t.policies
    .map(
      (p) =>
        `DROP POLICY IF EXISTS ${p.name} ON ${t.table};\n${buildPolicySql(p, t.table)}`,
    )
    .join("\n"),
).join("\n\n")}
`

// Verification query: returns every (table, policy) pair that is expected but
// missing from pg_policies. Deployment fails if any rows are returned.
const VERIFY_SQL = `
WITH expected(table_name, policy_name) AS (
  VALUES ${TENANT_TABLES.flatMap((t) =>
    t.policies.map((p) => `('${t.table}', '${p.name}')`),
  ).join(",\n         ")}
)
SELECT e.table_name, e.policy_name
FROM expected e
LEFT JOIN pg_policies p
  ON p.schemaname = 'public'
 AND p.tablename = e.table_name
 AND p.policyname = e.policy_name
WHERE p.policyname IS NULL;
`

async function main() {
  console.log("Setting up Row Level Security policies...")
  const { error } = await supabase.rpc("exec_sql", { query: SQL })

  if (error) {
    console.error("Could not execute SQL via RPC:", error.message)
    console.log("\nRun the following SQL directly in the Supabase SQL Editor:\n")
    console.log(SQL)
    process.exit(1)
  }

  console.log("RLS policies created successfully!")

  // Deployment invariant: every tenant table must have its expected policies.
  const { data: missing, error: verifyError } = await supabase.rpc("exec_sql", {
    query: VERIFY_SQL,
  })

  if (verifyError) {
    console.error("Could not verify RLS policies:", verifyError.message)
    process.exit(1)
  }

  const missingRows = Array.isArray(missing) ? missing : []
  if (missingRows.length > 0) {
    console.error("RLS verification failed — missing policies:")
    for (const row of missingRows as Array<{ table_name: string; policy_name: string }>) {
      console.error(`  - ${row.table_name}.${row.policy_name}`)
    }
    process.exit(1)
  }

  console.log("RLS verification passed: all tenant tables have expected policies.")
}

main()
