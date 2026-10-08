import { expect, jest, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import { useRef } from 'react'
import type { RelayClient } from '@superone/relay-client'
import { useFilePreview } from './use-file-preview'

// The hook only needs the download cap from here; the transport's ESM crypto never runs.
jest.mock('@superone/relay-client', () => ({ MAX_DOWNLOAD_BYTES: 100 * 1024 * 1024 }))

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const SVG = '<svg viewBox="0 0 1 1"></svg>'

async function renderPreview() {
  return renderHook(() => {
    const clientRef = useRef<RelayClient | null>(null)
    return useFilePreview({ clientRef, transport: null, project: null, sessionId: null, pairingId: null })
  })
}

test('back returns to the page a diagram was opened from, then closes', async () => {
  const { result } = await renderPreview()
  await act(async () => { result.current.showImage({ src: PNG, label: 'shot' }) })
  await act(async () => { result.current.showMermaid(SVG) })
  expect(result.current.state?.kind).toBe('mermaid')

  await act(async () => { result.current.back() })
  expect(result.current.state).toMatchObject({ kind: 'image', src: PNG })

  await act(async () => { result.current.back() })
  expect(result.current.state).toBeNull()
})

test('close leaves every stacked page at once', async () => {
  const { result } = await renderPreview()
  await act(async () => { result.current.showImage({ src: PNG }) })
  await act(async () => { result.current.showMermaid(SVG) })

  await act(async () => { result.current.close() })
  expect(result.current.state).toBeNull()

  // Nothing from before the close comes back on the next page's back.
  await act(async () => { result.current.showMermaid(SVG) })
  await act(async () => { result.current.back() })
  expect(result.current.state).toBeNull()
})

test('a phone-local file opens loading, fails in place, and its retry fetches again', async () => {
  const { result } = await renderPreview()
  const pdf = { name: 'spec.pdf', mimeType: 'application/pdf', localUri: 'file:///cache/attachments/spec.pdf', size: 1796 }
  let fail!: (error: Error) => void
  const fetch = jest.fn<() => Promise<typeof pdf>>()
    .mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    .mockResolvedValueOnce(pdf)

  let opening!: Promise<void>
  await act(async () => { opening = result.current.showLocalFile('spec.pdf', fetch) })
  expect(result.current.state).toMatchObject({ kind: 'loading', name: 'spec.pdf' })
  await act(async () => {
    fail(new Error('That attachment is no longer available'))
    await opening
  })
  expect(result.current.state).toMatchObject({ kind: 'error', name: 'spec.pdf', message: 'That attachment is no longer available' })

  await act(async () => { result.current.retry() })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(result.current.state).toMatchObject({ kind: 'pdf', name: 'spec.pdf', localUri: pdf.localUri })

  // The retry replaced the failed page rather than stacking on it.
  await act(async () => { result.current.back() })
  expect(result.current.state).toBeNull()
})
