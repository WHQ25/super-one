import { FileIcon as SymbolsFileIcon } from '@react-symbols/icons/utils'

export function FileIcon({ name, size = 16 }: { name: string; size?: number }) {
  return <SymbolsFileIcon fileName={name} autoAssign width={size} height={size} className="shrink-0" />
}
