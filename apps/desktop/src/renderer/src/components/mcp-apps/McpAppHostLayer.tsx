import { lazy, Suspense, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { useMcpAppLayout } from './layout-store'
const Controller = lazy(() => import('./McpAppController').then(module => ({ default: module.McpAppController })))

/** Mounted outside the transcript; scrolling/virtualization never owns a bridge. */
export function McpAppHostLayer({ boundary }: { boundary?: RefObject<HTMLDivElement | null> }) {
  const views = useMcpAppLayout(state => state.views)
  const [area, setArea] = useState<{ element: HTMLDivElement; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = boundary?.current
    if (!element) return
    const measure = () => setArea({ element, width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure); observer.observe(element)
    return () => observer.disconnect()
  }, [boundary])
  useEffect(() => () => useMcpAppLayout.getState().clear(), [])
  return <Suspense fallback={null}>{Object.values(views).map(owner => <Controller key={owner.app.appInstanceId} owner={owner} fullscreenArea={area} />)}</Suspense>
}
