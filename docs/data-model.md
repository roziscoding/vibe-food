# Data Model

## Storage layers

Vibe Food currently uses several browser-side storage areas.

### 1. Legacy IndexedDB store

File: `app/utils/client-db.ts`

- Database name: `vibe-food`
- Object store: `collections`

This is the older generic key/value store. It still exists because `client-db.ts` reads from it during the phase-0 migration to RxDB-backed syncable storage.

### 2. RxDB phase-0 store

File: `app/utils/db/rxdb-phase0.ts`

- Database name: `vibe-food-rxdb`
- Storage engine: RxDB Dexie storage

Collections:

- `ingredients`
- `meals`
- `settings`
- `ai-integration`
- `sync_meta`
- `sync_conflicts`

The first four are syncable. The last two are local operational collections.

### 3. Session storage

File: `app/utils/meal-import-editor-draft.ts`

Used for transient meal import editor drafts under the key:

- `vibe-food:meal-import-editor-draft`

### 4. Local sync state stored via client DB

Files:

- `app/utils/sync/local-sync.ts`
- `app/utils/sync/credentials.ts`

Keys:

- `sync-local-state-v1`
- `sync-vault-credentials-v1`
- `sync-vault-passphrase-v1`

## Domain records

## Ingredient record

Source: `app/utils/db/repos/ingredients.ts`

Fields:

- `id`: local primary identifier
- `uuid`: stable UUID used for portability/matching
- `name`
- `unit`
- `portionSize`
- `kcal`
- `protein`
- `carbs`
- `fat`
- `kcalPerUnit`
- `proteinPerUnit`
- `carbsPerUnit`
- `fatPerUnit`
- `createdAt`

Notes:

- records are normalized on read
- per-unit values are derived if missing
- invalid or negative nutrition values are rejected by the normalizer

## Meal record

Source: `app/utils/db/repos/meals.ts`

Fields:

- `id`
- `name`
- `calories`
- `protein`
- `carbs`
- `fat`
- `ingredients`: array of `{ name, amount, unit }` snapshots
- `createdAt`

Notes:

- meals persist ingredient snapshots, not live ingredient references
- this preserves historical meal content even if an ingredient changes later

## App settings

Source: `app/utils/db/repos/settings.ts`

Fields:

- `dailyCalorieGoal`
- `proteinGoal`
- `carbsGoal`
- `fatGoal`

Defaults:

- calories: `2000`
- protein: `150`
- carbs: `250`
- fat: `70`

## AI integration

Source: `app/utils/client-ai-integration.ts`

Current record format:

- version `2`
- `provider`
- `apiKey`
- `updatedAt`

Legacy format:

- version `1`
- encrypted API key metadata derived from a 4-digit PIN

Notes:

- reading metadata exposes `provider`, masked key preview, timestamp, and whether the record is plain or legacy-encrypted
- unlocking a legacy record migrates it into the plain v2 format
- current implementation stores the v2 API key locally in plain form in IndexedDB

## Syncable document model

RxDB syncable records carry sync metadata in addition to their product fields.

Metadata fields:

- `id`
- `updatedAt`
- `deletedAt`
- `lastModifiedByDeviceId`
- `syncVersion`

Deletion behavior:

- deleted records become tombstones
- `_deleted: true` is normalized into a deleted document
- `deletedAt` is preserved so deletions replicate

Singleton syncable documents:

- `settings` uses document ID `app-settings`
- `ai-integration` uses document ID `ai-integration`

## Operational local records

### Sync meta

Used internally for:

- migration completion
- local device ID
- skip-legacy-value-import flags

### Sync conflicts

Fields:

- `id`
- `collectionName`
- `documentId`
- `reason`
- `createdAt`

These are local diagnostic records created when sync detects a conflict worth surfacing.

## Server-side sync persistence

The server stores sync state under Nitro `useStorage('data')`.

Stored concepts include:

- sync vault metadata
- hashed vault tokens
- device records
- per-collection document payloads
- wrapped vault keys for E2EE
- pairing requests and pairing code indexes

The server store is sync infrastructure, not the product's primary database.
