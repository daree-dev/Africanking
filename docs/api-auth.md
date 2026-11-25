# API Authentication, Authorization, and Error Semantics

---

## Authentication

Africanking supports two login flows. Both issue the same HTTP-only session cookie and produce the same JWT claims.

### Flow 1 — Email / password (Supabase)

Used by cooperative admins and internal team members.

```
POST /api/auth/email/send    { email, password }
         ↓
POST /api/auth/email/verify  { token, email }
         ↓
Server sets be_session cookie (HTTP-only, Secure, SameSite=Strict)
         ↓
Browser uses /api/* via same-origin proxy — cookie sent automatically
```

The session expires after **24 hours**. No refresh endpoint exists yet; the user must log in again.

### Flow 2 — Stellar wallet challenge-response

Used by cooperative members who have a Freighter, xBull, or Lobstr wallet.

```
1.  GET  /api/auth/challenge?stellar_address=G…
         ← { challenge: "<64-char hex nonce>" }

2.  User signs challenge in wallet (SEP-0053 encoding)

3.  POST /api/auth/verify
         { stellar_address: "G…", challenge: "<hex>", signature: "<base64>" }
         ↓
    Server verifies Ed25519 signature against the public key
         ↓
    Server sets be_session cookie
```

**SEP-0053 encoding:** The challenge is signed as `SHA-256("Stellar Signed Message:\n" + challenge)`. Freighter, xBull, and Lobstr implement this automatically. If you are calling the API from a custom client, reproduce this encoding before signing.

### Session cookie

| Attribute | Value |
|-----------|-------|
| Name | `be_session` |
| HttpOnly | true — not accessible from JavaScript |
| Secure | true in production, false in local dev (`NODE_ENV !== "production"`) |
| SameSite | `Strict` |
| Path | `/` |
| Max-Age | 86400 s (24 h) |

### Session expiration and revocation

Sessions expire after 24 hours by JWT `exp` claim. There is no server-side session store, so individual sessions cannot be revoked before expiry. To log out:

```
POST /api/auth/logout
```

This clears the `be_session` cookie by setting `Max-Age: 0`. The JWT itself remains valid until its `exp`, but the browser will no longer send it.

### JWT claims

The JWT is signed with `HS256` using `JWT_SECRET` (server only — never expose this value).

```json
{
  "sub": "GDEMO...",
  "cooperative_ids": ["uuid-of-coop-1"],
  "admin_cooperative_ids": ["uuid-of-coop-1"],
  "is_super_admin": false,
  "iat": 1700000000,
  "exp": 1700086400
}
```

| Claim | Type | Meaning |
|-------|------|---------|
| `sub` | string | Stellar public address of the authenticated user |
| `cooperative_ids` | string[] | Cooperative UUIDs the user belongs to (member or admin) |
| `admin_cooperative_ids` | string[] | Subset of `cooperative_ids` where the user is the administrator |
| `is_super_admin` | boolean | True if `sub` appears in `SUPER_ADMIN_ADDRESSES` (server env var) |

---

## Authorization

### Role model

| Role | How it is granted | What it permits |
|------|-------------------|----------------|
| **Unauthenticated** | No cookie | Public endpoints only (none currently) |
| **Member** | `cooperative_ids` includes the target cooperative | Read own readings, view cooperative stats |
| **Cooperative admin** | `admin_cooperative_ids` includes the target cooperative | All member actions + create/update meters, trigger minting, manage members |
| **Super admin** | Stellar address in `SUPER_ADMIN_ADDRESSES` env var | All admin actions across all cooperatives + `/api/admin/*` |

### Role / action matrix

| Endpoint | Unauthenticated | Member | Coop admin | Super admin |
|----------|----------------|--------|------------|-------------|
| `GET /api/auth/challenge` | ✓ | ✓ | ✓ | ✓ |
| `POST /api/auth/verify` | ✓ | ✓ | ✓ | ✓ |
| `POST /api/auth/email/*` | ✓ | ✓ | ✓ | ✓ |
| `POST /api/auth/logout` | ✓ | ✓ | ✓ | ✓ |
| `GET /api/auth/me` | — | ✓ | ✓ | ✓ |
| `GET /api/cooperatives` | — | ✓ | ✓ | ✓ |
| `POST /api/cooperatives` | — | — | ✓ | ✓ |
| `GET /api/cooperatives/:id` | — | ✓ (own) | ✓ (own) | ✓ |
| `GET /api/cooperatives/:id/readings` | — | ✓ (own) | ✓ (own) | ✓ |
| `GET /api/members` | — | ✓ | ✓ | ✓ |
| `POST /api/members` | — | — | ✓ | ✓ |
| `GET /api/meters` | — | ✓ | ✓ | ✓ |
| `POST /api/meters` | — | — | ✓ | ✓ |
| `POST /api/meters/readings` | — | ✓ (own meter) | ✓ | ✓ |
| `GET /api/readings` | — | ✓ (own) | ✓ | ✓ |
| `GET /api/certificates` | — | ✓ (own coop) | ✓ (own coop) | ✓ |
| `POST /api/certificates` | — | — | ✓ | ✓ |
| `GET /api/certificates/stats` | — | ✓ (own coop) | ✓ | ✓ |
| `POST /api/certificates/retire` | — | — | ✓ | ✓ |
| `POST /api/mint` | — | — | ✓ | ✓ |
| `GET /api/admin/stats` | — | — | — | ✓ |
| `GET /api/profile` | — | ✓ | ✓ | ✓ |

---

## Error response format

All errors return JSON with an `error` string field.

```json
{ "error": "Human-readable message" }
```

### HTTP status codes

| Status | Meaning | Common causes |
|--------|---------|---------------|
| `400` | Bad request | Invalid JSON, failed schema validation, missing required field, referenced resource not found (FK violation) |
| `401` | Unauthenticated | No `be_session` cookie, expired token, or invalid token |
| `403` | Forbidden | Valid session but insufficient role for the requested action |
| `404` | Not found | Resource with the given ID does not exist |
| `409` | Conflict | Duplicate resource (unique constraint violation) |
| `429` | Too many requests | Rate limit exceeded on auth endpoints |
| `500` | Internal server error | Unexpected database or server error — details logged server-side only |

### Validation error example

```bash
curl -s -X POST http://localhost:3001/api/cooperatives \
  -H "Content-Type: application/json" \
  -d '{"name":""}' | jq .
```

```json
{
  "error": "Validation failed",
  "issues": [
    { "path": ["name"], "message": "String must contain at least 1 character(s)" },
    { "path": ["technology"], "message": "Required" },
    { "path": ["admin_stellar_address"], "message": "Required" }
  ]
}
```

### Authentication error examples

```bash
# No session cookie
curl -s http://localhost:3001/api/auth/me | jq .
# → { "error": "Authentication required" }

# Valid session but wrong cooperative
curl -s http://localhost:3001/api/cooperatives/<other-coop-id> \
  --cookie "be_session=<your-token>" | jq .
# → { "error": "Access denied" }
```

---

## Public vs. server-only configuration

| Variable | Exposed to browser | Used by |
|----------|--------------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Frontend Supabase client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Frontend Supabase client (read-only RLS access) |
| `NEXT_PUBLIC_STELLAR_NETWORK` | yes | Frontend Stellar SDK calls |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | yes | Frontend Soroban RPC calls |
| `NEXT_PUBLIC_STELLAR_HORIZON_URL` | yes | Frontend Horizon REST calls |
| `NEXT_PUBLIC_ENERGY_TOKEN_CONTRACT` | yes | Frontend contract interactions |
| `NEXT_PUBLIC_ENERGY_DISTRIBUTION_CONTRACT` | yes | Frontend contract interactions |
| `NEXT_PUBLIC_COMMUNITY_GOVERNANCE_CONTRACT` | yes | Frontend contract interactions |
| `NEXT_PUBLIC_APP_URL` | yes | Auth redirect URLs |
| `SUPABASE_SERVICE_ROLE_KEY` | **no — server only** | API route handlers (bypasses RLS) |
| `JWT_SECRET` | **no — server only** | JWT signing and verification |
| `MINTER_SECRET_KEY` | **no — server only** | Stellar transaction signing for minting |
| `SUPER_ADMIN_ADDRESSES` | **no — server only** | Super-admin privilege check |
| `DFNS_AUTH_TOKEN` | **no — server only** | DFNS wallet provisioning |
| `DFNS_PRIVATE_KEY` | **no — server only** | DFNS transaction signing |
| `DEFINDEX_API_KEY` | **no — server only** | DeFindex API calls |

Variables prefixed `NEXT_PUBLIC_` are bundled into the client-side JavaScript by Next.js. Never prefix a secret with `NEXT_PUBLIC_`.

---

## OpenAPI / API reference

A full OpenAPI spec does not yet exist. See `apps/api/app/api/` for the route handlers. Each route file is the authoritative specification until an OpenAPI document is generated.

For a quick summary of available routes:

```bash
find apps/api/app/api -name "route.ts" | sed 's|apps/api/app||; s|/route.ts||'
```
