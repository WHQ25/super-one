import { render } from '@testing-library/react'
import { createDetailClient, type DetailUpdate } from '@superone/chat-core'
import { requestNative, requestNativeAsync } from '@superone/chat-view/bridge'
import { DetailScopeProvider } from '@superone/chat-view/detail-scope'
import type { ReactNode } from 'react'

/** Mount the session scope supplied by the phone document around its rows. */
export function renderWithNativeDetails(children: ReactNode) {
  let nextId = 0
  const client = createDetailClient({
    subscribe: async (target, subscriptionId) => await requestNativeAsync('subscribeDetail', {
      detailRef: target.detailRef, subscriptionId,
    }) as DetailUpdate,
    unsubscribe: (_target, subscriptionId) => { requestNative('unsubscribeDetail', { subscriptionId }) },
  }, { newId: () => `detail-${++nextId}` })
  return render(
    <DetailScopeProvider scope={{ client, environmentId: 'desktop', sessionId: 'session' }}>
      {children}
    </DetailScopeProvider>,
  )
}
