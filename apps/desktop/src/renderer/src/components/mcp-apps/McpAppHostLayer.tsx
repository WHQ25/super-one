import { lazy, Suspense, useEffect } from 'react'
import { useMcpAppLayout } from './layout-store'
const Controller = lazy(() => import('./McpAppController').then(module => ({ default: module.McpAppController })))

/** Mounted outside the transcript; scrolling/virtualization never owns a bridge. */
export function McpAppHostLayer() {
  const views = useMcpAppLayout(state => state.views)
  useEffect(() => () => useMcpAppLayout.getState().clear(), [])
  return <Suspense fallback={null}>{Object.values(views).map(owner => <Controller key={owner.app.appInstanceId} owner={owner} />)}</Suspense>
}
