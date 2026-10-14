import type { ConsumerBinding, ConsumerId, Platform, ProviderBundle } from '@superone/shared/platform-registry'
import type { ProvidersPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'
import type { CreateCredentialInput, UpdateCredentialInput } from '../providers/credential-store'

/** This desktop's credential store (`providers/credential-store.ts`); its reads mask secrets. */
export interface DesktopProviderStore {
  listCredentials(): unknown
  listCustomPlatforms(): Platform[]
  listBindings(): ConsumerBinding[]
  createCredential(input: CreateCredentialInput): unknown
  updateCredential(id: string, patch: UpdateCredentialInput): unknown
  deleteCredential(id: string): boolean
  setBinding(binding: ConsumerBinding): void
  deleteBinding(consumer: ConsumerId): void
  upsertCustomPlatform(def: Platform): Platform
  deleteCustomPlatform(id: string): boolean
  importBundle(bundle: Partial<ProviderBundle>, opts?: { replaceAll?: boolean }): { credentials: number; bindings: number }
}

/** What a provider write makes this desktop redo, as its window's own writes do. */
export interface DesktopProviderChanges {
  /** A credential or platform changed: either harness may now resolve differently. */
  providerConfigChanged(): void
  providerBindingChanged(consumer: ConsumerId): void
}

/**
 * The `provider.*` family every client of this desktop gets: masked reads and
 * the writes its window offers, including a pushed bundle. Key material never
 * leaves this desktop, so decrypted reads and bundle export stay unserved.
 */
export function createDesktopProvidersPort(store: DesktopProviderStore, changes: DesktopProviderChanges): ProvidersPort {
  const unsupported = (method: string) => (): never => {
    throw unsupportedMethodError(method)
  }
  return {
    servedMethods: new Set([
      'provider.listCredentials', 'provider.listCustomPlatforms', 'provider.listBindings',
      'provider.createCredential', 'provider.updateCredential', 'provider.deleteCredential',
      'provider.setBinding', 'provider.clearBinding', 'provider.upsertCustomPlatform', 'provider.deleteCustomPlatform',
      'provider.importBundle',
    ]),
    listCredentials: () => store.listCredentials(),
    listCustomPlatforms: () => store.listCustomPlatforms(),
    listBindings: () => store.listBindings(),
    createCredential: (input) => store.createCredential(input as CreateCredentialInput),
    updateCredential: (id, patch) => {
      const updated = store.updateCredential(id, patch as UpdateCredentialInput)
      if (updated) changes.providerConfigChanged()
      return updated
    },
    deleteCredential: (id) => {
      const ok = store.deleteCredential(id)
      changes.providerConfigChanged()
      return ok
    },
    setBinding: (binding) => {
      store.setBinding(binding)
      changes.providerBindingChanged(binding.consumer)
    },
    clearBinding: (consumer) => {
      store.deleteBinding(consumer)
      changes.providerBindingChanged(consumer)
    },
    upsertCustomPlatform: (def) => store.upsertCustomPlatform(def),
    deleteCustomPlatform: (id) => {
      const ok = store.deleteCustomPlatform(id)
      changes.providerConfigChanged()
      return ok
    },
    importBundle: (bundle, opts) => {
      const result = store.importBundle(bundle as Partial<ProviderBundle>, opts)
      changes.providerConfigChanged()
      return result
    },
    getCredentialDecrypted: unsupported('provider.getCredentialDecrypted'),
    exportBundle: unsupported('provider.exportBundle'),
  }
}
