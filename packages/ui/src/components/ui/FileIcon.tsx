import { FileIcon as SymbolsFileIcon, FolderIcon as SymbolsFolderIcon } from '@react-symbols/icons/utils'

export function FileIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  return <SymbolsFileIcon fileName={name} autoAssign width={size} height={size} className={className ?? 'shrink-0'} />
}

export function FolderIcon({ name, size = 16 }: { name: string; size?: number }) {
  return <SymbolsFolderIcon folderName={name} width={size} height={size} className="shrink-0" />
}
