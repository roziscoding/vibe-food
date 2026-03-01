import { webcrypto } from 'node:crypto'

const cryptoApi = globalThis.crypto ?? webcrypto

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: cryptoApi
  })
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    crypto: cryptoApi
  }
})

if (!globalThis.btoa) {
  Object.defineProperty(globalThis, 'btoa', {
    configurable: true,
    value: (value: string) => Buffer.from(value, 'binary').toString('base64')
  })
}

if (!globalThis.atob) {
  Object.defineProperty(globalThis, 'atob', {
    configurable: true,
    value: (value: string) => Buffer.from(value, 'base64').toString('binary')
  })
}
