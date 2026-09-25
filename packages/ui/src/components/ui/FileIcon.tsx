import { FileIcon as SymbolsFileIcon, FolderIcon as SymbolsFolderIcon } from '@react-symbols/icons/utils'
import { modelFileIconDataUri } from '@superone/shared/model-file-icon'

export function FileIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const modelIcon = modelFileIconDataUri(name)
  if (modelIcon) {
    return <img src={modelIcon} width={size} height={size} className={className ?? 'shrink-0'} alt="" aria-hidden="true" draggable={false} />
  }
  return <SymbolsFileIcon fileName={name} autoAssign width={size} height={size} className={className ?? 'shrink-0'} />
}

export function FolderIcon({ name, size = 16 }: { name: string; size?: number }) {
  return <SymbolsFolderIcon folderName={name} width={size} height={size} className="shrink-0" />
}
