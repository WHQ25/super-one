/** Background is not an interruption; only final service disposal ends the call. */
export function bindVoiceLifecycle(source: { addEventListener(type: 'change', listener: (state: string) => void): { remove(): void } }, background: () => void, dispose = background): () => void {
  const listener = source.addEventListener('change', state => { if (state === 'background') background() })
  return () => { listener.remove(); dispose() }
}
