import type { BrowserMemoryReadArgs, BrowserMemoryWriteArgs } from '@superone/shared/browser-memory'
import { InteractionMemoryStore } from './interaction-memory'

export { normalizeMemoryDomain } from './memory-target'

/** Compatibility facade: existing browser files and callers keep their contract. */
export class BrowserMemoryStore {
  private readonly store: InteractionMemoryStore
  constructor(root?: string) { this.store = new InteractionMemoryStore(root) }
  read(args: BrowserMemoryReadArgs) { return this.store.read('browser', args) }
  write(args: BrowserMemoryWriteArgs, signal?: AbortSignal) { return this.store.write('browser', args, signal) }
}
