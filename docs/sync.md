# Sync

## Overview

Vibe Food can replicate local data between devices through a vault-based sync API.

Replicated collections:

- `ingredients`
- `meals`
- `settings`
- `ai-integration`

The client remains local-first. Sync moves already-owned local records between devices rather than turning the server into the primary datastore.

## Main pieces

### Client orchestration

Files in `app/utils/sync/`:

- `local-sync.ts`: lifecycle, status, retry policy, persisted local sync state
- `credentials.ts`: vault creation, credential storage, device registration, delete-cloud action
- `replication.ts`: RxDB replication wiring for all syncable collections
- `e2ee.ts`: key wrapping and document encryption/decryption
- `pairing.ts`: linking flows by pairing request, code, or QR-assisted route handoff
- `errors.ts`: sync HTTP error mapping and retry classification

### Shared protocol

`shared/utils/sync/protocol.ts` defines:

- collection names
- transport modes
- HTTP payload types
- normalization
- checkpoint ordering
- tombstone behavior
- payload equivalence helpers
- last-write-wins comparison

### Server

Files in `server/api/sync/v1/` and `server/utils/sync/` expose and persist:

- vaults
- devices
- replication pull/push
- encrypted key records
- pairing requests

## Transport modes

### `plaintext-dev`

- plain sync payloads
- only allowed for vault creation during development
- useful for local bootstrap and debugging

### `e2ee-v1`

- encrypted document envelopes
- default production-safe mode
- server stores encrypted payloads and wrapped master keys, not plaintext documents

## Client lifecycle

`app/app.vue` starts the local sync orchestrator on mount.

The orchestrator:

1. hydrates locally persisted sync state
2. ensures a local device ID exists
3. registers `online`, `offline`, and `visibilitychange` listeners
4. runs sync if enabled and not paused

Sync can be triggered by:

- startup
- manual user action
- browser coming back online
- tab visibility returning
- scheduled retry after failure

## Replication behavior

Replication is implemented with RxDB live replication.

Current settings:

- pull batch size: `50`
- push batch size: `25`
- one replication state per syncable collection

For encrypted vaults:

- outgoing documents are encrypted before push
- incoming encrypted envelopes are decrypted after pull
- the passphrase never leaves the browser

## Conflict resolution

The server uses last-write-wins ordering based on this tuple:

1. `updatedAt`
2. `lastModifiedByDeviceId`
3. `syncVersion`
4. `id`

Important behaviors:

- if the incoming document matches the current server document, nothing changes
- if the client provided `assumedMasterState` and it still matches the server document, the push is accepted
- otherwise the server compares incoming vs current and keeps the winner
- when the remote version wins during a push conflict, the client logs a local conflict entry

## Retry behavior

Retry scheduling is handled in `local-sync.ts`.

Backoff steps:

- 5 seconds
- 15 seconds
- 30 seconds
- 60 seconds
- 120 seconds

Transient failures are retried. Non-retryable auth/configuration failures are surfaced without continued retry looping.

## Pairing and device linking

Encrypted vaults support device linking.

High-level flow:

1. a requester device creates a pairing request and receives a pairing ID, secret, and short code
2. an already-authenticated device authorizes or approves that pairing request for its vault
3. the requester polls pairing status and receives vault credentials when approved
4. the requester stores credentials locally and starts sync against the existing vault

Pairing artifacts are time-limited. Current TTL is 10 minutes.

## E2EE details

Implemented in `app/utils/sync/e2ee.ts`.

- document encryption: AES-GCM
- envelope version: `1`
- algorithm label: `A256GCM`
- key derivation: PBKDF2 with SHA-256
- wrapping iterations: `310000`
- master key length: `256` bits

The vault key record stores:

- wrapped master key
- wrapping IV
- salt
- KDF metadata
- key version
- update timestamp

Additional authenticated data binds encrypted payloads to:

- vault ID
- collection name
- document metadata
- schema version

That means metadata tampering breaks decryption.

## HTTP surface

All sync routes live under `/api/sync/v1`.

### Vaults

- `POST /vaults`: create a sync vault
- `GET /vaults/:vaultId`: read authenticated vault metadata
- `DELETE /vaults/:vaultId`: delete the vault and its synced server copy

### Devices

- `POST /devices`: register or refresh a device
- `GET /devices`: list devices for the authenticated vault

### Keys

- `GET /keys`: fetch wrapped E2EE key metadata
- `PUT /keys`: store wrapped E2EE key metadata

### Replication

- `POST /replication/:collection/pull`
- `POST /replication/:collection/push`

### Pairing

- `POST /pairing/requests`
- `GET /pairing/requests/:pairingId`
- `POST /pairing/requests/:pairingId/approve`
- `POST /pairing/authorize`

## Auth model

Authenticated sync routes require:

- `Authorization: Bearer <vaultToken>`
- `x-sync-vault-id: <vaultId>`
- optional `x-sync-device-id: <deviceId>`

On the server:

- vault tokens are stored as SHA-256 hashes
- pairing secrets are stored as SHA-256 hashes

## Deployment note

Server sync state is stored through Nitro `useStorage('data')`. Production durability depends on configuring that storage backend to something persistent.
