/**
 * Storybook: startup harness-align gate (pin-aligned managed runtimes).
 * Stories drive the presentational HarnessAlignView so UI can be iterated
 * without real downloads / app store navigation.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  HarnessAlignView,
  type HarnessAlignProgress,
  type HarnessAlignViewProps,
} from './HarnessAlignPage'

function FullscreenGate({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* macOS traffic-light drag strip (visual only) */}
      <div className="flex h-11 shrink-0 items-center px-3">
        <div className="w-20" />
      </div>
      {children}
    </div>
  )
}

function AlignFrame(props: HarnessAlignViewProps) {
  return (
    <FullscreenGate>
      <HarnessAlignView {...props} />
    </FullscreenGate>
  )
}

/** Animated download for polish / timing review. */
function AnimatedDownload({
  harnessId = 'claude',
  totalBytes = 48 * 1024 * 1024,
  stepMs = 350,
  steps = 12,
}: {
  harnessId?: string
  totalBytes?: number
  stepMs?: number
  steps?: number
}) {
  const [progress, setProgress] = useState<HarnessAlignProgress | null>(null)

  useEffect(() => {
    let i = 0
    const id = window.setInterval(() => {
      i += 1
      if (i > steps) {
        window.clearInterval(id)
        setProgress({
          harnessId,
          received: totalBytes,
          total: totalBytes,
          phase: 'done',
        })
        return
      }
      setProgress({
        harnessId,
        received: Math.round((totalBytes * i) / steps),
        total: totalBytes,
        phase: 'download',
      })
    }, stepMs)
    return () => window.clearInterval(id)
  }, [harnessId, stepMs, steps, totalBytes])

  return (
    <AlignFrame
      busy
      error=""
      progress={
        progress ?? {
          harnessId,
          received: 0,
          total: totalBytes,
          phase: 'download',
        }
      }
    />
  )
}

/** Multi-harness sequence: claude then codex. */
function MultiHarnessSequence() {
  const [progress, setProgress] = useState<HarnessAlignProgress | null>(null)
  const [phase, setPhase] = useState<'checking' | 'download'>('checking')

  useEffect(() => {
    const timers: number[] = []
    timers.push(
      window.setTimeout(() => {
        setPhase('download')
        setProgress({
          harnessId: 'claude',
          received: 0,
          total: 42 * 1024 * 1024,
          phase: 'download',
        })
      }, 800),
    )

    const claudeSteps = 6
    for (let i = 1; i <= claudeSteps; i++) {
      timers.push(
        window.setTimeout(
          () => {
            setProgress({
              harnessId: 'claude',
              received: Math.round(((42 * 1024 * 1024) * i) / claudeSteps),
              total: 42 * 1024 * 1024,
              phase: 'download',
            })
          },
          800 + i * 280,
        ),
      )
    }

    timers.push(
      window.setTimeout(
        () => {
          setProgress({
            harnessId: 'codex',
            received: 0,
            total: 18 * 1024 * 1024,
            phase: 'download',
          })
        },
        800 + claudeSteps * 280 + 200,
      ),
    )

    const codexSteps = 5
    for (let i = 1; i <= codexSteps; i++) {
      timers.push(
        window.setTimeout(
          () => {
            setProgress({
              harnessId: 'codex',
              received: Math.round(((18 * 1024 * 1024) * i) / codexSteps),
              total: 18 * 1024 * 1024,
              phase: 'download',
            })
          },
          800 + claudeSteps * 280 + 200 + i * 280,
        ),
      )
    }

    return () => {
      for (const t of timers) window.clearTimeout(t)
    }
  }, [])

  return (
    <AlignFrame
      busy
      error=""
      progress={phase === 'checking' ? null : progress}
    />
  )
}

function InteractiveErrorRetry() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(
    'claude: Download failed: ECONNRESET while fetching tarball from dl.super-one.dev\ncodex: Checksum mismatch after download',
  )
  const [progress, setProgress] = useState<HarnessAlignProgress | null>(null)

  const retry = () => {
    setBusy(true)
    setError('')
    setProgress(null)
    let step = 0
    const total = 32 * 1024 * 1024
    const id = window.setInterval(() => {
      step += 1
      if (step < 4) {
        setProgress({
          harnessId: 'claude',
          received: Math.round((total * step) / 8),
          total,
          phase: 'download',
        })
        return
      }
      window.clearInterval(id)
      setBusy(false)
      setProgress(null)
      setError('claude: R2 returned 403 for channel manifest')
    }, 400)
  }

  return <AlignFrame busy={busy} error={error} progress={progress} onRetry={retry} />
}

const meta: Meta<typeof HarnessAlignView> = {
  title: 'Onboarding/HarnessAlign',
  component: HarnessAlignView,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Startup gate that pin-aligns managed harness runtimes before main UI. Prefer static states for design; use animated stories for timing/polish.',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof HarnessAlignView>

/** First paint: spinner + "checking installed versions". */
export const Checking: Story = {
  name: 'Checking versions',
  render: () => <AlignFrame busy error="" progress={null} />,
  parameters: {
    docs: {
      description: {
        story: 'No progress event yet — only checking / resolving pins.',
      },
    },
  },
}

/** Mid-download with known byte total. */
export const Downloading: Story = {
  name: 'Downloading (known size)',
  render: () => (
    <AlignFrame
      busy
      error=""
      progress={{
        harnessId: 'claude',
        received: 18.4 * 1024 * 1024,
        total: 48 * 1024 * 1024,
        phase: 'download',
      }}
    />
  ),
}

/** Progress bar without total (indeterminate-ish width). */
export const DownloadingUnknownSize: Story = {
  name: 'Downloading (unknown size)',
  render: () => (
    <AlignFrame
      busy
      error=""
      progress={{
        harnessId: 'codex',
        received: 0,
        total: 0,
        phase: 'download',
      }}
    />
  ),
}

/** Failed align with retry. */
export const Error: Story = {
  name: 'Error + retry',
  render: () => (
    <AlignFrame
      busy={false}
      error={
        'claude: Download failed: ECONNRESET while fetching tarball from dl.super-one.dev\ncodex: Checksum mismatch after download'
      }
      progress={null}
      onRetry={() => {
        // no-op — use InteractiveError for retry flow
      }}
    />
  ),
}

/** Long single-line error (wrapping). */
export const ErrorLongMessage: Story = {
  name: 'Error (long message)',
  render: () => (
    <AlignFrame
      busy={false}
      error={
        'claude: Failed to download @anthropic-ai/claude-code@2.1.4 from https://dl.super-one.dev/harness/artifacts/anthropic-ai-claude-code/2.1.4.tgz — ENOTFOUND dl.super-one.dev (getaddrinfo)'
      }
      progress={null}
      onRetry={() => undefined}
    />
  ),
}

/** Animated single-harness download for motion polish. */
export const AnimatedSingle: Story = {
  name: 'Animated — single harness',
  render: () => <AnimatedDownload />,
  parameters: {
    docs: {
      description: {
        story: 'Loops once through a full download. Remount story to replay.',
      },
    },
  },
}

/** Checking → claude → codex sequence. */
export const AnimatedMulti: Story = {
  name: 'Animated — multi harness',
  render: () => <MultiHarnessSequence />,
  parameters: {
    docs: {
      description: {
        story: 'Simulates pin check then sequential claude + codex downloads.',
      },
    },
  },
}

/** Error state with working retry that fails again after partial progress. */
export const InteractiveError: Story = {
  name: 'Interactive — retry fails again',
  render: () => <InteractiveErrorRetry />,
  parameters: {
    docs: {
      description: {
        story: 'Click Retry to watch a short download then a new error.',
      },
    },
  },
}
