import { supabase } from "@/lib/supabase"
import type { CreditAllocation } from "@/lib/types/database"

/** Postgres "undefined_table" — the credit_allocations migration is not applied yet. */
const UNDEFINED_TABLE = "42P01"

/**
 * Read allocations without breaking existing pages during rollout: if the
 * migration has not been applied, behave as if nothing was allocated.
 */
export async function fetchAllocations(filter: {
  certificateIds?: string[]
  cooperativeId?: string
  memberAddress?: string
}): Promise<CreditAllocation[]> {
  let query = supabase.from("credit_allocations").select("*")
  if (filter.certificateIds) {
    if (filter.certificateIds.length === 0) return []
    query = query.in("certificate_id", filter.certificateIds)
  }
  if (filter.cooperativeId) query = query.eq("cooperative_id", filter.cooperativeId)
  if (filter.memberAddress) query = query.eq("member_stellar_address", filter.memberAddress)

  const { data, error } = await query
  if (error) {
    if (error.code !== UNDEFINED_TABLE) console.error("[credit_allocations] read failed", error.message)
    return []
  }
  return (data ?? []) as CreditAllocation[]
}

export function countByCertificate(allocations: Pick<CreditAllocation, "certificate_id">[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const a of allocations) counts.set(a.certificate_id, (counts.get(a.certificate_id) ?? 0) + 1)
  return counts
}
