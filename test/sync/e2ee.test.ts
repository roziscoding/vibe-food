import { describe, expect, it } from 'vitest'
import {
  createSyncVaultKeyRecord,
  decryptSyncTransportDocument,
  encryptSyncTransportDocument,
  unwrapSyncVaultKeyRecord
} from '../../app/utils/sync/e2ee'

describe('sync e2ee helpers', () => {
  it('wraps and unwraps the vault master key with PBKDF2 credentials', async () => {
    const { keyRecord, masterKey } = await createSyncVaultKeyRecord('correct horse battery staple')
    const unwrappedKey = await unwrapSyncVaultKeyRecord(keyRecord, 'correct horse battery staple')
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode('vibe-food-sync')
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv
      },
      masterKey,
      plaintext
    )

    const decrypted = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv
      },
      unwrappedKey,
      ciphertext
    )

    expect(new TextDecoder().decode(new Uint8Array(decrypted))).toBe('vibe-food-sync')
  })

  it('rejects an invalid sync passphrase', async () => {
    const { keyRecord } = await createSyncVaultKeyRecord('correct horse battery staple')

    await expect(unwrapSyncVaultKeyRecord(keyRecord, 'wrong passphrase')).rejects.toThrow('Invalid sync passphrase.')
  })

  it('round-trips an encrypted sync document envelope', async () => {
    const { keyRecord, masterKey } = await createSyncVaultKeyRecord('correct horse battery staple')
    const encrypted = await encryptSyncTransportDocument({
      document: {
        id: 'ingredient-1',
        name: 'Greek yogurt',
        updatedAt: '2026-03-01T10:00:00.000Z',
        deletedAt: null,
        lastModifiedByDeviceId: 'device-a',
        syncVersion: '2'
      },
      vaultId: 'vault-123',
      collectionName: 'ingredients',
      masterKey,
      keyVersion: keyRecord.keyVersion
    })
    const decrypted = await decryptSyncTransportDocument({
      document: encrypted,
      vaultId: 'vault-123',
      collectionName: 'ingredients',
      masterKey,
      expectedKeyVersion: keyRecord.keyVersion
    })

    expect(decrypted).toEqual({
      id: 'ingredient-1',
      name: 'Greek yogurt',
      updatedAt: '2026-03-01T10:00:00.000Z',
      deletedAt: null,
      lastModifiedByDeviceId: 'device-a',
      syncVersion: '2',
      _deleted: false
    })
  })

  it('fails to decrypt when the envelope metadata has been tampered with', async () => {
    const { keyRecord, masterKey } = await createSyncVaultKeyRecord('correct horse battery staple')
    const encrypted = await encryptSyncTransportDocument({
      document: {
        id: 'meal-1',
        title: 'Lunch',
        updatedAt: '2026-03-01T11:30:00.000Z',
        deletedAt: null,
        lastModifiedByDeviceId: 'device-a',
        syncVersion: '8'
      },
      vaultId: 'vault-123',
      collectionName: 'meals',
      masterKey,
      keyVersion: keyRecord.keyVersion
    })

    await expect(decryptSyncTransportDocument({
      document: {
        ...encrypted,
        syncVersion: '9'
      },
      vaultId: 'vault-123',
      collectionName: 'meals',
      masterKey,
      expectedKeyVersion: keyRecord.keyVersion
    })).rejects.toThrow('Could not decrypt an encrypted sync payload.')
  })
})
