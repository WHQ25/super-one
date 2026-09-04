import * as SecureStore from 'expo-secure-store'
import { createMMKV, type MMKV } from 'react-native-mmkv'
import { MOBILE_ID_KEY, type Kv } from '@superone/relay-client'
import { randomId } from './ids'
import { MMKV_KEY_ALIAS } from './storage-config'

const MMKV_ID = 'superone.mobile'

let storagePromise: Promise<MMKV> | null = null
let mobileIdPromise: Promise<string> | null = null

async function openStorage(): Promise<MMKV> {
  let encryptionKey = await SecureStore.getItemAsync(MMKV_KEY_ALIAS)
  if (!encryptionKey) {
    encryptionKey = `${randomId()}${randomId()}`.replaceAll('-', '').slice(0, 32)
    await SecureStore.setItemAsync(MMKV_KEY_ALIAS, encryptionKey)
  }
  return createMMKV({ id: MMKV_ID, encryptionKey, encryptionType: 'AES-256' })
}

function storage(): Promise<MMKV> {
  storagePromise ??= openStorage()
  return storagePromise
}

/** Async facade expected by relay-client, backed by encrypted native MMKV. */
export const mobileKv: Kv = {
  async get(key) {
    return (await storage()).getString(key) ?? null
  },
  async set(key, value) {
    (await storage()).set(key, value)
  },
}

async function readOrCreateMobileId(): Promise<string> {
  const existing = await mobileKv.get(MOBILE_ID_KEY)
  if (existing) return existing
  const id = randomId()
  await mobileKv.set(MOBILE_ID_KEY, id)
  return id
}

export function loadOrCreateMobileId(): Promise<string> {
  mobileIdPromise ??= readOrCreateMobileId().catch((error) => {
    mobileIdPromise = null
    throw error
  })
  return mobileIdPromise
}
