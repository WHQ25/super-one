import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider } from '../theme/context'
import type { Locale } from '@superone/shared/agent-types'
import type { FilePreviewState } from '../file-preview-state'
import { createFakeMediaPorts, type FakeSaveBehaviour } from '../preview/fake-media-ports'
import { FILE_PREVIEW_FIXTURES, TINY_PNG } from '../preview/file-preview-fixtures'
import { Button } from './primitives'
import { FilePreviewModal } from './file-preview'

type Args = {
  state: FilePreviewState | null
  scheme: 'light' | 'dark'
  locale: Locale
  saveOutcome: FakeSaveBehaviour
  shareOutcome: 'ok' | 'throw'
}

const fixture = (label: string): FilePreviewState =>
  FILE_PREVIEW_FIXTURES.find((item) => item.label === label)?.state ?? FILE_PREVIEW_FIXTURES[0].state

function Preview(props: Args) {
  const [state, setState] = useState<FilePreviewState | null>(props.state)
  const ports = useMemo(
    () => createFakeMediaPorts({ save: props.saveOutcome, share: props.shareOutcome, delayMs: 600 }),
    [props.saveOutcome, props.shareOutcome],
  )
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <MobileThemeProvider colorScheme={props.scheme} locale={props.locale}>
        <View style={{ padding: 24, gap: 12 }}>
          <Button label="Open preview" onPress={() => setState(props.state ?? fixture('Image · tool screenshot'))} />
          <FilePreviewModal
            state={state}
            ports={ports}
            onDismiss={() => setState(null)}
            onStartTransfer={() => setState((current) => current?.kind === 'transfer' ? { ...current, phase: 'downloading' } : current)}
            onRetry={() => setState(null)}
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
  args: { state: fixture('Image · tool screenshot'), scheme: 'dark', locale: 'en', saveOutcome: 'saved', shareOutcome: 'ok' } satisfies Args,
  argTypes: {
    scheme: { control: 'radio', options: ['light', 'dark'] },
    locale: { control: 'radio', options: ['en', 'zh'] },
    saveOutcome: { control: 'radio', options: ['saved', 'cancelled', 'denied', 'throw'] },
    shareOutcome: { control: 'radio', options: ['ok', 'throw'] },
  },
}

/** Inline bytes from a tool screenshot: the menu offers Save to Photos and Share. */
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
/** A source that cannot decode shows the failure copy instead of a spinner forever. */
export const Broken = { args: { state: fixture('Image · broken') } }
/** Save reports the permission was denied and offers Settings. */
export const SaveDenied = { args: { saveOutcome: 'denied' } }
/** Save fails natively; the error stays until the next action. */
export const SaveFailed = { args: { saveOutcome: 'throw' } }
/** Share throws (no share sheet on this device). */
export const ShareFailed = { args: { shareOutcome: 'throw' } }
/** A code listing anchored on its cited line; the menu saves it to a folder. */
export const Code = { args: { state: fixture('Code · cited line 16') } }
/** Markdown rendered as prose. */
export const Markdown = { args: { state: fixture('Markdown') } }
/** An empty file still gets one numbered row. */
export const EmptyFile = { args: { state: fixture('Empty file') } }
/** Waiting for the host. */
export const Loading = { args: { state: fixture('Loading') } }
/** A relay transfer waiting for the Download tap; the menu is disabled until bytes arrive. */
export const TransferAwaitingConfirm = { args: { state: fixture('Transfer · relay, awaiting confirm') } }
/** Bytes on their way. */
export const TransferDownloading = { args: { state: fixture('Transfer · downloading') } }
/** A non-image file that finished downloading: Save to Files and Share are live. */
export const TransferReady = { args: { state: fixture('Transfer · ready to save') } }
/** The host refused the path. */
export const Error = { args: { state: fixture('Error') } }
/** A long label truncates on one line between the two buttons. */
export const LongLabel = { args: { state: { kind: 'image', name: 'long.png', label: 'A very long screenshot label that keeps going well past the width of a phone screen.png', src: TINY_PNG, mimeType: 'image/png' } satisfies FilePreviewState } }
/** Closed: only the trigger button, nothing painted over the page. */
export const Closed = { args: { state: null } }
