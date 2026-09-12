import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import type { Locale } from '@superone/shared/agent-types'
import type { FilePreviewState } from '../file-preview-state'
import { createFakeGenerationPorts } from '../preview/fake-generation-ports'
import { createFakeMediaPorts, type FakeSaveBehaviour } from '../preview/fake-media-ports'
import { FILE_PREVIEW_FIXTURES, TINY_PNG, TOOL_GENERATION } from '../preview/file-preview-fixtures'
import { Button } from './primitives'
import { FilePreviewModal } from './file-preview'

type Args = {
  state: FilePreviewState | null
  scheme: 'light' | 'dark'
  locale: Locale
  saveOutcome: FakeSaveBehaviour
  shareOutcome: 'ok' | 'throw'
  landscape: boolean
}

const PORTRAIT_METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }
const LANDSCAPE_METRICS = { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 47, right: 21, bottom: 21 } }

const fixture = (label: string): FilePreviewState =>
  FILE_PREVIEW_FIXTURES.find((item) => item.label === label)?.state ?? FILE_PREVIEW_FIXTURES[0].state

function Preview(props: Args) {
  const [state, setState] = useState<FilePreviewState | null>(props.state)
  const ports = useMemo(
    () => createFakeMediaPorts({ save: props.saveOutcome, share: props.shareOutcome, delayMs: 600 }),
    [props.saveOutcome, props.shareOutcome],
  )
  const generationPorts = useMemo(() => createFakeGenerationPorts({ delayMs: 400 }), [])
  return (
    <SafeAreaProvider initialMetrics={props.landscape ? LANDSCAPE_METRICS : PORTRAIT_METRICS}>
      <MobileThemeProvider colorScheme={props.scheme} locale={props.locale}>
        <View style={{ padding: 24, gap: 12 }}>
          <Button label="Open preview" onPress={() => setState(props.state ?? fixture('Image · tool screenshot'))} />
          <FilePreviewModal
            state={state}
            ports={ports}
            onDismiss={() => setState(null)}
            onStartTransfer={() => setState((current) => current?.kind === 'transfer' ? { ...current, phase: 'downloading' } : current)}
            onRetry={() => setState(null)}
            generationPorts={generationPorts}
          />
        </View>
      </MobileThemeProvider>
    </SafeAreaProvider>
  )
}

export default {
  title: 'Mobile/FilePreview',
  component: FilePreviewModal,
  render: Preview,
  args: { state: fixture('Image · tool screenshot'), scheme: 'dark', locale: 'en', saveOutcome: 'saved', shareOutcome: 'ok', landscape: false } satisfies Args,
  argTypes: {
    scheme: { control: 'radio', options: ['light', 'dark'] },
    locale: { control: 'radio', options: ['en', 'zh'] },
    saveOutcome: { control: 'radio', options: ['saved', 'cancelled', 'denied', 'throw'] },
    shareOutcome: { control: 'radio', options: ['ok', 'throw'] },
    landscape: { control: 'boolean' },
  },
}

/** Inline bytes from a tool screenshot: back, the type icon and label, rotate, and the menu. */
export const Screenshot = {}
/** Same picture in the light shell. */
export const LightScheme = { args: { scheme: 'light' } }
/** Translated chrome and menu. */
export const Chinese = { args: { locale: 'zh' } }
/** A user attachment has bytes but no desktop path; the label is the file name. */
export const Attachment = { args: { state: fixture('Image · attachment, no path') } }
/** A picture a chip transfer wrote to the cache: same viewer, same menu. */
export const DownloadedImage = { args: { state: fixture('Image · downloaded file') } }
/** A markdown image by URL: both menu rows disabled, the picture streams in. */
export const RemoteUrl = { args: { state: fixture('Image · remote URL (nothing to save)') } }
/** Turn it with the bar at the bottom: a portrait picture shrinks to lie down. */
export const TallPortrait = { args: { state: fixture('Image · tall portrait (turn it)') } }
/** A source that cannot decode shows the failure copy instead of a spinner forever. */
export const Broken = { args: { state: fixture('Image · broken') } }
/** A mermaid diagram on its own page: pinch stays here, back restores the chat. */
export const Mermaid = { args: { state: fixture('Mermaid') } }
/** Same diagram in the light shell. */
export const MermaidLight = { args: { state: fixture('Mermaid'), scheme: 'light' } }
/** Translated mermaid chrome. */
export const MermaidChinese = { args: { state: fixture('Mermaid'), locale: 'zh' } }
/** Save reports the permission was denied and offers Settings. */
export const SaveDenied = { args: { saveOutcome: 'denied' } }
/** Save fails natively; the error stays until the next action. */
export const SaveFailed = { args: { saveOutcome: 'throw' } }
/** Share throws (no share sheet on this device). */
export const ShareFailed = { args: { shareOutcome: 'throw' } }
/** A code listing with the TSX type icon in the title; the menu saves it to a folder. */
export const Code = { args: { state: fixture('Code · cited line 16') } }
/** Phone turned sideways: chrome clears the notch, the type icon stays beside the name. */
export const LandscapeCode = { args: { state: fixture('Code · cited line 16'), landscape: true } }
/** A landscape picture uses the long side; the same chrome, with the type icon. */
export const LandscapeScreenshot = { args: { landscape: true } }
/** Markdown rendered as prose. */
export const Markdown = { args: { state: fixture('Markdown') } }
/** An empty file still gets one numbered row. */
export const EmptyFile = { args: { state: fixture('Empty file') } }
/** Waiting for the host. */
export const Loading = { args: { state: fixture('Loading') } }
/** A relay transfer waiting for the Download tap; the menu is disabled until bytes arrive. */
export const TransferAwaitingConfirm = { args: { state: fixture('Transfer · relay, awaiting confirm') } }
/** Bytes on their way; the bar reflects how far the transfer has got. */
export const TransferDownloading = { args: { state: fixture('Transfer · downloading') } }
/** A non-image file that finished downloading: Save to Files and Share are live. */
export const TransferReady = { args: { state: fixture('Transfer · ready to save') } }
/** The host refused the path. */
export const Error = { args: { state: fixture('Error') } }
/** A long label truncates on one line after the type icon, between the two buttons. */
export const LongLabel = { args: { state: { kind: 'image', name: 'long.png', label: 'A very long screenshot label that keeps going well past the width of a phone screen.png', src: TINY_PNG, mimeType: 'image/png' } satisfies FilePreviewState } }
/** A generated image: the rotate bar grows an info button whose panel lists the generation facts. */
export const GeneratedImage = { args: { state: { kind: 'image', name: 'astronaut.png', path: '/Users/me/proj/media/astronaut.png', src: TINY_PNG, mimeType: 'image/png', generation: TOOL_GENERATION } satisfies FilePreviewState } }
/** Closed: only the trigger button, nothing painted over the page. */
export const Closed = { args: { state: null } }
