# Outpost

Outpost is a portfolio project: a Discord-style voice/text chat platform, built to
demonstrate the architecture and deployment decisions involved in shipping a realtime,
multi-tenant app that's actually designed to hold up under a large userbase — not just a
CRUD demo with a chat UI bolted on.

## Why this stack

**Next.js** (App Router, React Server Components) is the frontend. It gives a modern
routing/rendering model without dictating a specific backend or hosting story, which matters
because the next two choices are deliberately non-default:

**Convex** is the backend — not a database with a REST layer in front of it, but a reactive
BaaS: every query is a live subscription (no polling, no manual cache invalidation, no
separate WebSocket layer to run and scale yourself), every mutation is a transaction, and
schema/indexes/auth all live in one type-checked system instead of being stitched together
from a database, an ORM, an API framework, and a pub/sub service. For a chat app — where
"realtime" isn't a nice-to-have but the entire product — that collapses a large amount of
infrastructure most teams would otherwise have to build and operate themselves (connection
management, fan-out, cache coherency) into something that scales by design rather than by
manual sharding later.

**Cloudflare** hosts the app itself — the Next.js app runs as a Cloudflare Worker (via
`vinext`), putting it on Cloudflare's edge network rather than a single-region server, and
**RealtimeKit** provides the voice/video call infrastructure. Building and operating your own
SFU/TURN stack for group calls is a significant, easy-to-get-wrong undertaking (NAT
traversal, media relay capacity, geographic routing); RealtimeKit is a managed layer for
exactly that, so voice channels can scale the same way the rest of the app does — without
owning that infrastructure.

Put together: an edge-hosted frontend, a serverless reactive backend, and managed realtime
media, wired so that going from "works for me and my friends" to "works for a lot of people"
doesn't require re-architecting any of the three.

## Environments

Two fully separate environments, each with its own Convex deployment and Clerk instance —
not just a feature flag:

- **Production** — `outpost.zenfora.io`
- **Dev** — `outpost-dev.zenfora.io`

See `wrangler.jsonc` (top-level config vs. the `env.dev` block) and `package.json`'s
`build:vinext`/`deploy:vinext` (prod) vs. `build:vinext:dev`/`deploy:vinext:dev` (dev)
scripts.

Deploys are run from a checkout (`bun run build:vinext && bun run deploy:vinext`, plus
`bunx convex deploy`). `.github/workflows/production-deployment.yml` then records each
push to `main` as a GitHub **production** deployment, which is what puts the
"Deployments → production → View deployment" link in the repo sidebar. The link's URL
comes from the `PRODUCTION_URL` repository variable (defaults to `https://outpost.zenfora.io`).

## Features

- User registration & sign-in (Clerk)
- Friend requests (by exact username) + 1:1 direct messages
- Server creation, invite-code joining
- Categories, text channels, and voice channels (Cloudflare RealtimeKit), with
  drag-and-drop reordering
- File attachments on channel messages, stored in Cloudflare R2 (images, video, audio,
  text previews, generic files)
- Custom per-server roles with a permission bitmask (view/send/manage channels,
  manage roles, manage server, kick/ban members, manage messages, administrator),
  including a non-deletable `@everyone` default role and role-hierarchy enforcement
- Everything is realtime via Convex's reactive `useQuery`/`usePaginatedQuery`

## Running it locally

```bash
bun install
bun run dev
```

This runs the Next.js dev server and `convex dev` in parallel, against the dev Convex
deployment already configured in `.env.local`.

## Auth setup (Clerk + Convex)

1. Create a Clerk app, then a JWT template named **`convex`** (Clerk dashboard → JWT
   Templates). Copy its **Issuer** URL.
2. Set `CLERK_JWT_ISSUER_DOMAIN` to that Issuer URL both in `.env.local` and on the
   Convex deployment: `npx convex env set CLERK_JWT_ISSUER_DOMAIN <issuer-url>`.
3. `convex/auth.config.ts` already reads this env var — no further code changes needed.

A production Clerk instance needs its own JWT template (same name), its own webhook
endpoint (below), and its own set of Convex env vars — set with `--prod` — since dev and
prod are entirely separate Clerk user pools and Convex deployments.

### Clerk → Convex user sync (webhook)

New/updated/deleted Clerk users are synced into the Convex `users` table via a webhook
at `convex/http.ts` (`POST /clerk-users-webhook`). To wire it up:

1. In the Clerk dashboard, go to **Webhooks** → **Add Endpoint**.
2. Set the URL to `${NEXT_PUBLIC_CONVEX_SITE_URL}/clerk-users-webhook` (the `.convex.site`
   URL, not `.convex.cloud` — see `npx convex env list [--prod]` for
   `NEXT_PUBLIC_CONVEX_SITE_URL`).
3. Subscribe to the `user.created`, `user.updated`, and `user.deleted` events.
4. Copy the **Signing Secret** and set it on the Convex deployment:
   `npx convex env set CLERK_WEBHOOK_SECRET <whsec_...> [--prod]`.

Note: even without the webhook configured, the app still works — `convex/users.ts`
lazily creates a user's Convex profile the first time they load `/app` or send a
message, as a race-safety fallback. The webhook just means a friend can find you by
username before you've ever opened the app.

## Attachments (Cloudflare R2)

Message attachments are uploaded straight from the browser to an R2 bucket through the
[`@convex-dev/r2`](https://www.convex.dev/components/cloudflare-r2) component
(`convex/attachments.ts`). Each Convex deployment points at its own bucket, and nothing
about the bucket or its domain lives in code — it's all deployment env vars, so any of it
can change later with a single `convex env set`.

1. Create a bucket per environment (`bunx wrangler r2 bucket create <name>`) and give it a
   CORS rule allowing `GET`, `PUT` and `HEAD` with the `Content-Type` header from the
   app's origins (`bunx wrangler r2 bucket cors set <name> --file cors.json`).
2. Create an R2 API token (R2 → **Manage R2 API Tokens**, Object Read & Write, scoped to
   the bucket(s)).
3. Set on the Convex deployment (`--prod` for production):

   ```bash
   npx convex env set R2_BUCKET <bucket-name>
   npx convex env set R2_ENDPOINT https://<account-id>.r2.cloudflarestorage.com
   npx convex env set R2_ACCESS_KEY_ID <access-key-id>
   npx convex env set R2_SECRET_ACCESS_KEY <secret-access-key>
   ```

4. Optional, recommended for prod: connect a custom domain to the bucket (R2 → bucket →
   **Settings** → Custom Domains) and set it as the bucket's public origin:

   ```bash
   npx convex env set R2_PUBLIC_URL https://<your-cdn-domain> --prod
   ```

   With `R2_PUBLIC_URL` set, files are viewed and downloaded through that domain as plain,
   cacheable URLs (object keys are random UUIDs). Without it, the app falls back to
   hourly presigned S3 URLs, which is fine for dev. To move the CDN to a new domain,
   connect the new domain to the bucket and update this one variable.

Limits (`convex/chatLimits.ts`): 10 MB per file, 10 files per message, 2000-character
messages; `html`/`svg`/`js` uploads are refused since the bucket is served publicly.

## Testing

Convex functions have unit tests (via `convex-test` + Vitest) covering permission
resolution, role hierarchy, friend requests, DMs, and invite edge cases:

```bash
bun run test
```

## Project structure

- `convex/schema.ts` — data model (users, friends, servers, roles, channels, messages, invites, DMs)
- `convex/permissions.ts` — permission bitmask constants + effective-permission resolution
- `convex/*.ts` — one file per domain (`users`, `friends`, `dms`, `servers`, `roles`,
  `categories`, `channels`, `messages`, `invites`), all with argument validators and
  identity-derived auth (never trust a client-supplied user id)
- `convex/http.ts` — Clerk webhook endpoint for user sync
- `app/app/**` — the authenticated app shell (server rail, friends/DMs, servers/channels)
- `app/invite/[code]` — public invite landing page
- `components/voice/rtk-meeting-view.tsx` — Cloudflare RealtimeKit UI Kit integration for
  voice channels

## Learn more

- [Convex docs](https://docs.convex.dev/)
- [Clerk docs](https://clerk.com/docs)
- [Next.js docs](https://nextjs.org/docs)
- [Cloudflare RealtimeKit docs](https://developers.cloudflare.com/realtime/realtimekit/)
