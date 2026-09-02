import type { ChatMessage, TaskNotificationMeta } from '@superone/shared/agent-types'
import { BellRing, ChevronDown } from 'lucide-react'
import { Collapsible as CollapsiblePrimitive } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { formatCompactDuration } from './duration-format'

const STATUS_TONE: Record<TaskNotificationMeta['status'], string> = {
  completed: 'text-success',
  failed: 'text-error',
  stopped: 'text-warning',
}

export interface TaskNotificationItem {
  id: string
  meta: TaskNotificationMeta
}

export type TaskNotificationRenderEntry =
  | { type: 'message'; message: ChatMessage }
  | { type: 'task-notification-group'; items: TaskNotificationItem[] }

/** Preserve transcript order while folding only adjacent task notifications. */
export function groupConsecutiveTaskNotifications(
  messages: readonly ChatMessage[],
): TaskNotificationRenderEntry[] {
  const entries: TaskNotificationRenderEntry[] = []

  for (const message of messages) {
    const meta = message.metadata?.taskNotification
    const previous = entries[entries.length - 1]
    if (!meta) {
      entries.push({ type: 'message', message })
    } else if (previous?.type === 'task-notification-group') {
      previous.items.push({ id: message.id, meta })
    } else {
      entries.push({ type: 'task-notification-group', items: [{ id: message.id, meta }] })
    }
  }

  return entries
}

function groupStatus(items: readonly TaskNotificationItem[]): TaskNotificationMeta['status'] {
  if (items.some((item) => item.meta.status === 'failed')) return 'failed'
  if (items.some((item) => item.meta.status === 'stopped')) return 'stopped'
  return 'completed'
}

/**
 * Compact "the agent was woken by a background task" row.
 *
 * Minted when the launching tool block is gone or only lives in an earlier
 * turn (see `buildOrphanTaskNotificationMessage`). A still-visible current-turn
 * block already shows the same outcome. Right-aligned like the collaboration
 * mailbox wake: both are inputs that reached the agent without the user typing.
 */
export function TaskNotificationRow({ meta }: { meta: TaskNotificationMeta }) {
  const { t } = useTranslation()
  const label = t(`chat.taskNotification.${meta.status}`)
  const usage = meta.usage

  return (
    <div className="mb-0.5 flex w-0 min-w-full justify-end" data-task-notification={meta.status} role="note">
      <div className="flex max-w-[90%] min-w-0 items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          <BellRing className={cn('size-3 shrink-0', STATUS_TONE[meta.status])} aria-hidden />
          <span className="shrink-0">{label}</span>
          {meta.description && (
            <span className="truncate font-mono text-[0.95em] text-muted-foreground/80">{meta.description}</span>
          )}
          {usage && usage.durationMs > 0 && (
            <span className="shrink-0 text-muted-foreground/70">· {formatCompactDuration(usage.durationMs)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/** Collapsed summary for an adjacent run of transcript notifications. */
export function TaskNotificationGroup({ items }: { items: readonly TaskNotificationItem[] }) {
  const { t } = useTranslation()

  if (items.length === 1) return <TaskNotificationRow meta={items[0].meta} />

  const status = groupStatus(items)
  return (
    <CollapsiblePrimitive.Root
      className="flex w-0 min-w-full flex-col items-end"
      data-task-notification-group={items.length}
    >
      <CollapsiblePrimitive.Trigger asChild>
        <Button variant="ghost" size="xs" className="group max-w-[90%]">
          <BellRing className={STATUS_TONE[status]} data-icon="inline-start" aria-hidden />
          <span>{t('chat.taskNotification.group', { count: items.length })}</span>
          <ChevronDown
            className="transition-transform group-data-[state=open]:rotate-180"
            data-icon="inline-end"
            aria-hidden
          />
        </Button>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="w-full pt-0.5">
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <div key={item.id} data-message-id={item.id}>
              <TaskNotificationRow meta={item.meta} />
            </div>
          ))}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}
