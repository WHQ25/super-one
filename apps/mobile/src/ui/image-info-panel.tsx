import { useEffect, useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy, ImageIcon } from 'lucide-react-native'
import { Image, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native'
import type { ImageGenerationInfo, MediaProviderLabel } from '@superone/shared/agent-types'
import { resolveMediaModelLabel, resolveMediaProviderLabel } from '@superone/shared/media-provider-labels'
import { FILE_PREVIEW_TEXT, formatGenerationDuration, IMAGE_PARAM_LABELS, previewFileName } from '../file-preview-state'
import type { ImageGenerationPorts } from '../image-generation-ports'
import type { Size } from '../image-preview-state'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { IconButton } from './icon-button'
import { Text } from './text'

/** How long the copy button shows its check before going back to the copy glyph. */
const COPIED_MS = 1500
/** A long prompt scrolls inside this share of the screen rather than pushing the panel past it. */
const PROMPT_MAX_HEIGHT_RATIO = 0.5

/**
 * What the desktop viewer's info popover shows, laid out for a phone: the
 * pixel size and generation time, then the parameters, reference images,
 * warnings and prompt, each behind a hairline.
 *
 * Provider and model ids resolve to names through the host's media catalogue
 * and reference images load through the host, both via `ports`; while either
 * is on its way — or when there are no ports, as in a story — the raw id and
 * the file name stand in, so the panel never waits on the network to open.
 */
export function ImageInfoPanel({ generation, imageSize, ports }: {
  generation: ImageGenerationInfo
  imageSize: Size | null
  ports?: ImageGenerationPorts
}) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const { height: windowHeight } = useWindowDimensions()
  const { revisedPrompt, generationMs, params, referenceImagePaths, warnings } = generation
  const providerId = params?.find((param) => param.key === 'provider')?.value
  const providers = useMediaProviderLabels(ports, Boolean(params?.some((param) => param.key === 'provider' || param.key === 'model')))
  const hasMeta = imageSize !== null || generationMs !== undefined
  const empty = !hasMeta && !params?.length && !referenceImagePaths?.length && !warnings?.length && !revisedPrompt
  const heading = { color: colors.mutedForeground, ...styles.heading }
  const divider = { borderTopColor: colors.border, ...styles.section }

  return (
    <View style={styles.panel} testID="image-info-panel">
      {empty ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t(FILE_PREVIEW_TEXT.noMetadata)}</Text>
      ) : null}
      {hasMeta ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {[
            imageSize ? `${imageSize.width} × ${imageSize.height}` : null,
            generationMs !== undefined ? `${t(FILE_PREVIEW_TEXT.generatedIn)} ${formatGenerationDuration(generationMs)}` : null,
          ].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {params && params.length > 0 ? (
        <View style={[divider, styles.params]}>
          {params.map((param) => (
            <View key={param.key} style={styles.paramRow}>
              <Text style={heading}>{t(IMAGE_PARAM_LABELS[param.key] ?? param.key)}</Text>
              <ParamValue param={param} providerId={providerId} providers={providers} />
            </View>
          ))}
        </View>
      ) : null}
      {referenceImagePaths && referenceImagePaths.length > 0 ? (
        <View style={divider}>
          <Text style={heading}>{t(FILE_PREVIEW_TEXT.paramReferenceImages)}</Text>
          <View style={styles.thumbGrid}>
            {referenceImagePaths.map((path) => (
              <ReferenceImageThumb key={path} path={path} ports={ports} />
            ))}
          </View>
        </View>
      ) : null}
      {warnings && warnings.length > 0 ? (
        <View style={divider}>
          <Text style={[heading, { color: colors.warning }]}>{t(FILE_PREVIEW_TEXT.warnings)}</Text>
          {warnings.map((warning, index) => (
            <Text key={index} style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>• {warning}</Text>
          ))}
        </View>
      ) : null}
      {revisedPrompt ? (
        <View style={divider}>
          <View style={styles.promptHeading}>
            <Text style={heading}>{t(FILE_PREVIEW_TEXT.prompt)}</Text>
            <CopyPromptButton prompt={revisedPrompt} />
          </View>
          <ScrollView
            style={{ maxHeight: windowHeight * PROMPT_MAX_HEIGHT_RATIO }}
            nestedScrollEnabled
            testID="image-info-prompt"
          >
            <Text selectable style={{ color: colors.foreground, fontSize: 12, lineHeight: 18 }}>{revisedPrompt}</Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

/**
 * One tap puts the prompt on the clipboard; the glyph turns into a check for a
 * moment so the tap is seen to land — the panel has no room for a toast, and
 * the desktop's toast would sit under the popover anyway.
 */
function CopyPromptButton({ prompt }: { prompt: string }) {
  const { tokens: { colors } } = useMobileTheme()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const handle = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(handle)
  }, [copied])
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? FILE_PREVIEW_TEXT.promptCopied : FILE_PREVIEW_TEXT.copyPrompt}
      iconSize={14}
      hitSlop={8}
      chrome="plain"
      color={copied ? colors.success : colors.mutedForeground}
      style={styles.copyButton}
      onPress={() => { void Clipboard.setStringAsync(prompt).then(() => setCopied(true)) }}
    />
  )
}

/** The catalogue labels, fetched once the panel has an id worth naming. */
function useMediaProviderLabels(ports: ImageGenerationPorts | undefined, wanted: boolean): MediaProviderLabel[] {
  const [providers, setProviders] = useState<MediaProviderLabel[]>([])
  useEffect(() => {
    if (!ports || !wanted) return
    let live = true
    ports.listMediaProviders().then((list) => { if (live) setProviders(list) }, () => {})
    return () => { live = false }
  }, [ports, wanted])
  return providers
}

/** A param's value: provider and model resolve to names, everything else prints as reported. */
function ParamValue({ param, providerId, providers }: { param: { key: string; value: string }; providerId?: string; providers: MediaProviderLabel[] }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const value = { color: colors.foreground, ...styles.paramValue }
  if (param.key === 'provider') {
    const { name, badge } = resolveMediaProviderLabel(param.value, providers)
    return (
      <View style={styles.providerValue}>
        <Text style={value}>{name}</Text>
        {badge ? (
          <Text style={[styles.badge, { color: colors.mutedForeground, backgroundColor: colors.muted, borderRadius: radius.sm }]}>{badge}</Text>
        ) : null}
      </View>
    )
  }
  if (param.key === 'model') {
    return <Text style={value}>{resolveMediaModelLabel(param.value, providerId, providers)}</Text>
  }
  return <Text style={value}>{param.value}</Text>
}

type ThumbPhase = { kind: 'loading' } | { kind: 'ready'; dataUri: string } | { kind: 'name' }

/**
 * One reference image: a square thumb once the host answers, the file name
 * when it cannot (no ports, a transfer the user has not approved, a read
 * failure). The name is the desktop's fallback too — its thumb carries the
 * path as a tooltip — so nothing is lost, only the picture.
 */
function ReferenceImageThumb({ path, ports }: { path: string; ports?: ImageGenerationPorts }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [phase, setPhase] = useState<ThumbPhase>(ports ? { kind: 'loading' } : { kind: 'name' })
  const name = previewFileName(path)

  useEffect(() => {
    if (!ports) return
    let live = true
    setPhase({ kind: 'loading' })
    ports.loadImage(path).then(
      (dataUri) => { if (live) setPhase(dataUri ? { kind: 'ready', dataUri } : { kind: 'name' }) },
      () => { if (live) setPhase({ kind: 'name' }) },
    )
    return () => { live = false }
  }, [path, ports])

  if (phase.kind === 'ready') {
    return (
      <Image
        source={{ uri: phase.dataUri }}
        accessibilityRole="image"
        accessibilityLabel={name}
        testID="reference-image-thumb"
        style={[styles.thumb, { borderColor: colors.border, backgroundColor: colors.muted, borderRadius: radius.sm }]}
      />
    )
  }
  return (
    <View
      accessibilityLabel={name}
      testID={phase.kind === 'loading' ? 'reference-image-loading' : 'reference-image-name'}
      style={[styles.thumb, styles.thumbChip, { borderColor: colors.border, backgroundColor: colors.muted, borderRadius: radius.sm }]}
    >
      <ImageIcon size={16} color={colors.mutedForeground} strokeWidth={1.8} />
      <Text numberOfLines={2} style={[styles.thumbName, { color: colors.mutedForeground }]}>{name}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { paddingHorizontal: 8, paddingBottom: 8, gap: 8 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 4 },
  heading: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 },
  promptHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  copyButton: { width: 24, height: 24 },
  params: { gap: 4 },
  paramRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  paramValue: { flexShrink: 1, fontSize: 12, textAlign: 'right' },
  providerValue: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  badge: { fontSize: 11, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 2 },
  thumb: { width: 72, height: 72, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  thumbChip: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 4 },
  thumbName: { fontSize: 10, lineHeight: 12, textAlign: 'center' },
})
