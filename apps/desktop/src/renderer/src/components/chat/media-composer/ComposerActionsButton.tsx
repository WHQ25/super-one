import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Clapperboard, ImagePlus, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { useMenuItems } from '@superone/client-kernel/react'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from '@superone/ui/components/ui/dropdown-menu'
import { useChatStore, type SessionWriteTarget } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { openMediaComposer } from './open-media-composer'

export function ComposerActionsButton({ target, onAttach }: { target: SessionWriteTarget | null; onAttach: () => void }) {
  const { t } = useTranslation()
  const session = useChatStore((s) =>
    target ? s.projectSessions[target.projectPath]?._sessions?.[target.sessionId] : undefined,
  )
  const provider = session
    ? resolveProvider({ sessionProvider: session.sessionProvider, preferredProvider: session.preferredProvider })
    : null
  const menuCtx = useMemo(
    () => ({
      menuId: 'composer.plusMenu',
      sessionId: target?.sessionId ?? null,
      projectPath: target?.projectPath ?? null,
      provider,
      supportsUiPlugins: provider ? HARNESS_CAPABILITIES[provider].supportsUiPlugins : false,
      hasFolder: Boolean(target?.projectPath),
      target,
    }),
    [target, provider],
  )
  const contributedItems = useMenuItems('composer.plusMenu', menuCtx)

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
      {contributedItems.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {contributedItems.map((item) => {
              const ItemIcon = item.icon
              return (
                <DropdownMenuItem key={item.id} disabled={item.disabled} onSelect={item.onSelect}>
                  {ItemIcon ? <ItemIcon /> : null}
                  {item.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
        </>
      )}
    </DropdownMenuContent>
  </DropdownMenu>
}
