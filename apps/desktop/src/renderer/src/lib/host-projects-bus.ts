/**
 * Lightweight bus so sidebar / ChatSuggestions / ProjectSelector share one
 * refresh signal when remote project.list changes (add / remove).
 */

type Listener = () => void

const listeners = new Set<Listener>()

export function onHostProjectsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyHostProjectsChanged(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      /* ignore listener errors */
    }
  }
}
