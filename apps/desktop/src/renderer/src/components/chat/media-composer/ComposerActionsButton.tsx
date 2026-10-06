import { useTranslation } from 'react-i18next'
import { Clapperboard, ImagePlus, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@superone/ui/components/ui/dropdown-menu'
import type { SessionWriteTarget } from '@/stores/chat'
import { openMediaComposer } from './open-media-composer'

export function ComposerActionsButton({ target, onAttach }: { target: SessionWriteTarget | null; onAttach: () => void }) {
  const { t } = useTranslation()
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><IconButton aria-label={t('mediaComposer.mode')}><Paperclip /></IconButton></DropdownMenuTrigger>
    <DropdownMenuContent align="start" onCloseAutoFocus={event => event.preventDefault()}>
      <DropdownMenuGroup><DropdownMenuItem onSelect={onAttach}><Paperclip />{t('mediaComposer.attach')}</DropdownMenuItem></DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
      {(['image', 'video'] as const).map(kind => <DropdownMenuItem key={kind} disabled={!target} onSelect={() => {
        if (target) void openMediaComposer(target, kind).catch(error => toast.error(String(error)))
      }}>
        {kind === 'image' ? <ImagePlus /> : <Clapperboard />}{t(`mediaComposer.${kind}`)}
      </DropdownMenuItem>)}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
