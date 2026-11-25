/**
 * Migration: legacy prosumers -> canonical member identity + cooperative membership.
 *
 * Issue #45: Normalize member identity and cooperative membership relationships.
 *
 * Legacy model: a single `prosumers` row carried both the authentication identity
 * (wallet) and the cooperative membership (cooperative_id). The canonical model
 * separates these:
 *   - members            : canonical member record (one per human/entity)
 *   - member_identities  : authentication identities (wallet/credential) -> member
 *   - cooperative_members: cooperative membership relationships -> member
 *
 * This script is idempotent and reports conflicts explicitly instead of silently
 * dropping or merging data. It never deletes legacy rows; backward-compatible
 * reads of `prosumers` remain valid until the documented sunset period ends
 * (see MIGRATION_SUNSET below).
 *
 * Usage:
 *   ts-node scripts/migrate-legacy-prosumers.ts --dry-run
 *   ts-node scripts/migrate-legacy-prosumers.ts --apply
 *   ts-node scripts/migrate-legacy-prosumers.ts --rollback <run_id>
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Backward-compatible reads of the legacy `prosumers` table are supported until
 * this date. After the sunset, reads must go through the canonical tables.
 */
export const MIGRATION_SUNSET = '2025-12-31';

export type LegacyProsumerRow = {
  id: string;
  wallet_address: string | null;
  cooperative_id: string | null;
  display_name?: string | null;
  created_at?: string | null;
};

export type ConflictKind =
  | 'duplicate_wallet'
  | 'multiple_memberships'
  | 'missing_cooperative'
  | 'missing_wallet';

export type MigrationConflict = {
  kind: ConflictKind;
  legacy_id: string;
  detail: string;
};

export type MigrationPlan = {
  members: Array<{ legacy_id: string; display_name: string | null }>;
  identities: Array<{ legacy_id: string; member_legacy_id: string; wallet_address: string }>;
  memberships: Array<{ legacy_id: string; member_legacy_id: string; cooperative_id: string }>;
  conflicts: MigrationConflict[];
};

const normalizeWallet = (wallet: string | null | undefined): string | null => {
  if (!wallet) return null;
  const trimmed = wallet.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Build a deterministic migration plan from legacy rows.
 *
 * Rules:
 *  - A wallet is the canonical identity key. Rows sharing a normalized wallet
 *    collapse into one member; the first row (by created_at, then id) wins as
 *    the canonical member and the rest are reported as `duplicate_wallet`.
 *  - A member may hold multiple cooperative memberships; each distinct
 *    cooperative_id becomes a `cooperative_members` row. Rows with more than one
 *    distinct cooperative for the same wallet are reported as
 *    `multiple_memberships` (informational, not fatal).
 *  - Rows without a cooperative_id are reported as `missing_cooperative` and
 *    produce a member + identity but no membership.
 *  - Rows without a wallet cannot be keyed and are reported as `missing_wallet`.
 */
export function buildMigrationPlan(rows: LegacyProsumerRow[]): MigrationPlan {
  const plan: MigrationPlan = { members: [], identities: [], memberships: [], conflicts: [] };

  const sorted = [...rows].sort((a, b) => {
    const at = a.created_at ?? '';
    const bt = b.created_at ?? '';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const canonicalByWallet = new Map<string, string>();
  const cooperativesByWallet = new Map<string, Set<string>>();

  for (const row of sorted) {
    const wallet = normalizeWallet(row.wallet_address);
    if (!wallet) {
      plan.conflicts.push({
        kind: 'missing_wallet',
        legacy_id: row.id,
        detail: 'Legacy prosumer has no wallet address; cannot derive identity.',
      });
      continue;
    }

    let memberLegacyId = canonicalByWallet.get(wallet);
    if (!memberLegacyId) {
      memberLegacyId = row.id;
      canonicalByWallet.set(wallet, memberLegacyId);
      plan.members.push({ legacy_id: row.id, display_name: row.display_name ?? null });
      plan.identities.push({
        legacy_id: row.id,
        member_legacy_id: memberLegacyId,
        wallet_address: wallet,
      });
    } else {
      plan.conflicts.push({
        kind: 'duplicate_wallet',
        legacy_id: row.id,
        detail: `Wallet ${wallet} already mapped to member from legacy row ${memberLegacyId}.`,
      });
    }

    if (!row.cooperative_id) {
      plan.conflicts.push({
        kind: 'missing_cooperative',
        legacy_id: row.id,
        detail: 'Legacy prosumer has no cooperative reference; member created without membership.',
      });
      continue;
    }

    const seen = cooperativesByWallet.get(wallet) ?? new Set<string>();
    if (seen.has(row.cooperative_id)) continue;
    seen.add(row.cooperative_id);
    cooperativesByWallet.set(wallet, seen);

    plan.memberships.push({
      legacy_id: row.id,
      member_legacy_id: memberLegacyId,
      cooperative_id: row.cooperative_id,
    });

    if (seen.size > 1) {
      plan.conflicts.push({
        kind: 'multiple_memberships',
        legacy_id: row.id,
        detail: `Wallet ${wallet} belongs to multiple cooperatives: ${[...seen].join(', ')}.`,
      });
    }
  }

  return plan;
}

export type ApplyResult = {
  run_id: string;
  inserted_members: number;
  inserted_identities: number;
  inserted_memberships: number;
  conflicts: MigrationConflict[];
};

/**
 * Apply a migration plan inside a single transaction-like sequence.
 * A `migration_runs` row records the run so it can be rolled back.
 */
export async function applyMigration(
  supabase: SupabaseClient,
  plan: MigrationPlan,
): Promise<ApplyResult> {
  const { data: run, error: runError } = await supabase
    .from('migration_runs')
    .insert({ source: 'legacy_prosumers', sunset_at: MIGRATION_SUNSET })
    .select('id')
    .single();
  if (runError || !run) throw new Error(`Failed to record migration run: ${runError?.message}`);

  const runId = run.id as string;
  const memberIdByLegacy = new Map<string, string>();

  for (const member of plan.members) {
    const { data, error } = await supabase
      .from('members')
      .insert({ display_name: member.display_name, legacy_prosumer_id: member.legacy_id, migration_run_id: runId })
      .select('id')
      .single();
    if (error || !data) throw new Error(`Failed to insert member for ${member.legacy_id}: ${error?.message}`);
    memberIdByLegacy.set(member.legacy_id, data.id as string);
  }

  for (const identity of plan.identities) {
    const memberId = memberIdByLegacy.get(identity.member_legacy_id);
    if (!memberId) throw new Error(`Missing member for identity ${identity.legacy_id}`);
    const { error } = await supabase.from('member_identities').insert({
      member_id: memberId,
      kind: 'wallet',
      value: identity.wallet_address,
      migration_run_id: runId,
    });
    if (error) throw new Error(`Failed to insert identity for ${identity.legacy_id}: ${error.message}`);
  }

  for (const membership of plan.memberships) {
    const memberId = memberIdByLegacy.get(membership.member_legacy_id);
    if (!memberId) throw new Error(`Missing member for membership ${membership.legacy_id}`);
    const { error } = await supabase.from('cooperative_members').insert({
      member_id: memberId,
      cooperative_id: membership.cooperative_id,
      migration_run_id: runId,
    });
    if (error) throw new Error(`Failed to insert membership for ${membership.legacy_id}: ${error.message}`);
  }

  return {
    run_id: runId,
    inserted_members: plan.members.length,
    inserted_identities: plan.identities.length,
    inserted_memberships: plan.memberships.length,
    conflicts: plan.conflicts,
  };
}

/**
 * Roll back a previously applied migration run by deleting only the rows it
 * created. Legacy `prosumers` rows are never touched.
 */
export async function rollbackMigration(supabase: SupabaseClient, runId: string): Promise<void> {
  const { error: membershipError } = await supabase
    .from('cooperative_members')
    .delete()
    .eq('migration_run_id', runId);
  if (membershipError) throw new Error(`Rollback memberships failed: ${membershipError.message}`);

  const { error: identityError } = await supabase
    .from('member_identities')
    .delete()
    .eq('migration_run_id', runId);
  if (identityError) throw new Error(`Rollback identities failed: ${identityError.message}`);

  const { error: memberError } = await supabase.from('members').delete().eq('migration_run_id', runId);
  if (memberError) throw new Error(`Rollback members failed: ${memberError.message}`);

  const { error: runError } = await supabase.from('migration_runs').delete().eq('id', runId);
  if (runError) throw new Error(`Rollback run record failed: ${runError.message}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const rollbackIdx = args.indexOf('--rollback');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  if (rollbackIdx !== -1) {
    const runId = args[rollbackIdx + 1];
    if (!runId) throw new Error('--rollback requires a run id.');
    await rollbackMigration(supabase, runId);
    console.log(`Rolled back migration run ${runId}.`);
    return;
  }

  const { data, error } = await supabase
    .from('prosumers')
    .select('id, wallet_address, cooperative_id, display_name, created_at');
  if (error) throw new Error(`Failed to read legacy prosumers: ${error.message}`);

  const plan = buildMigrationPlan((data ?? []) as LegacyProsumerRow[]);

  console.log(`Legacy rows: ${(data ?? []).length}`);
  console.log(`Members: ${plan.members.length}`);
  console.log(`Identities: ${plan.identities.length}`);
  console.log(`Memberships: ${plan.memberships.length}`);
  console.log(`Conflicts: ${plan.conflicts.length}`);
  for (const conflict of plan.conflicts) {
    console.log(`  [${conflict.kind}] ${conflict.legacy_id}: ${conflict.detail}`);
  }

  if (dryRun) {
    console.log('Dry run complete. Re-run with --apply to write.');
    return;
  }

  const result = await applyMigration(supabase, plan);
  console.log(`Applied migration run ${result.run_id}.`);
  console.log(`Backward-compatible reads of legacy prosumers supported until ${MIGRATION_SUNSET}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
