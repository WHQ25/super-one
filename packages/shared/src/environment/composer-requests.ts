import type { ComposerOpenRequest, ComposerOpenResult } from '../agent-types'
import type { SuperOneComposerOutcome } from '../composer-api'

/** Frontend forms are owned by the authenticated window/device, not a payload client id. */
export interface ComposerCallMethods {
  'composer.open': { input: ComposerOpenRequest; result: ComposerOpenResult }
  'composer.await': { input: { inputRequestId: string }; result: SuperOneComposerOutcome }
  'composer.cancel': { input: { viewId: string; localId?: string }; result: { ok: true } }
}
export type ComposerCallMethod = keyof ComposerCallMethods
export const COMPOSER_CALL_METHODS: ReadonlySet<string> = new Set(['composer.open', 'composer.await', 'composer.cancel'])
