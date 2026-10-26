# Africanking API

The API is a standalone Next.js service. Its route handlers and request-ID middleware live here; server utilities remain in `apps/web/lib` and are resolved through the API TypeScript aliases.

## Local development

1. Copy `.env.example` to `.env.local` and provide the required server values.
2. Run `corepack pnpm --filter @be-energy/api dev` to start the API on port 3001.
3. Run `corepack pnpm --filter @be-energy/web dev` for the frontend on port 3000. The frontend proxies `/api/*` to `http://localhost:3001` by default.

To proxy to another API origin, set `API_URL` in the frontend environment. Use the API origin only, without a trailing slash or `/api` path.

## Deployment

Deploy this directory as a separate Next.js project with the API environment variables from `.env.example`. Set `API_URL` in the frontend deployment to the deployed API origin. The browser continues to use same-origin `/api/*` requests through the frontend proxy, including the HTTP-only session cookie.

Run API route tests with `corepack pnpm --filter @be-energy/api test:api`.
