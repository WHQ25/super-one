import type { ConsumerBinding, Platform } from '@superone/shared/platform-registry'
import type { ProvidersPort } from '@superone/runtime/server'
import { unsupportedMethodError } from '@superone/runtime/server'

/** This desktop's credential store, as its provider settings read it (credentials masked). */
export interface DesktopProviderReads {
  listCredentials(): unknown
  listCustomPlatforms(): Platform[]
  listBindings(): ConsumerBinding[]
}

/**
 * The `provider.*` reads every client of this desktop gets: masked
 * credentials, custom platforms and bindings, which a composer's API provider
 * picker needs. Key material never leaves this desktop.
 */
export function createDesktopProvidersPort(store: DesktopProviderReads): ProvidersPort {
  const unsupported = (method: string) => (): never => {
    throw unsupportedMethodError(method)
  }
  return {
    servedMethods: new Set(['provider.listCredentials', 'provider.listCustomPlatforms', 'provider.listBindings']),
    listCredentials: () => store.listCredentials(),
    listCustomPlatforms: () => store.listCustomPlatforms(),
    listBindings: () => store.listBindings(),
    getCredentialDecrypted: unsupported('provider.getCredentialDecrypted'),
    createCredential: unsupported('provider.createCredential'),
    updateCredential: unsupported('provider.updateCredential'),
    deleteCredential: unsupported('provider.deleteCredential'),
    setBinding: unsupported('provider.setBinding'),
    clearBinding: unsupported('provider.clearBinding'),
    upsertCustomPlatform: unsupported('provider.upsertCustomPlatform'),
    deleteCustomPlatform: unsupported('provider.deleteCustomPlatform'),
    exportBundle: unsupported('provider.exportBundle'),
    importBundle: unsupported('provider.importBundle'),
  }
}
