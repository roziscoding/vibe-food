# Development

## Prerequisites

- Node.js 22.x
- `pnpm` 10.x

The repository already pins the package manager in `package.json`.

## Commands

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

## Local runtime configuration

Relevant defaults from `nuxt.config.ts`:

- dev server port: `3123`
- SSR: disabled (`ssr: false`)
- PWA register type: `autoUpdate`
- PWA dev mode: disabled

UI defaults from `app/app.config.ts`:

- primary color: `green`
- neutral color: `slate`

## Testing scope

Current automated tests cover:

- sync protocol ordering and checkpoint logic
- tombstone normalization
- encrypted vault key wrap/unwrap helpers
- encrypted envelope round-tripping and tamper detection
- local sync error classification and retry messaging

Current automated tests do not deeply cover:

- page-level UI behavior
- full end-to-end sync flows
- browser IndexedDB migration behavior

## Docker

The included `Dockerfile`:

- builds on `node:22-alpine`
- installs dependencies with `pnpm`
- runs `pnpm build`
- serves `.output/server/index.mjs`
- exposes port `3000`

## Deployment considerations

### Sync storage persistence

The sync backend uses Nitro `useStorage('data')`. In production, ensure the target environment maps that to persistent storage if synced server state must survive container restarts or instance churn.

### Client-side only app

Because the app is an SPA:

- browser APIs are valid in many parts of the codebase
- SEO/server-render concerns are intentionally minimal
- features should be designed to degrade cleanly offline or without sync

### AI provider calls

AI requests are sent directly from the browser. That means:

- provider credentials are user-local, not server-side secrets
- browser/network constraints matter
- storage/security changes here should be treated as architecture changes, not cosmetic refactors

## Recommended change checklist

When making meaningful changes:

1. Update the closest repo-level docs in `docs/`.
2. Preserve the local-first storage model unless a redesign is explicitly intended.
3. If changing syncable records, update normalizers, RxDB shape handling, and sync tests together.
4. If changing sync transport behavior, update both `shared/utils/sync/protocol.ts` and the relevant client/server sync modules.
5. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
