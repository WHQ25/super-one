import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CircleAlert, FileDown, FolderDown, ImageDown, MoreHorizontal, Share2 } from 'lucide-react-native'
import { ActivityIndicator, Animated, Modal, ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  describeSaveOutcome,
  FILE_PREVIEW_TEXT,
  filePreviewMenu,
  formatFileSize,
  previewChromeIconName,
  previewLocalSource,
  type FilePreviewState,
} from '../file-preview-state'
import type { ImageGenerationPorts } from '../image-generation-ports'
import type { MediaPorts } from '../media-ports'
import { useMobileLocale } from '../i18n/context'
import { NativeMarkdown } from '../prompts/NativeMarkdown'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuRow, useMenuAnchor } from './anchored-menu'
import { CodeListing } from './code-listing'
import { EdgeSwipeArea } from './edge-swipe'
import { FileTypeIcon } from './file-icon'
import { IconButton } from './icon-button'
import { MenuHost } from './menu-host'
import { Button } from './primitives'
import { SCROLL_INDICATOR_GUTTER } from './scroll-gutter'
import { Text } from './text'
import { useFade } from './use-fade'
import { ZoomableImage } from './zoomable-image'
import { ZoomableMermaid } from './zoomable-mermaid'

export type FilePreviewModalProps = {
  /** What to show; `null` keeps the modal closed. */
  state: FilePreviewState | null
  ports: MediaPorts
  onDismiss: () => void
  /** Approve a relay transfer the page is waiting on. */
  onStartTransfer: () => void
  onRetry: () => void
  /** Host access for a generated image's info panel; without it the panel shows ids and file names. */
  generationPorts?: ImageGenerationPorts
}

/** How long a success line stays before the chrome goes quiet again. */
const FEEDBACK_MS = 2500

/**
 * The one fullscreen surface every picture, mermaid diagram, and file on the
 * phone opens into — a tap on a transcript image, a mermaid expand, a file
 * chip, or a row in the Files browser.
 *
 * The body follows `state.kind`: a zoomable picture, a mermaid diagram, a
 * code listing or prose, a transfer card while bytes are still on the
 * desktop, or the loading and error states around them. The chrome is the
 * same throughout — back, the file-type icon and name (the same Symbols
 * artwork a file chip uses), and a menu with the only two things worth doing
 * with a file on a phone: keep a copy, or hand it to another app. Phones stay
 * portrait in chat, but this surface unlocks landscape so a picture or listing
 * can use the long side.
 *
 * Leaving is the back button's job, or a drag in from the left edge — the pop
 * gesture a native `Modal` has no equivalent of on iOS. A tap on the picture
 * only gets the chrome out of the way, so a finger that lands while lining up
 * a pinch cannot close the thing it was reaching for.
 */
export function FilePreviewModal({ state, ports, onDismiss, onStartTransfer, onRetry, generationPorts }: FilePreviewModalProps) {
  const { tokens: { colors } } = useMobileTheme()
  const [chromeVisible, setChromeVisible] = useState(true)
  const toggleChrome = useCallback(() => setChromeVisible((visible) => !visible), [])
  // Every new target arrives with its chrome up, whatever the last one was left at.
  const target = state?.kind === 'image' ? state.src : state?.kind === 'mermaid' ? state.svg : state?.path
  useEffect(() => { setChromeVisible(true) }, [target])

  return (
    <Modal
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape-left', 'landscape-right']}
      transparent
      visible={!!state}
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      {state ? (
        // A native Modal is its own window, so menus need a host of their own inside it.
        <MenuHost>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} accessibilityViewIsModal onAccessibilityEscape={onDismiss}>
            <PreviewBody state={state} chromeVisible={chromeVisible} onToggleChrome={toggleChrome} onStartTransfer={onStartTransfer} onRetry={onRetry} generationPorts={generationPorts} />
            <EdgeSwipeArea onSwipe={onDismiss} />
            <PreviewChrome state={state} ports={ports} onDismiss={onDismiss} visible={state.kind !== 'image' || chromeVisible} />
          </View>
        </MenuHost>
      ) : null}
    </Modal>
  )
}

/** Height the chrome row takes; in-flow bodies start below it. */
const CHROME_ROW_HEIGHT = 48

function PreviewBody({ state, chromeVisible, onToggleChrome, onStartTransfer, onRetry, generationPorts }: {
  state: FilePreviewState
  chromeVisible: boolean
  onToggleChrome: () => void
  onStartTransfer: () => void
  onRetry: () => void
  generationPorts?: ImageGenerationPorts
}) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()
  const insets = useSafeAreaInsets()
  // The picture sits under the chrome so it can use the whole screen; every
  // other body starts below it, or its first lines would be covered. Horizontal
  // insets keep a landscape listing off the notch.
  const offset = state.kind === 'image' ? undefined : {
    paddingTop: insets.top + CHROME_ROW_HEIGHT,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  }

  if (state.kind === 'mermaid') {
    return (
      <View style={[styles.flex, offset]}>
        <ZoomableMermaid svg={state.svg} />
      </View>
    )
  }

  if (state.kind === 'image') {
    return (
      <ZoomableImage
        key={state.src}
        src={state.src}
        label={state.label ?? state.name}
        generation={state.generation}
        generationPorts={generationPorts}
        chromeVisible={chromeVisible}
        onToggleChrome={onToggleChrome}
      />
    )
  }

  if (state.kind === 'loading') {
    return (
      <View style={[styles.center, offset]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{t(FILE_PREVIEW_TEXT.loading)}</Text>
      </View>
    )
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.center, offset, { paddingLeft: spacing.lg + insets.left, paddingRight: spacing.lg + insets.right }]}>
        <CircleAlert color={colors.error} size={28} />
        <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13, textAlign: 'center' }}>{state.message}</Text>
        <Button label={FILE_PREVIEW_TEXT.retry} variant="secondary" onPress={onRetry} />
      </View>
    )
  }

  if (state.kind === 'transfer') {
    return (
      <View style={[styles.center, offset, { paddingLeft: spacing.lg + insets.left, paddingRight: spacing.lg + insets.right }]}>
        <FileDown color={colors.primary} size={28} />
        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500', textAlign: 'center' }}>{state.name}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{formatFileSize(state.size)} · {state.mimeType}</Text>
        {state.phase === 'ready'
          ? <Text style={{ color: colors.mutedForeground, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>{t(FILE_PREVIEW_TEXT.ready)}</Text>
          : null}
        {state.phase === 'downloading'
          ? <TransferProgress receivedBytes={state.receivedBytes ?? 0} size={state.size} />
          : state.phase === 'idle' && state.needsConfirm
            ? <Button label={FILE_PREVIEW_TEXT.download} icon={FileDown} onPress={onStartTransfer} />
            : null}
      </View>
    )
  }

  if (state.markdown) {
    return (
      <ScrollView style={styles.flex}
        contentContainerStyle={{
          paddingTop: (offset?.paddingTop ?? 0) + spacing.md,
          paddingLeft: spacing.md + insets.left,
          paddingRight: SCROLL_INDICATOR_GUTTER + spacing.md + insets.right,
          paddingBottom: spacing.xl,
        }}>
        <NativeMarkdown content={state.text} />
      </ScrollView>
    )
  }

  return (
    <View style={[styles.flex, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      <CodeListing text={state.text} name={state.name} line={state.line} topInset={offset?.paddingTop ?? 0} />
    </View>
  )
}

function TransferProgress({ receivedBytes, size }: { receivedBytes: number; size: number }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const received = Math.max(0, Math.min(size, receivedBytes))
  const percent = size > 0 ? Math.round((received / size) * 100) : 0
  return (
    <View
      style={styles.progress}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      testID="file-preview-download-progress"
    >
      <View style={styles.progressRow}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t(FILE_PREVIEW_TEXT.downloading)}</Text>
        <Text style={{ color: colors.foreground, fontSize: 12 }}>
          {formatFileSize(received)} / {formatFileSize(size)}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.primary }]} />
      </View>
    </View>
  )
}

/** Back, title and the more menu, laid over the body inside the safe area. */
function PreviewChrome({ state, ports, onDismiss, visible }: { state: FilePreviewState; ports: MediaPorts; onDismiss: () => void; visible: boolean }) {
  const { tokens: { colors, spacing } } = useMobileTheme()
  const { t } = useMobileLocale()
  const insets = useSafeAreaInsets()
  const menu = useMenuAnchor()
  const opacity = useFade(visible)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; tone: 'info' | 'error'; offerSettings?: boolean } | null>(null)
  const actions = filePreviewMenu(state)
  const iconName = previewChromeIconName(state)
  const title = state.kind === 'image'
    ? state.label ?? state.name
    : state.kind === 'mermaid' ? t(FILE_PREVIEW_TEXT.mermaid) : state.name

  useEffect(() => {
    if (!feedback || feedback.tone === 'error' || feedback.offerSettings) return
    const handle = setTimeout(() => setFeedback(null), FEEDBACK_MS)
    return () => clearTimeout(handle)
  }, [feedback])

  const run = async (action: () => Promise<{ message: string; offerSettings: boolean } | null>) => {
    menu.close()
    if (busy) return
    setBusy(true)
    setFeedback(null)
    try {
      const result = await action()
      if (result) setFeedback({ message: result.message, tone: result.offerSettings ? 'error' : 'info', offerSettings: result.offerSettings })
    } catch (cause) {
      setFeedback({ message: cause instanceof Error ? cause.message : String(cause), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(async () => {
    const source = previewLocalSource(state)
    if (!source) return null
    return describeSaveOutcome(await ports.save(source, actions.save.toPhotos))
  })
  const share = () => run(async () => {
    const source = previewLocalSource(state)
    if (source) await ports.share(source)
    return null
  })

  // The row is opaque over every body, the picture included. A picture is
  // taller than the screen more often than not, so the alternative was white
  // text on whatever happened to be under it. Tapping the picture takes the
  // row away when the covered strip is the part worth seeing.
  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[styles.chrome, {
        paddingTop: insets.top,
        paddingLeft: Math.max(insets.left, spacing.xs),
        paddingRight: Math.max(insets.right, spacing.xs),
        backgroundColor: colors.background,
        opacity,
      }]}
    >
      <View style={styles.chromeRow}>
        <IconButton icon={ArrowLeft} label="Back" onPress={onDismiss} chrome="plain" color={colors.foreground} />
        <View style={styles.titleRow}>
          {iconName ? (
            <View testID="file-preview-type-icon" collapsable={false} style={styles.titleIcon}>
              <FileTypeIcon name={iconName} size={16} />
            </View>
          ) : null}
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        </View>
        <IconButton buttonRef={menu.ref} icon={MoreHorizontal} label={FILE_PREVIEW_TEXT.more} onPress={menu.open}
          chrome="plain" color={colors.foreground} spinning={busy} disabled={busy} />
      </View>
      {feedback ? (
        <View style={styles.feedbackRow}>
          <Text style={[styles.feedback, { color: feedback.tone === 'error' ? colors.error : colors.mutedForeground }]}>{t(feedback.message)}</Text>
          {feedback.offerSettings ? <Button label={FILE_PREVIEW_TEXT.openSettings} variant="secondary" onPress={ports.openSettings} /> : null}
        </View>
      ) : null}
      <AnchoredMenu anchor={menu.anchor} title={FILE_PREVIEW_TEXT.menuTitle} onDismiss={menu.close} width={240}>
        <MenuRow label={actions.save.toPhotos ? FILE_PREVIEW_TEXT.saveToPhotos : FILE_PREVIEW_TEXT.saveToFiles}
          leading={actions.save.toPhotos
            ? <ImageDown size={18} color={colors.mutedForeground} />
            : <FolderDown size={18} color={colors.mutedForeground} />}
          disabled={!actions.save.enabled} onPress={() => void save()} />
        <MenuRow label={FILE_PREVIEW_TEXT.share} leading={<Share2 size={18} color={colors.mutedForeground} />}
          disabled={!actions.share.enabled} onPress={() => void share()} />
      </AnchoredMenu>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
  progress: { width: 280, maxWidth: '100%', gap: 8 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  track: { height: 4, borderRadius: 999, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 999 },
  // Above the edge-swipe strip, or its 18px would cover the left of the back button.
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3 },
  chromeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, height: CHROME_ROW_HEIGHT },
  titleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  titleIcon: { flexShrink: 0 },
  title: { flexShrink: 1, textAlign: 'center', fontSize: 14, fontWeight: '600' },
  feedbackRow: { alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  feedback: { textAlign: 'center', fontSize: 12 },
})
