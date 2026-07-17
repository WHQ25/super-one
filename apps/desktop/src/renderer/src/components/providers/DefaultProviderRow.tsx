import { useEffect, useMemo, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { findPlatform, type ConsumerId, type Credential } from '@superone/shared/platform-registry'
import { Badge } from '@superone/ui/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { useSettingsStore } from '@/stores/settings'
import { credentialsForConsumer } from '@/lib/provider-resolve'
import { ProviderLabel } from '@/components/ProviderLabel'

export function ProviderOptionLabel({ brandKey, name, keyName }: { brandKey: string; name?: string; keyName?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 [&_svg]:!size-auto">
      <span className="flex min-w-0 shrink items-center">
        <ProviderLabel brandKey={brandKey} fallback={name} combine size={20} />
      </span>
      {keyName && <Badge variant="secondary" className="min-w-0 truncate font-normal">{keyName}</Badge>}
    </span>
  )
}

/**
 * Global default-provider selector for a resolvable consumer, backed by the `consumer_bindings` table.
 * `fallback` renders the cleared state (chat harnesses show their official brand; media shows an
 * "auto / first usable" hint).
 */
export function DefaultProviderRow({
  consumer,
  title,
  description,
  fallback,
}: {
  consumer: ConsumerId
  title: string
  description: string
  fallback: ReactNode
}) {
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const setBinding = useSettingsStore((s) => s.setBinding)
  const clearBinding = useSettingsStore((s) => s.clearBinding)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)

  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData])

  const candidates = useMemo(
    () => credentialsForConsumer(platforms, credentials, consumer),
    [platforms, credentials, consumer],
  )
  const groups = useMemo(() => {
    const byPlatform = new Map<string, Credential[]>()
    for (const c of candidates) {
      const list = byPlatform.get(c.platformId) ?? []
      list.push(c)
      byPlatform.set(c.platformId, list)
    }
    return [...byPlatform.values()]
  }, [candidates])
  const currentId = bindings.find((b) => b.consumer === consumer)?.credentialId ?? ''
  const current = candidates.find((c) => c.id === currentId)
  const brandFor = (c: Credential): string => findPlatform(platforms, c.platformId)?.brand ?? 'custom'
  const nameFor = (c: Credential): string | undefined => findPlatform(platforms, c.platformId)?.name

  return (
    <div className="flex items-center justify-between gap-4 border-b border-border p-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex max-w-64 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted">
            {current ? <ProviderOptionLabel brandKey={brandFor(current)} name={nameFor(current)} keyName={current.name} /> : fallback}
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onClick={() => void clearBinding(consumer)} className="flex items-center justify-between gap-2">
            {fallback}
            {!currentId && <Check className="size-4 shrink-0 text-muted-foreground" />}
          </DropdownMenuItem>
          {groups.map((group) => {
            if (group.length === 1) {
              const c = group[0]
              return (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => void setBinding({ consumer, credentialId: c.id })}
                  className="flex items-center justify-between gap-2"
                >
                  <ProviderOptionLabel brandKey={brandFor(c)} name={nameFor(c)} />
                  {currentId === c.id && <Check className="size-4 shrink-0 text-muted-foreground" />}
                </DropdownMenuItem>
              )
            }
            const groupHasCurrent = group.some((c) => c.id === currentId)
            return (
              <DropdownMenuSub key={group[0].platformId}>
                <DropdownMenuSubTrigger>
                  <ProviderOptionLabel brandKey={brandFor(group[0])} name={nameFor(group[0])} />
                  {groupHasCurrent && <Check className="ml-auto size-4 shrink-0 text-muted-foreground" />}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {group.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => void setBinding({ consumer, credentialId: c.id })}
                      className="flex items-center justify-between gap-2"
                    >
                      <ProviderOptionLabel brandKey={brandFor(c)} name={nameFor(c)} keyName={c.name} />
                      {currentId === c.id && <Check className="size-4 shrink-0 text-muted-foreground" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
