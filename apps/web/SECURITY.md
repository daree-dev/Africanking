# Web Security Headers & Content Security Policy

This document defines the browser-facing security headers for the cooperative
management web app (`apps/web`) and the API (`apps/api`). Generation credits
are assigned to cooperative members; this is **not** an external certificate
marketplace and makes **no** I-REC/ESG certification claim.

## Required headers

| Header | Value | Purpose |
| --- | --- | --- |
| `Content-Security-Policy` | see below | Reduce script injection / unsafe embedding |
| `X-Frame-Options` | `DENY` | Legacy clickjacking defense (CSP `frame-ancestors` is primary) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `X-Content-Type-Options` | `nosniff` | Block MIME sniffing |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Force HTTPS (production only) |

`Strict-Transport-Security` is emitted **only** in production; it is omitted in
development and preview so local HTTP and preview hosts are not pinned.

## Content Security Policy

Sources are inventoried explicitly — no broad `*` or `https:` wildcards.

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
```

### Third-party exceptions (documented)

| Integration | Directive | Origin | Why |
| --- | --- | --- | --- |
| Supabase (auth + data) | `connect-src` | `https://*.supabase.co`, `wss://*.supabase.co` | Auth session + realtime |
| Wallet SDK | `script-src` / `connect-src` | add the specific wallet origin(s) used in `NEXT_PUBLIC_WALLET_*` | Wallet connect flow |
| Analytics | `script-src` / `connect-src` | add the specific analytics origin(s) used in `NEXT_PUBLIC_ANALYTICS_*` | Usage metrics |

Any new third-party origin must be added to the table above **and** to the
header config in the same PR. Do not add wildcard hosts.

## Per-environment

- **development**: relaxed `connect-src` for localhost; no HSTS.
- **preview**: same as production CSP; no HSTS.
- **production**: full CSP + HSTS as above.

## Validation

1. Fetch a production-like response and confirm headers:
   `curl -sI https://<host>/ | grep -iE 'content-security-policy|x-frame-options|referrer-policy|x-content-type-options|strict-transport-security'`
2. Browser smoke test: load the app, complete wallet connect, and confirm
   analytics events fire with no CSP violations in the console.

## Rollout

Headers are additive and require no data migration. Roll out to preview first,
verify the smoke test, then promote to production.
