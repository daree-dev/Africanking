# Security

This document covers the security posture of the cooperative-management API and web app. Generation credits are assigned to cooperative members; this is not an external certificate marketplace and makes no I-REC/ESG certification claim.

## CSRF protection for cookie-authenticated mutations

SameSite cookie settings alone may not cover every deployment or proxy configuration for state-changing requests. Cookie-authenticated mutation routes therefore enforce an additional origin/CSRF check.

### Which routes are protected

Any state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) that is authenticated via the session cookie is treated as a cookie-authenticated mutation. This includes credit assignment, member management, and other write endpoints under the API. Read-only (`GET`/`HEAD`) requests are not subject to the CSRF check.

### Requirements

A cookie-authenticated mutation is accepted only when **both** of the following hold:

1. **Origin check** — the request `Origin` header (falling back to `Referer` when `Origin` is absent) matches the configured application origin. Requests with a missing or mismatched origin are rejected.
2. **CSRF token check** — the request carries a valid CSRF token that matches the token bound to the session (double-submit / session-bound token). Missing or invalid tokens are rejected.

Cross-site requests are rejected **before** any write or external transaction is performed, so no partial state is created on a failed check.

### Safe behavior for local development

- Local development runs on a single origin (e.g. `http://localhost:3000`). The origin check compares against the configured app origin, so same-origin requests from the dev server pass without extra setup.
- The CSRF token is issued with the session and must be sent on mutations. The web client reads it from the session response and includes it automatically; no manual configuration is required for the standard dev flow.

### Same-origin API proxying

- When the web app proxies API calls through the same origin, the browser sends the app origin in `Origin`/`Referer`, so the origin check passes.
- If a reverse proxy terminates TLS or rewrites hosts, ensure the configured application origin reflects the public origin the browser uses. Do not disable the origin check in production; instead align the configured origin with the proxy's public host.

### Rollout and migration

- No data migration is required. The CSRF check is enforced at the request boundary and does not alter stored records.
- Existing sessions remain valid; clients must include the CSRF token on mutations. Deploy the client change that sends the token together with (or before) enabling strict enforcement to avoid rejected writes.
- During rollout, monitor rejected mutation responses (missing/invalid token, hostile origin) to confirm legitimate clients are sending the token before tightening enforcement.

### Validation

Representative mutation routes should be tested for:

- same-origin request with a valid token → accepted
- missing token → rejected
- invalid token → rejected
- hostile (cross-site) origin → rejected before any write
