import { Terminal, FileText, FileEdit, FilePlus, Search, FolderSearch, Globe, MessageCircleQuestion, Wrench } from 'lucide-react'
import type { ToolIcon as ToolIconName } from './tool-display'

const iconComponents: Record<ToolIconName, React.FC<{ className?: string }>> = {
  'terminal': Terminal,
  'file-text': FileText,
  'file-edit': FileEdit,
  'file-plus': FilePlus,
  'search': Search,
  'folder-search': FolderSearch,
  'globe': Globe,
  'message-circle': MessageCircleQuestion,
  'wrench': Wrench,
}

interface ToolIconProps {
  icon: ToolIconName
  className?: string
}

export function ToolIcon({ icon, className }: ToolIconProps) {
  const Icon = iconComponents[icon]
  return <Icon className={className} />
}
