import { useTranslation } from 'react-i18next'
import { ImagePlus, Video } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@superone/ui/components/ui/dropdown-menu'
import type { SessionWriteTarget } from '@/stores/chat'
import { openMediaComposer } from './open-media-composer'

export function MediaModeButton({ target }: { target: SessionWriteTarget | null }) {
  const { t } = useTranslation()
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><IconButton disabled={!target} tooltip={t('mediaComposer.mode')}><ImagePlus /></IconButton></DropdownMenuTrigger>
    <DropdownMenuContent align="start" onCloseAutoFocus={event => event.preventDefault()}>
      {(['image', 'video'] as const).map(kind => <DropdownMenuItem key={kind} onSelect={() => {
        if (target) void openMediaComposer(target, kind).catch(error => toast.error(String(error)))
      }}>
        {kind === 'image' ? <ImagePlus /> : <Video />}{t(`mediaComposer.${kind}`)}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
