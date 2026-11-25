# Contributor Guide

---

## Product direction

Africanking is cooperative management software. Generation credits are assigned to cooperative members as proof of their energy contribution. This is not an external certificate marketplace and makes no claim of I-REC or ESG certification.

Keep this direction in mind when proposing features or writing documentation.

---

## Branch policy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code. Direct pushes are blocked. |
| `develop` | Integration branch. All feature PRs target this branch. |
| `feat/<short-description>` | New features |
| `fix/<short-description>` | Bug fixes |
| `docs/<short-description>` | Documentation-only changes |
| `chore/<short-description>` | Build, tooling, dependency updates |

**All pull requests must target `develop`, not `main`.** The CI branch-policy check (`branch-policy.yml`) enforces this — PRs to `main` are only accepted from `develop` itself (for release promotion).

### Starting work

```bash
git checkout develop
git pull origin develop
git checkout -b feat/your-feature-name
```

---

## Claiming an issue

1. Find an open issue in the repository.
2. Leave a comment: "I'm picking this up" — this prevents duplicate work.
3. If you are blocked or the issue turns out to be more complex than expected, comment on the issue with what you found before opening a new one. Maintainers may reassign or split the work.

Do not open a duplicate issue if one already exists. Search with `is:issue is:open your keywords` before creating a new one.

---

## Commits

- Use the present tense: "add meter validation" not "added meter validation".
- Scope commits to one logical change. A commit that changes the API schema and also updates the UI is two commits.
- Reference the issue number in the PR description (not necessarily in every commit), using `closes #<number>` so GitHub auto-closes on merge.

---

## Pull requests

1. Open the PR against `develop`.
2. Fill in the PR description — explain what changed and why.
3. Include `closes #<issue-number>` for every issue the PR resolves.
4. Keep PRs focused. A PR that fixes a bug and adds a feature is harder to review and slower to merge.
5. At least one maintainer approval is required before merge.
6. All CI checks must pass.

---

## Running tests

Run only the tests relevant to your change. The full suite can be slow; targeted commands are faster and give clearer output.

### Web (unit tests)

```bash
pnpm --filter @be-energy/web test
```

Tests live in `apps/web/__tests__/`. They use Vitest.

### API (route tests)

```bash
pnpm --filter @be-energy/api test:api
```

Tests live in `apps/api/__tests__/api/`. They use Vitest.

### Contracts (Rust unit tests)

```bash
cd apps/contracts
cargo test
```

### Integration / end-to-end

No automated integration test suite exists yet. Manual verification steps:

1. Start the API and frontend: `pnpm dev`
2. Create a cooperative via `POST /api/cooperatives`.
3. Add a meter and submit a reading.
4. Mint a certificate and confirm the Stellar transaction hash appears in the response.

---

## Code style

- TypeScript strict mode is on. Do not use `any` without a comment explaining why.
- Follow existing file and folder conventions. API routes go in `apps/api/app/api/`; shared types go in `apps/web/lib/types/`.
- Run the formatter before pushing: `pnpm format`
- Do not introduce unrequested refactors in a PR that fixes a bug or adds a feature.

---

## Reporting blockers

If you are stuck, comment on the issue with:

1. What you tried.
2. What error or unexpected behavior you saw (paste the exact message).
3. What you expected to happen.

This gives maintainers enough context to help without a back-and-forth.
