import { BrowserListDownloadsViewPresenter } from '@superone/chat-view/presenters/BrowserListDownloadsView'
import type { BrowserDownloadListItem } from './browser-tool-display'
import { FileChip } from './ToolBlock'

function renderFile(item: BrowserDownloadListItem) {
  if (!item.path) return <span className="min-w-0 truncate font-medium text-foreground">{item.filename}</span>
  return (
    <FileChip
      name={item.filename}
      title={item.path}
      filePath={item.path}
      className="max-w-45"
    />
  )
}

async function saveFile(path: string, filename: string): Promise<'saved' | 'cancelled' | 'error'> {
  const result = await window.app.saveFileAs(path, filename)
  if (result.ok) return 'saved'
  return result.canceled ? 'cancelled' : 'error'
}

export function BrowserListDownloadsView({ result }: { result: string }) {
  return (
    <BrowserListDownloadsViewPresenter
      result={result}
      renderFile={renderFile}
      onSaveFile={saveFile}
    />
  )
}
