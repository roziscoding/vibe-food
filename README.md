# Vibe Food

Vibe Food is a local-first meal tracker built with Nuxt 4, Nuxt UI, and TypeScript. The app runs as a client-side SPA, keeps its primary data in the browser, and can optionally replicate that data across devices through the built-in sync API.

## What the app does

- Track meals, calories, protein, carbs, and fat by day.
- Save reusable ingredients with per-unit nutrition values.
- Build meals manually or compose them from saved ingredients.
- Import meals from JSON or with AI-assisted ingredient matching.
- Import ingredients from nutrition label images with AI.
- Store calorie and macro goals locally.
- Sync `ingredients`, `meals`, `settings`, and `ai-integration` across devices.
- Install as a PWA for a mobile-friendly, offline-capable shell.

## Stack

- Nuxt 4 + Vue 3 + TypeScript
- Nuxt UI v4 + Tailwind CSS v4
- IndexedDB via `idb`
- RxDB with Dexie storage for syncable local data
- Nitro server routes for sync endpoints
- Vitest for sync protocol, E2EE, and error handling tests
- Vite PWA for installability and cached app assets

## Local development

```bash
pnpm install
pnpm dev
```

The Nuxt dev server runs on [http://localhost:3123](http://localhost:3123).

Useful commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

## Architecture summary

- `app/`: SPA pages, components, client-side data access, AI helpers, and sync orchestration.
- `shared/`: shared sync protocol types and normalization/comparison helpers used by both client and server.
- `server/`: Nitro API routes and storage helpers for sync vaults, replication, devices, keys, and pairing.
- `test/`: Vitest coverage for sync protocol ordering/tombstones, E2EE helpers, and sync error classification.

The app is intentionally local-first:

- User-facing data lives in the browser.
- The sync backend is a replication target, not the primary source of truth.
- The server only understands sync envelopes, vault metadata, device registration, and pairing.

## Important runtime notes

- `ssr: false` is set in [`nuxt.config.ts`](./nuxt.config.ts), so the app is fully client-rendered.
- Current sync server persistence uses Nitro `useStorage('data')`. For production, configure a persistent storage driver or synced data will only be as durable as the runtime storage backend.
- AI provider requests are sent directly from the browser to OpenAI or Anthropic.
- The current AI integration storage format (`version: 2`) stores the API key locally in IndexedDB in plain form. That is an implementation fact worth preserving or explicitly redesigning, not something to assume is encrypted.

## Project docs

- [docs/README.md](./docs/README.md): documentation index
- [docs/architecture.md](./docs/architecture.md): runtime boundaries, directory map, and data flow
- [docs/functionality.md](./docs/functionality.md): user-facing features and route behavior
- [docs/data-model.md](./docs/data-model.md): persisted records, storage keys, and local data model details
- [docs/sync.md](./docs/sync.md): sync architecture, endpoints, conflict resolution, and E2EE notes
- [docs/development.md](./docs/development.md): commands, runtime configuration, deployment notes, and change checklist
- [AGENTS.md](./AGENTS.md): repo guidance for coding agents and LLMs
