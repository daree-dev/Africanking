# Release Process

## Promotion path

```
feature/* → develop → staging (auto) → production (manual + approval)
```

Every merge to `develop` triggers the `staging-promotion.yml` workflow, which runs build → test → migration check → contract manifest check → staging deploy.

Production promotion requires a manual `workflow_dispatch` trigger with:
- `target_environment = production`
- `confirm_manifest = true` (you have verified `contract-manifest.json` reflects deployed contracts)

GitHub's environment approval gate on `production` must also be satisfied before the job runs.

## Gates before staging deploy

All four jobs must pass:

| Gate | What it checks |
|---|---|
| **Build** | `pnpm turbo build` succeeds with staging env vars |
| **Tests** | `pnpm test:api` passes (all API unit tests) |
| **Migration check** | Migration files are present and ordered by timestamp |
| **Contract manifest** | Deployed contract IDs match `contract-manifest.json` |

## Gates before production promotion

Same four gates plus:
- `confirm_manifest` input explicitly set to `true`
- GitHub `production` environment approval by an authorized reviewer

## Staging rehearsal checklist

Before promoting a release to production, rehearse it on staging:

1. **Deploy to staging** — merge to `develop`; confirm CI passes and smoke test returns HTTP 200.
2. **Verify network** — open the staging URL; confirm the Stellar network badge shows `TESTNET`.
3. **Verify contracts** — check the app config reads the correct contract IDs from `contract-manifest.json`.
4. **Run smoke flows** — log in, submit a reading, review a member list, check the cooperative dashboard.
5. **Check migrations** — confirm the staging Supabase schema matches the latest migration files.
6. **Update manifest** — if contracts changed, update `contract-manifest.json` staging entries and commit before promoting.

## Rollback

### Vercel rollback

```bash
# List recent deployments for the project
vercel ls --token $VERCEL_TOKEN

# Promote a previous deployment to production instantly
vercel promote <deployment-url> --token $VERCEL_TOKEN
```

### Database rollback

Supabase migrations are forward-only. If a migration introduced a breaking schema change:

1. Create a new migration that reverses the change.
2. Deploy it to staging first and verify.
3. Promote using the standard promotion gate.

### Emergency rollback procedure

1. In Vercel dashboard → Project → Deployments → find the last known-good deployment → **Promote to Production**.
2. If the bad deployment included a migration, follow the database rollback steps above in parallel.
3. File a post-mortem issue within 48 hours describing root cause and prevention.

## Post-deployment verification

After a production deploy the CI smoke test checks for HTTP 200 on `PRODUCTION_URL`. Additionally, verify manually:

- Login flow works end-to-end.
- Reading submission returns `201` with correct `status: "pending"`.
- Member dashboard loads cooperative data from the production Supabase project (not testnet).
- The deployed contract IDs visible in the browser's network requests match `contract-manifest.json` production entries.
