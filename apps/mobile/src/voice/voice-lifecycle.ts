/** iOS permission sheets produce inactive; only real background/lock ends capture. */
export function bindVoiceLifecycle(source: { addEventListener(type: 'change', listener: (state: string) => void): { remove(): void } }, stop: () => void): () => void {
  const listener = source.addEventListener('change', state => { if (state === 'background') stop() })
  return () => { listener.remove(); stop() }
}
