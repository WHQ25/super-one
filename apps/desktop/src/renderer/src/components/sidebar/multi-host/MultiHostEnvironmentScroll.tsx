import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { ScrollArea } from '@superone/ui/components/ui/scroll-area'
import { environmentSections } from '@/lib/multi-host/group-projects'
import type { EnvironmentBucket } from '@/lib/multi-host/types'
import {
  animateMultiHostHeightChanges,
  heightSections,
  measureMultiHostSections,
  multiHostProjectListMaxHeights,
  snapshotMultiHostHeights,
  syncMultiHostHeightsToDom,
  type MultiHostSectionMeasure,
} from '@/components/sidebar/session-list-scroll'
import { EnvironmentHeader, MultiHostListMountContext, MultiHostProjectList, OfflineEnvironmentGroup } from './MultiHostProjectList'

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
  const [paneHeight, setPaneHeight] = useState(0)
  const [sectionSizes, setSectionSizes] = useState<ReadonlyMap<string, MultiHostSectionMeasure>>()
  const paneHeightRef = useRef(0)
  const sectionSizesRef = useRef<ReadonlyMap<string, MultiHostSectionMeasure> | undefined>(undefined)
  const renderedHeightsRef = useRef(new Map<string, number>())
  const animationsRef = useRef(new Map<string, Animation>())
  const measureNowRef = useRef<((skipDomSync?: boolean) => ReadonlyMap<string, MultiHostSectionMeasure> | undefined) | null>(null)
  const pendingOpenRef = useRef<{
    prevHeights: Map<string, number>
    newlyOpenedIds: Set<string>
  } | null>(null)
  const latestPropsRef = useRef(props)
  latestPropsRef.current = props

  const computeCurrentHeights = (
    sizes: ReadonlyMap<string, MultiHostSectionMeasure> | undefined,
    pane: number,
  ) => {
    const current = latestPropsRef.current
    if (current.groupBy !== 'environment' || current.flat || !sizes) return null
    const collapsed = new Set(current.collapsedEnvironmentIds)
    return multiHostProjectListMaxHeights(
      heightSections(current.environments, current.sort, collapsed, sizes),
      pane,
    )
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = viewport?.firstElementChild
    if (!viewport || !content || typeof ResizeObserver === 'undefined') return
    const tracked = new Set<Element>()
    const observedBoxes = new Set<Element>()
    let lastKey = ''
    const boxObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        if (target.hasAttribute('data-environment-project-list')) {
          const envId = target.closest('[data-environment-id]')?.getAttribute('data-environment-id')
          if (envId) renderedHeightsRef.current.set(`env:${envId}`, height)
        } else if (target.hasAttribute('data-active-session-list')) {
          const projectKey = target.closest('[data-project-key]')?.getAttribute('data-project-key')
          if (projectKey) renderedHeightsRef.current.set(`session:${projectKey}`, height)
        }
      }
    })
    const syncBoxes = () => {
      for (const element of observedBoxes) {
        if (element.isConnected) continue
        boxObserver.unobserve(element)
        observedBoxes.delete(element)
      }
      for (const box of viewport.querySelectorAll('[data-environment-project-list], [data-active-session-list]')) {
        if (observedBoxes.has(box)) continue
        observedBoxes.add(box)
        boxObserver.observe(box)
      }
    }
    const measure = (skipDomSync = false) => {
      for (const element of tracked) {
        if (element.isConnected) continue
        observer.unobserve(element)
        tracked.delete(element)
      }
      syncBoxes()
      const next = measureMultiHostSections(viewport, (element) => {
        if (tracked.has(element)) return
        tracked.add(element)
        observer.observe(element)
      })
      const key = JSON.stringify([...next])
      if (key === lastKey) return sectionSizesRef.current
      lastKey = key
      sectionSizesRef.current = next
      if (!skipDomSync) {
        const heights = computeCurrentHeights(next, paneHeightRef.current)
        if (heights) {
          syncMultiHostHeightsToDom(
            viewport,
            heights,
            new Set(latestPropsRef.current.collapsedEnvironmentIds),
            animationsRef.current,
          )
        }
      }
      setSectionSizes(next)
      return next
    }
    measureNowRef.current = measure
    const observer = new ResizeObserver(() => measure(true))
    tracked.add(content)
    observer.observe(content)
    measure()
    return () => {
      measureNowRef.current = null
      observer.disconnect()
      boxObserver.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const read = () => {
      // The list's own padding stays inside the pane. Counting it as height
      // leaves a few pixels of scroll at the ends once the devices fit.
      const content = viewport.firstElementChild?.firstElementChild as HTMLElement | null
      const style = content ? getComputedStyle(content) : null
      const padding = style
        ? Math.ceil((parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0))
        : 0
      const rectHeight = viewport.getBoundingClientRect().height
      const viewportHeight = rectHeight > 0 ? rectHeight : viewport.clientHeight
      const next = Math.max(0, viewportHeight - padding)
      if (next === paneHeightRef.current) return
      paneHeightRef.current = next
      const heights = computeCurrentHeights(sectionSizesRef.current, next)
      if (heights) {
        syncMultiHostHeightsToDom(
          viewport,
          heights,
          new Set(latestPropsRef.current.collapsedEnvironmentIds),
          animationsRef.current,
        )
      }
      setPaneHeight((current) => (current === next ? current : next))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const collapsedKey = props.collapsedEnvironmentIds.join('\0')
  const prevCollapsedKeyRef = useRef<string | null>(null)

  const finishEnvironmentToggle = useCallback((
    viewport: HTMLElement,
    nextSet: ReadonlySet<string>,
    newlyOpenedIds: ReadonlySet<string>,
    prevHeights: ReadonlyMap<string, number>,
  ) => {
    if (newlyOpenedIds.size > 0) {
      const nextSizes = measureNowRef.current?.(true)
      const heights = computeCurrentHeights(nextSizes, paneHeightRef.current)
      if (heights) {
        syncMultiHostHeightsToDom(viewport, heights, nextSet, animationsRef.current)
      }
    }
    animateMultiHostHeightChanges(
      viewport,
      nextSet,
      newlyOpenedIds,
      prevHeights,
      renderedHeightsRef.current,
      animationsRef.current,
    )
  }, [])

  const hasMountedLists = (viewport: HTMLElement, ids: ReadonlySet<string>) => {
    if (ids.size === 0) return true
    const mounted = new Set<string>()
    for (const section of viewport.querySelectorAll<HTMLElement>('[data-environment-id]')) {
      const id = section.getAttribute('data-environment-id')
      if (id && section.querySelector('[data-environment-project-list]')) mounted.add(id)
    }
    return [...ids].every((id) => mounted.has(id))
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    if (prevCollapsedKeyRef.current === null) {
      prevCollapsedKeyRef.current = collapsedKey
      return
    }
    if (prevCollapsedKeyRef.current === collapsedKey) return
    const prevSet = new Set(prevCollapsedKeyRef.current ? prevCollapsedKeyRef.current.split('\0') : [])
    const nextSet = new Set(props.collapsedEnvironmentIds)
    prevCollapsedKeyRef.current = collapsedKey
    const onlineIds = new Set(
      props.environments.filter((bucket) => bucket.connection !== 'offline').map((bucket) => bucket.environmentId),
    )
    const newlyOpenedIds = new Set([...prevSet].filter((id) => !nextSet.has(id) && onlineIds.has(id)))
    const prevHeights = snapshotMultiHostHeights(viewport, renderedHeightsRef.current, animationsRef.current)
    if (!hasMountedLists(viewport, newlyOpenedIds)) {
      pendingOpenRef.current = { prevHeights, newlyOpenedIds }
      return
    }
    finishEnvironmentToggle(viewport, nextSet, newlyOpenedIds, prevHeights)
  }, [collapsedKey, finishEnvironmentToggle])

  const handleListMount = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const pending = pendingOpenRef.current
    if (!pending) {
      measureNowRef.current?.()
      return
    }
    if (!hasMountedLists(viewport, pending.newlyOpenedIds)) return
    pendingOpenRef.current = null
    finishEnvironmentToggle(
      viewport,
      new Set(latestPropsRef.current.collapsedEnvironmentIds),
      pending.newlyOpenedIds,
      pending.prevHeights,
    )
  }, [finishEnvironmentToggle])

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
  const offlineSections = props.groupBy === 'environment' && !props.flat
    ? environmentSections(props.environments, props.sort).filter((section) => section.bucket.connection === 'offline')
    : []

  return (
    // pt-1 and top-1 stay equal. With AppDrawer's mb-1 the gap is 8px.
    // The offline group is a sibling under the scroll. Opening it shortens the host list.
    <div ref={frameRef} className="device-name-clip relative flex h-full min-h-0 min-w-0 flex-col pt-1">
      {/* The viewport's child is `display: table`, whose border-spacing leaves a sliver of scroll at both ends. */}
      <ScrollArea type="scroll" edgeFade viewportRef={viewportRef} className="sidebar-scroll min-h-0 min-w-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:block!">
        <MultiHostListMountContext.Provider value={handleListMount}>
          <MultiHostProjectList {...props} obscuredEnvironmentIds={obscuredIds} paneHeight={paneHeight} sectionSizes={sectionSizes} />
        </MultiHostListMountContext.Provider>
      </ScrollArea>
      {offlineSections.length > 0 && (
        <OfflineEnvironmentGroup
          sections={offlineSections}
          sort={props.sort}
          obscuredEnvironmentIds={obscuredIds}
          refreshingConnectionId={props.refreshingConnectionId}
          connectionBusyId={props.connectionBusyId}
          upgradingLabels={props.upgradingLabels}
          onRefreshEnvironment={props.onRefreshEnvironment}
          onToggleConnection={props.onToggleConnection}
          onAddProject={props.onAddProject}
          onSort={props.onSort}
        />
      )}
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
      folderSessions={props.folderSessions}
      childSessions={props.childSessions}
    />
  )
}
