/** Each expansion owns an independent stream, so late replies cannot reopen it. */
export type DetailUpdate = { subscriptionId: string; revision: number; offset: number; text: string }
const listeners = new Map<string, (update: DetailUpdate) => void>()
export function deliverDetail(update: DetailUpdate): void { listeners.get(update.subscriptionId)?.(update) }
export function listenDetail(id: string, listener: (update: DetailUpdate) => void): () => void {
  listeners.set(id, listener)
  return () => { listeners.delete(id) }
}
export function applyDetailUpdate(text: string, update: DetailUpdate): string {
  if (update.offset > text.length) throw new Error('Detail stream interrupted. Please reopen it.')
  return text.slice(0, update.offset) + update.text
}
