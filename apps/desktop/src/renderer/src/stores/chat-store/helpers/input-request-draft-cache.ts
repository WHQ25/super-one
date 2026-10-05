import type { SchemaFormComposerDraft } from '@/components/schema-form/SchemaFormComposer'
import type { SessionWriteTarget } from '../types'
import { inputRequestErrorKey } from './input-request-errors'

export const inputRequestDraftCache = new Map<string, { owner: SessionWriteTarget; requestId: string; value: SchemaFormComposerDraft }>()
export function getInputRequestDraft(owner: SessionWriteTarget, requestId: string) {
  return inputRequestDraftCache.get(inputRequestErrorKey(owner, requestId))?.value
}
export function setInputRequestDraft(owner: SessionWriteTarget, requestId: string, value: SchemaFormComposerDraft) {
  inputRequestDraftCache.set(inputRequestErrorKey(owner, requestId), { owner, requestId, value })
}
