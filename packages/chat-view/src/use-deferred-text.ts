import { readDetailCache, writeDetailCache } from './detail-cache'
import { useEffect, useState } from 'react'
import { requestNative, requestNativeAsync } from './bridge'
import { applyDetailUpdate, listenDetail, type DetailUpdate } from './detail-stream'

export function useDeferredText(references: string[] | undefined, expanded: boolean, complete = false) {
  const [attempt, setAttempt] = useState(0)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify(references ?? [])
  useEffect(() => {
    if (!expanded || !references?.length) return
    let disposed = false
    const cleanups: (() => void)[] = []
    const texts = references.map(ref => readDetailCache(ref)?.text ?? '')
    setText(texts.join('\n\n'))
    setLoading(true)
    setError('')
    void Promise.all(references.map(async (detailRef, index) => {
      if (complete && readDetailCache(detailRef)?.complete) return
      const subscriptionId = globalThis.crypto?.randomUUID?.() ?? `detail-${Date.now()}-${Math.random().toString(36).slice(2)}`
      let revision = -1
      let ready = false
      const buffered: DetailUpdate[] = []
      const apply = (update: DetailUpdate) => {
        if (disposed || update.revision <= revision) return
        texts[index] = applyDetailUpdate(texts[index]!, update)
        revision = update.revision
        writeDetailCache(detailRef, texts[index]!, complete)
        setText(texts.join('\n\n'))
      }
      let released = false
      const stop = listenDetail(subscriptionId, update => {
        if (!ready) buffered.push(update)
        else {
          try { apply(update) } catch (error) { setError(String(error)) }
        }
      })
      const release = () => {
        if (released) return
        released = true
        stop(); requestNative('unsubscribeDetail', { subscriptionId })
      }
      cleanups.push(release)
      const snapshot = await requestNativeAsync('subscribeDetail', { detailRef, subscriptionId }) as DetailUpdate
      if (disposed) return
      apply(snapshot)
      ready = true
      buffered.sort((a, b) => a.revision - b.revision).forEach(apply)
      if (complete) release()
    })).catch(error => {
      cleanups.forEach(cleanup => cleanup())
      if (!disposed) setError(error instanceof Error ? error.message : String(error))
    })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true; cleanups.forEach(cleanup => cleanup()) }
  }, [expanded, key, complete, attempt])
  return { text, error, loading, retry: () => setAttempt(value => value + 1) }
}
