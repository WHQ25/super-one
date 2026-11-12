import { PenLine, ShipWheel } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatMessage } from '@superone/shared/agent-types'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { requestNative } from './bridge'
import { PortableMessage } from './PortableMessage'
import type { QueuedMessageAction } from './protocol'

export function PortableQueuedMessages({ messages, steer, scheme, mentionArtwork, projectPath }: {
  messages: ChatMessage[]
  steer: boolean
  scheme: 'light' | 'dark'
  mentionArtwork: Record<string, string>
  projectPath: string | null
}) {
  const { t } = useTranslation()
  const act = (messageId: string, action: QueuedMessageAction) => { requestNative('queuedMessageAction', { messageId, action }) }
  return messages.map((message) => (
    <div key={message.id} data-queued-message={message.id}>
      <div className="opacity-50">
        <PortableMessage message={message} scheme={scheme} pendingPermission={null}
          mentionArtwork={mentionArtwork} projectPath={projectPath} hideCopyActions />
      </div>
      <div className="-mt-0.5 flex items-center justify-end gap-1 pr-1">
        {steer && (
          <IconButton size="md" variant="nested" tooltip={t('chat.queuedActions.steer')} onClick={() => act(message.id, 'steer')}>
            <ShipWheel />
          </IconButton>
        )}
        <IconButton size="md" variant="nested" tooltip={t('chat.queuedActions.edit')} onClick={() => act(message.id, 'edit')}>
          <PenLine />
        </IconButton>
      </div>
    </div>
  ))
}
