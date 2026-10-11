import type { WebContents } from 'electron'
import { releaseComposerClient } from './composer-delivery'

const windows = new Set<number>()

/** A reload or closed window ends its caller forms and pending human answers. */
export function retainComposerWindow(sender: WebContents): void {
  if (windows.has(sender.id)) return
  windows.add(sender.id)
  const release = () => releaseComposerClient({ kind: 'window', id: sender.id })
  sender.on('did-navigate', release)
  sender.once('destroyed', () => { windows.delete(sender.id); release() })
}
