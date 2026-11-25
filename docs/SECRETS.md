# Secret storage and rotation

This project separates public client configuration from server-only secrets.

## Public vs. server-only

- `NEXT_PUBLIC_*` variables are embedded in the client bundle. Never place secrets here.
- Server-only variables (for example `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `JWT_SECRET`) must only be set in server environments and CI secret stores.

## Storage

- Store secrets in the platform secret manager (GitHub Actions secrets, hosting provider env settings).
- Example env files (`.env.example`, `.env.local.example`) document variable names only — never commit real values.
- CI runs secret scanning and a client-bundle check to catch accidental leaks.

## Rotation

1. Generate a new credential in the provider console.
2. Update the secret in the platform secret store and CI secrets.
3. Redeploy so the new value is picked up.
4. Revoke the old credential.
5. If a secret was committed, treat it as compromised: rotate immediately and remove it from history.

## Environment separation

- Testnet and production use distinct credentials and network settings.
- CI blocks testnet network settings combined with production `NODE_ENV`.
- Generation credits are assigned to cooperative members; this is not an external certificate marketplace or a claim of I-REC/ESG certification.
