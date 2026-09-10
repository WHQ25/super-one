import { ArrowRight, Download, ShieldAlert } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { Text } from './text'
import { Button, Sheet } from './primitives'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import type { UpdateFailure, UpdateFlowActions, UpdateFlowState } from '../updates/use-update-check'
import {
  formatBuildLabel,
  formatDownloadPercent,
  formatUpdateSize,
} from '../updates/update-format'

/**
 * The two update surfaces: a dismissible sheet, and a gate that is not.
 *
 * Purely presentational -- everything it needs arrives as `state` and
 * `actions`, so the gallery, the stories and the jest tests drive the same
 * component the app renders.
 *
 * The gate is a plain full-screen fill rather than a `Sheet`, because
 * `PromptSheet` ships a scrim tap and a drag-to-dismiss. A hard gate that can
 * be swiped away is not a gate.
 */

/** Static, translatable sentences per failure. Numbers never appear in these. */
const FAILURE_COPY: Record<UpdateFailure, string> = {
  'too-large': 'That download is larger than this app will accept.',
  'disk-space': 'There is not enough free space to download and install this update.',
  network: 'The download could not finish. Check your connection and try again.',
  checksum: 'The downloaded file did not match what the server published.',
  cancelled: 'The download was cancelled.',
  unknown: 'The download could not finish.',
  'install-unavailable':
    'Android would not open the installer. Allow this app to install unknown apps, then try again.',
}

function useUpdateStyles() {
  const { tokens: { colors, spacing, radius } } = useMobileTheme()
  return {
    colors,
    styles: StyleSheet.create({
      body: { gap: spacing.md, paddingBottom: spacing.md },
      lead: { color: colors.foreground, fontSize: 14, lineHeight: 20 },
      versionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
      versionFrom: { color: colors.mutedForeground, fontSize: 13 },
      versionTo: { color: colors.foreground, fontSize: 13, fontWeight: '600' },
      metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
      metaLabel: { color: colors.mutedForeground, fontSize: 12 },
      metaValue: { color: colors.foreground, fontSize: 12 },
      track: {
        height: 4,
        borderRadius: radius.pill,
        backgroundColor: colors.muted,
        overflow: 'hidden',
      },
      fill: { height: 4, borderRadius: radius.pill, backgroundColor: colors.primary },
      failure: { color: colors.error, fontSize: 13, lineHeight: 18 },
      actions: { flexDirection: 'row', gap: spacing.sm },
      action: { flex: 1 },
      gate: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
      },
      gateCard: {
        width: '100%',
        maxWidth: 420,
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      },
      gateTitle: { color: colors.foreground, fontSize: 17, fontWeight: '600' },
    }),
  }
}

function UpdateBody({ state, actions }: { state: UpdateFlowState; actions: UpdateFlowActions }) {
  const { colors, styles } = useUpdateStyles()
  const { t } = useMobileLocale()
  const manifest = state.manifest
  if (!manifest) return null

  const required = state.verdict === 'required'
  const downloading = state.download !== null
  const fraction = state.download?.fraction ?? null

  return (
    <View style={styles.body}>
      <Text style={styles.lead}>
        {t(
          required
            ? 'This build is too old to keep using. Update to carry on.'
            : 'A newer build of SuperOne is ready to install.',
        )}
      </Text>

      <View style={styles.versionRow}>
        <Text testID="update-current-build" style={styles.versionFrom}>
          {formatBuildLabel(state.currentVersion, state.currentBuildCode)}
        </Text>
        <ArrowRight size={14} color={colors.mutedForeground} />
        <Text testID="update-next-build" style={styles.versionTo}>
          {formatBuildLabel(manifest.version, manifest.buildCode)}
        </Text>
      </View>

      {manifest.artifact ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('Download size')}</Text>
          <Text testID="update-size" style={styles.metaValue}>
            {formatUpdateSize(manifest.artifact.sizeBytes)}
          </Text>
        </View>
      ) : null}

      {downloading ? (
        <View style={{ gap: 6 }}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t('Downloading…')}</Text>
            <Text testID="update-progress" style={styles.metaValue}>
              {formatDownloadPercent(fraction)}
            </Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((fraction ?? 0) * 100)}%` }]} />
          </View>
        </View>
      ) : null}

      {state.failure ? (
        <Text testID="update-failure" style={styles.failure}>
          {t(FAILURE_COPY[state.failure])}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {downloading ? (
          <View style={styles.action}>
            <Button label="Cancel" variant="secondary" onPress={actions.cancelDownload} />
          </View>
        ) : (
          <View style={styles.action}>
            {state.canSelfInstall ? (
              <Button
                label={state.failure ? 'Try again' : 'Update now'}
                icon={Download}
                onPress={actions.startDownload}
              />
            ) : (
              <Button label="Open TestFlight" icon={Download} onPress={actions.openTestFlight} />
            )}
          </View>
        )}
        {state.failure === 'install-unavailable' ? (
          <View style={styles.action}>
            <Button
              label="Allow installs"
              variant="secondary"
              onPress={actions.openUnknownSourcesSettings}
            />
          </View>
        ) : null}
        {!required && !downloading ? (
          <View style={styles.action}>
            <Button label="Later" variant="ghost" onPress={actions.dismiss} />
          </View>
        ) : null}
      </View>
    </View>
  )
}

export function UpdatePrompt({
  state,
  actions,
}: {
  state: UpdateFlowState
  actions: UpdateFlowActions
}) {
  const { colors, styles } = useUpdateStyles()
  const { t } = useMobileLocale()

  if (state.verdict === 'none' || !state.manifest) return null

  if (state.verdict === 'required') {
    return (
      <View
        testID="update-gate"
        accessibilityViewIsModal
        accessibilityLabel={t('Update required')}
        style={styles.gate}
      >
        <View style={styles.gateCard}>
          <View style={styles.versionRow}>
            <ShieldAlert size={18} color={colors.error} />
            <Text style={styles.gateTitle}>{t('Update required')}</Text>
          </View>
          <UpdateBody state={state} actions={actions} />
        </View>
      </View>
    )
  }

  return (
    // `Sheet` takes no testID; PromptSheet already exposes `prompt-title` and
    // `prompt-close`, which is what the component tests query.
    <Sheet visible title="Update available" icon={Download} onDismiss={actions.dismiss}>
      <UpdateBody state={state} actions={actions} />
    </Sheet>
  )
}
