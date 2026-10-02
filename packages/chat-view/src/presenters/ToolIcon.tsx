import { Terminal, FileText, FileEdit, FilePlus, Search, FolderSearch, Globe, Download, MessageCircleQuestion, Wrench, Plug, ClipboardList, Bot, BookOpen, Paintbrush, Toolbox, Package, Pencil, Image as ImageIcon, Smartphone } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { McpIcon } from '@superone/ui/components/ui/McpIcon'
import { McpAppIcon } from '@superone/ui/components/ui/mcp-app-icon'
import type { ToolIcon as ToolIconName } from './tool-display'

const iconComponents: Record<ToolIconName, React.FC<{ className?: string }>> = {
  'terminal': Terminal,
  'file-text': FileText,
  'file-edit': FileEdit,
  'file-plus': FilePlus,
  'search': Search,
  'folder-search': FolderSearch,
  'globe': Globe,
  'download': Download,
  'message-circle': MessageCircleQuestion,
  'wrench': Wrench,
  // MCP tools whose server has no icon of its own.
  'mcp': McpIcon,
  // Mini-app tool blocks whose app has no icon.
  'plug': Plug,
  'clipboard-list': ClipboardList,
  'bot': Bot,
  'book-open': BookOpen,
  'canvas': Paintbrush,
  'toolbox': Toolbox,
  'package': Package,
  'pencil': Pencil,
  'image': ImageIcon,
  'smartphone': Smartphone,
}

interface ToolIconProps {
  icon: ToolIconName
  className?: string
}

export function ToolIcon({ icon, className }: ToolIconProps) {
  const Icon = iconComponents[icon]
  return <Icon className={className} />
}

/** A tool's icon as its row draws it: the MCP server's brand icon when one resolved, else the tool's own. */
/** A brand icon in the glyph's colour, so one-colour server icons stay legible in either theme. */
export function ToolBrandIcon({ src, alt, icon, className }: { src?: string; alt: string; icon: ToolIconName; className?: string }) {
  const glyph = <ToolIcon icon={icon} className={cn('size-3 shrink-0 text-muted-foreground', className)} />
  return <McpAppIcon src={src} alt={alt} className={cn('size-3.5 shrink-0 text-muted-foreground', className)} fallback={glyph} />
}
