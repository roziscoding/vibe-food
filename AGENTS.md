# AGENTS.md

This file is for coding agents and other LLM-powered contributors working in this repository.

## Start here

Read this file first. Do not read the whole `docs/` folder by default.

Use the index below to pick only the documents that match the task.

## Documentation index

- [README.md](./README.md): top-level product overview, stack, local setup, architecture summary, and major runtime caveats.
- [docs/README.md](./docs/README.md): short docs folder index.
- [docs/architecture.md](./docs/architecture.md): runtime boundaries, directory responsibilities, route layout, and end-to-end data flow.
- [docs/functionality.md](./docs/functionality.md): user-facing behavior by route, including meals, ingredients, settings, imports, and AI flows.
- [docs/data-model.md](./docs/data-model.md): local storage layers, record shapes, storage keys, syncable collections, and operational local records.
- [docs/sync.md](./docs/sync.md): sync lifecycle, transport modes, replication rules, conflict handling, API endpoints, pairing, and E2EE behavior.
- [docs/development.md](./docs/development.md): commands, local runtime defaults, test coverage, Docker behavior, deployment notes, and change checklist.

## Skills index

- `nuxt-ui` skill: use this when building or changing UI with `@nuxt/ui` v4, especially component composition, theming, forms, dashboards, and layout work. Skill file: `./.agents/skills/nuxt-ui/SKILL.md`.

## What to read for common tasks

- UI or route change:
  Read [docs/functionality.md](./docs/functionality.md) and [docs/architecture.md](./docs/architecture.md). If the work touches `@nuxt/ui` components, theming, forms, or layout composition, use the `nuxt-ui` skill.
- Local persistence or schema change:
  Read [docs/data-model.md](./docs/data-model.md), then inspect `app/utils/db/repos/`, `app/utils/client-db.ts`, and `app/utils/db/rxdb-phase0.ts`.
- Sync, replication, or pairing change:
  Read [docs/sync.md](./docs/sync.md) and [docs/architecture.md](./docs/architecture.md), then inspect `app/utils/sync/`, `shared/utils/sync/protocol.ts`, and `server/api/sync/v1/`.
- AI integration or import flow change:
  Read [docs/functionality.md](./docs/functionality.md) and [docs/data-model.md](./docs/data-model.md), then inspect `app/utils/client-ai-integration.ts`, `app/utils/ai-meal-import.ts`, and `app/utils/ai-ingredient-import.ts`.
- Deployment, runtime, or operational change:
  Read [README.md](./README.md) and [docs/development.md](./docs/development.md), then inspect `nuxt.config.ts` and `Dockerfile`.

## Minimal reading order

For most non-trivial work, this is enough:

- [README.md](./README.md)
- one task-specific doc from the index above
- the relevant code area from the repo map below

Only read additional docs when the task crosses subsystem boundaries.

## System intent

Vibe Food is a local-first meal tracker.

- The browser owns the product state.
- Sync is optional replication, not the canonical write path.
- The server is deliberately thin and does not implement meal or ingredient business logic.
- The app is a client-rendered Nuxt SPA. Do not introduce SSR assumptions unless the product direction changes explicitly.

## Repo map

- `app/pages/`: UI routes (`/`, `/meals`, `/meals/:id`, `/ingredients`, `/settings`)
- `app/components/`: shared Vue UI components
- `app/utils/db/repos/`: normalized read/write access for domain records
- `app/utils/client-db.ts`: bridge from old IndexedDB storage to RxDB-backed syncable storage
- `app/utils/db/rxdb-phase0.ts`: RxDB collections, migration, local device ID, and sync conflict storage
- `app/utils/sync/`: local sync orchestration, credentials, replication, E2EE, pairing, and error handling
- `app/utils/client-ai-integration.ts`: local AI provider configuration storage and legacy unlock/migration logic
- `shared/utils/sync/protocol.ts`: shared types, normalizers, tombstone handling, checkpoint ordering, and LWW comparison
- `server/api/sync/v1/`: sync HTTP endpoints
- `server/utils/sync/`: auth helpers and Nitro storage-backed sync persistence
- `test/sync/`: tests for shared sync semantics and crypto helpers

## Core invariants

- `nuxt.config.ts` sets `ssr: false`. Prefer browser-safe code paths and explicit `window` guards where needed.
- Persisted app data should go through the repo helpers in `app/utils/db/repos/` or the dedicated client storage helpers, not ad hoc `localStorage` writes.
- Syncable datasets are exactly:
  - `ingredients`
  - `meals`
  - `settings`
  - `ai-integration`
- Sync documents rely on metadata fields such as `updatedAt`, `deletedAt`, `lastModifiedByDeviceId`, and `syncVersion`. Do not strip or repurpose them.
- Tombstones are represented through `_deleted` and/or `deletedAt`. Deletions must remain replicable.
- Conflict resolution is last-write-wins using the tuple:
  - `updatedAt`
  - `lastModifiedByDeviceId`
  - `syncVersion`
  - `id`
- `plaintext-dev` sync is development-only. Production behavior should assume `e2ee-v1`.
- In E2EE mode, the server stores encrypted envelopes and wrapped master keys. It should not learn the passphrase or decrypted payloads.
- AI provider calls currently happen directly from the browser. The current `ai-integration` v2 format stores the API key locally in plain form in IndexedDB. If you change that model, update docs and migration behavior together.

## When changing persisted shapes

If you add or change fields on meals, ingredients, settings, or AI integration, update the relevant set together:

- Repo normalizers in `app/utils/db/repos/`
- RxDB schemas and migration behavior in `app/utils/db/rxdb-phase0.ts`
- Shared sync validation in `shared/utils/sync/protocol.ts` if transport shape changes
- Any UI forms/editors that create or edit the record
- Sync/E2EE tests under `test/sync/` when behavior changes materially
- Documentation in `README.md` and `docs/`

## When changing sync

Touch these files intentionally:

- Client orchestration: `app/utils/sync/local-sync.ts`
- Client replication: `app/utils/sync/replication.ts`
- Client crypto: `app/utils/sync/e2ee.ts`
- Shared protocol: `shared/utils/sync/protocol.ts`
- Server endpoints: `server/api/sync/v1/*`
- Server persistence: `server/utils/sync/storage.ts`

Keep these behaviors stable unless the change explicitly redesigns them:

- Pull batch size defaults to 50; push batch size defaults to 25.
- Retry backoff is bounded and managed by the local orchestrator.
- Device pairing is only available for encrypted vaults.
- Authenticated sync requests require vault ID header + bearer vault token.

## Route-specific notes

- `app/pages/meals/index.vue` is the meal list and entry surface.
- `app/pages/meals/[id].vue` multiplexes three modes:
  - `new`
  - `import`
  - existing meal edit by ID
- `app/pages/settings.vue` is the operational hub for goals, AI integration, sync bootstrap, pairing, diagnostics, and destructive actions. It is large; avoid making it larger without a good reason.

## Validation

Run the relevant checks after meaningful changes:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

For deployment-affecting changes, also confirm:

- the app still builds with `pnpm build`
- the sync server still has a persistent Nitro storage strategy in the target environment

## Documentation rule

If you change user-visible behavior, storage format, sync semantics, or operational setup, update the matching files in `docs/` in the same change.

When adding a new doc, add it to the index in this file with a one-line description so future agents can find it quickly.
