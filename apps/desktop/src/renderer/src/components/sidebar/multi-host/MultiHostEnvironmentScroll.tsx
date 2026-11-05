import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import { EnvironmentHeader, MultiHostProjectList } from './MultiHostProjectList'

type ListProps = ComponentProps<typeof MultiHostProjectList>

/**
 * Keeps the active device name at the top of the multi-host list without
 * painting a bar. The name is a sibling of the scrollport, and the scrollport
 * clips its top band to that name so project rows end at the name's lower edge.
 */
export function MultiHostEnvironmentScroll(props: ListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<HTMLDivElement>(null)
  const pinnedIdRef = useRef<string | null>(null)
  const obscuredKeyRef = useRef('')
  const [pinnedId, setPinnedId] = useState<string | null>(null)
  const [obscuredIds, setObscuredIds] = useState<string[]>([])

  const layoutKey = [
    props.groupBy,
    props.sort,
    props.environments.map((bucket) => `${bucket.environmentId}:${bucket.connection}:${bucket.projectsStatus}:${bucket.checkouts.length}`).join('|'),
    props.collapsedEnvironmentIds.join('|'),
    props.expandedProjectKeys.size,
  ].join('~')

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const frame = frameRef.current
    if (!viewport || !frame) return

    const update = () => {
      const top = viewport.getBoundingClientRect().top
      const headers = [...viewport.querySelectorAll<HTMLElement>('[data-environment-id] > [data-slot="environment-section-header"]')]
      let current: HTMLElement | null = null
      let next: HTMLElement | null = null
      for (const header of headers) {
        if (header.getBoundingClientRect().height < 1) continue
        const y = header.getBoundingClientRect().top
        if (y <= top + 0.5) current = header
        else if (!next) next = header
      }
      if (!current || current.getBoundingClientRect().height < 1) {
        frame.style.setProperty('--device-name-clip', '0px')
        if (pinRef.current) pinRef.current.style.transform = ''
        if (pinnedIdRef.current !== null) {
          pinnedIdRef.current = null
          setPinnedId(null)
        }
        if (obscuredKeyRef.current !== '') {
          obscuredKeyRef.current = ''
          setObscuredIds([])
        }
        return
      }

      const height = current.getBoundingClientRect().height
      let overlap = 0
      if (next) {
        const nextTop = next.getBoundingClientRect().top
        if (nextTop < top + height) overlap = Math.min(height, top + height - nextTop)
      }
      const clip = Math.max(0, height - overlap)
      frame.style.setProperty('--device-name-clip', `${clip}px`)
      if (pinRef.current) pinRef.current.style.transform = overlap > 0 ? `translateY(${-overlap}px)` : ''

      const id = current.parentElement?.getAttribute('data-environment-id') ?? null
      if (id !== pinnedIdRef.current) {
        pinnedIdRef.current = id
        setPinnedId(id)
      }
      const obscured = headers.flatMap((header) => {
        const box = header.getBoundingClientRect()
        if (box.height < 1 || box.bottom > top + clip + 0.5) return []
        const sectionId = header.parentElement?.getAttribute('data-environment-id')
        return sectionId ? [sectionId] : []
      })
      const key = obscured.join('\0')
      if (key !== obscuredKeyRef.current) {
        obscuredKeyRef.current = key
        setObscuredIds(obscured)
      }
    }

    update()
    viewport.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    const content = viewport.firstElementChild
    if (content) observer.observe(content)
    return () => {
      viewport.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [layoutKey])

  const pinned = props.environments.find((bucket) => bucket.environmentId === pinnedId) ?? null

  return (
    // pt-1 and top-1 stay equal. With AppDrawer's mb-1 the gap is 8px.
    <div ref={frameRef} className="device-name-clip relative h-full pt-1">
      <ScrollArea type="scroll" edgeFade viewportRef={viewportRef} className="sidebar-scroll h-full">
        <MultiHostProjectList {...props} obscuredEnvironmentIds={obscuredIds} />
      </ScrollArea>
      {pinned && (
        <div ref={pinRef} data-slot="pinned-device-name" className="pointer-events-none absolute inset-x-0 top-1 z-10 px-2">
          <div className="pointer-events-auto">
            <PinnedHeader {...props} bucket={pinned} />
          </div>
        </div>
      )}
    </div>
  )
}

function PinnedHeader({ bucket, ...props }: ListProps & { bucket: EnvironmentBucket }) {
  const offline = bucket.connection === 'offline'
  const collapsed = props.collapsedEnvironmentIds.includes(bucket.environmentId)
  return (
    <EnvironmentHeader
      bucket={bucket}
      expanded={!offline && !collapsed}
      refreshing={props.refreshingConnectionId === bucket.connectionId}
      connectionBusy={props.connectionBusyId === bucket.connectionId}
      sort={props.sort}
      onToggle={() => {
        if (offline) return
        props.onToggleEnvironment(bucket.environmentId)
      }}
      onRefresh={() => props.onRefreshEnvironment(bucket.connectionId)}
      onToggleConnection={() => props.onToggleConnection(bucket.connectionId, bucket.connection)}
      onAddProject={() => props.onAddProject(bucket.connectionId)}
      onSort={props.onSort}
      upgradingLabel={props.upgradingLabels?.[bucket.connectionId]}
    />
  )
}
