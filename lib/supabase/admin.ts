import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase service-role client.
 *
 * The service-role key bypasses row-level security, so this module must never
 * be imported into client bundles. Every privileged operation must go through
 * `withCooperativeAuth` (or an equivalent explicit authorization check) so
 * that cooperative/role membership is verified before touching the database.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase/admin.ts is server-only and must not be imported in the browser",
  );
}

let adminClient: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase service-role configuration (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    );
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}

export type CooperativeRole = "owner" | "admin" | "member";

export interface IdentityContext {
  userId: string;
  cooperativeId: string;
  role: CooperativeRole;
}

const PRIVILEGED_ROLES: ReadonlySet<CooperativeRole> = new Set([
  "owner",
  "admin",
]);

/**
 * Verifies that the caller belongs to the target cooperative with a role that
 * is allowed to perform privileged (service-role) operations.
 *
 * Throws when identity context is missing or the caller is not authorized for
 * the cooperative, preventing cross-tenant reads/writes.
 */
export async function assertCooperativeAccess(
  identity: IdentityContext | null | undefined,
  cooperativeId: string,
  options: { requirePrivileged?: boolean } = {},
): Promise<IdentityContext> {
  if (!identity || !identity.userId) {
    throw new Error("Missing identity context for privileged database operation");
  }

  if (!cooperativeId) {
    throw new Error("Missing cooperative scope for privileged database operation");
  }

  if (identity.cooperativeId !== cooperativeId) {
    throw new Error("Cross-tenant access denied for privileged database operation");
  }

  if (options.requirePrivileged && !PRIVILEGED_ROLES.has(identity.role)) {
    throw new Error("Insufficient role for privileged database operation");
  }

  return identity;
}

/**
 * Runs a privileged database operation only after cooperative/role
 * authorization succeeds. All service-role queries and mutations should be
 * wrapped with this helper.
 */
export async function withCooperativeAuth<T>(
  identity: IdentityContext | null | undefined,
  cooperativeId: string,
  operation: (client: SupabaseClient) => Promise<T>,
  options: { requirePrivileged?: boolean } = {},
): Promise<T> {
  await assertCooperativeAccess(identity, cooperativeId, options);
  return operation(getAdminClient());
}
