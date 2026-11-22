// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReviewFileDiff } from '@superone/shared/review-types'
import { ReviewDiffCanvas } from './ReviewDiffCanvas'

vi.mock('@/components/coding/FilePreview', () => ({
  FilePreview: ({ filePath }: { filePath: string }) => (
    <div data-testid="mock-file-preview">{filePath}</div>
  ),
}))

const SAMPLE_FILE: ReviewFileDiff = {
  path: 'src/demo.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  patch: [
    'diff --git a/src/demo.ts b/src/demo.ts',
    '--- a/src/demo.ts',
    '+++ b/src/demo.ts',
    '@@ -1,3 +1,3 @@',
    ' const a = 1',
    '-const b = 2',
    '+const b = 20',
    ' const c = 3',
  ].join('\n'),
  source: 'workspace-git',
}

const IMAGE_FILE: ReviewFileDiff = {
  path: 'assets/shot.png',
  status: 'modified',
  additions: 0,
  deletions: 0,
  isBinary: true,
  patch: '',
  source: 'workspace-git',
}

function mockOffscreenIntersectionObserver() {
  let callback: IntersectionObserverCallback | null = null
  const disconnect = vi.fn()
  class FakeIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) {
      callback = cb
    }
    observe() {}
    unobserve() {}
    disconnect = disconnect
    takeRecords() { return [] }
    root = null
    rootMargin = ''
    thresholds = []
  }
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 2000,
    bottom: 2400,
    left: 0,
    right: 600,
    width: 600,
    height: 400,
    x: 0,
    y: 2000,
    toJSON: () => ({}),
  })
  return {
    disconnect,
    emit(isIntersecting: boolean) {
      act(() => {
        callback?.(
          [{ isIntersecting } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
      })
    },
  }
}

describe('ReviewDiffCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('mounts and unmounts cleanly in StrictMode', () => {
    const { unmount, container } = render(
      <StrictMode>
        <ReviewDiffCanvas
          file={SAMPLE_FILE}
          scope="workspace"
          workspaceRoot="/repo"
          diffStyle="split"
          lspAllowed={false}
        />
      </StrictMode>,
    )
    expect(container.querySelector('diffs-container')).not.toBeNull()
    unmount()
  })

  it('keeps FileDiff mounted when lazyViewport element leaves the viewport', () => {
    const observer = mockOffscreenIntersectionObserver()

    const { container } = render(
      <ReviewDiffCanvas
        file={SAMPLE_FILE}
        scope="workspace"
        workspaceRoot="/repo"
        diffStyle="split"
        lazyViewport
        lspAllowed={false}
      />,
    )

    expect(container.querySelector('diffs-container')).not.toBeNull()

    observer.emit(true)
    expect(container.querySelector('diffs-container')).not.toBeNull()
    expect(observer.disconnect).toHaveBeenCalled()

    observer.emit(false)
    expect(container.querySelector('diffs-container')).not.toBeNull()
  })

  it('lazily mounts media preview once and keeps it mounted after leaving viewport', async () => {
    const observer = mockOffscreenIntersectionObserver()

    const { findByTestId, queryByTestId } = render(
      <ReviewDiffCanvas
        file={IMAGE_FILE}
        scope="workspace"
        workspaceRoot="/repo"
        diffStyle="split"
        lazyViewport
        lspAllowed={false}
      />,
    )

    expect(queryByTestId('mock-file-preview')).toBeNull()

    observer.emit(true)
    expect(await findByTestId('mock-file-preview')).not.toBeNull()
    expect(observer.disconnect).toHaveBeenCalled()

    observer.emit(false)
    expect(queryByTestId('mock-file-preview')).not.toBeNull()
  })
})
