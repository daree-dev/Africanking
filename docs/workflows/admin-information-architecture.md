# Administrator information architecture

BeEnergy has two administrative surfaces. Each action lives on exactly one of
them; navigation is generated from `apps/web/lib/navigation/` so the desktop
and mobile sidebars cannot drift apart.

| Surface | Route | Who sees it | What lives there |
|---|---|---|---|
| Platform admin | `/dashboard/admin` | `session.is_super_admin` | Cross-cooperative stats, all cooperatives, credit pipeline, recent on-chain activity, HDROP token issuance |
| Cooperative admin | `/dashboard/cooperative` (+ `/members`) | `session.admin_cooperative_ids` non-empty | Members, meters, readings, creating credit batches and assigning generation credits to members |

Generation credits are assigned to cooperative members. This is not an
external certificate marketplace and makes no I-REC/ESG certification claim.

Navigation and page guards are UX only. Authorization is enforced by the API
(`requireSuperAdmin`, `requireAdmin`, `requireMember`) and, for token
issuance, by the on-chain minter role.

## Deep links

Platform-admin sections can be linked with `?section=` —
`overview`, `cooperatives`, `pipeline`, `activity`, `token-issuance`.

The legacy `/admin` route is now a server redirect to
`/dashboard/admin?section=token-issuance`, preserving existing query
parameters. Keep it until external bookmarks have aged out.

## Rollout / migration

- No database changes.
- The legacy `/admin` page was gated by the wallet address matching
  `NEXT_PUBLIC_ADMIN_ADDRESS`. The canonical page is gated by the session's
  `is_super_admin` flag, so **add the minter wallet to
  `SUPER_ADMIN_ADDRESSES`** on the API before deploying, or that wallet loses
  access to the token-issuance panel. The panel still verifies the on-chain
  minter role before enabling issuance.
- Users must sign in again for a changed `SUPER_ADMIN_ADDRESSES` to be
  reflected in their session (`/api/auth/refresh` keeps the existing flag).
