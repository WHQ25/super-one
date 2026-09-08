import { Folder, FolderPlus } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import { remotePathName } from '../shell-state'
import { useMobileTheme } from '../theme/context'
import { AnchoredMenu, MenuRow, MenuSeparator, useMenuAnchor } from './anchored-menu'
import { CHIP_HEIGHT, CHIP_HIT_SLOP, chipTriggerBackground } from './chip-metrics'
import { useMobileLocale } from '../i18n/context'

export type AdditionalDirsChipProps = {
  /** Folders the project carries; every session in it inherits them. */
  projectDirs: string[]
  /** Folders this session added on top, which end with it. */
  sessionDirs: string[]
  /** Opens the page that adds and removes them. */
  onManage: () => void
}

/**
 * How many folders the agent sees beyond the project root, in the status row.
 *
 * A count, not a list: this row is already spending its width on a model name,
 * and the folders are a standing fact rather than something read on every turn.
 * The names are one tap away, and they are what tells two of them apart — so
 * the popover carries the full paths rather than a tooltip that a phone has no
 * way to show.
 *
 * Shown while a session is being configured, not once it is running — the
 * caller decides that by passing empty lists, the way the chip row it replaced
 * was gated. It leads the row, ahead of the model, because that is the order the
 * decisions are made in on the landing.
 *
 * It reports **both** scopes. Its predecessor showed only the project's, so a
 * folder added to the session on the landing landed nowhere visible and read as
 * a failed write.
 */
export function AdditionalDirsChip({ projectDirs, sessionDirs, onManage }: AdditionalDirsChipProps) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const total = projectDirs.length + sessionDirs.length
  // No extra folders is the common case and says nothing worth a glyph; the
  // page is still reachable from `/add-dir`.
  if (!total) return null
  return <>
    <Pressable ref={menu.ref} accessibilityRole="button" accessibilityLabel={`${t('Additional folders')}: ${total}`}
      accessibilityState={{ expanded: !!menu.anchor }} onPress={menu.open} hitSlop={CHIP_HIT_SLOP}
      style={({ pressed }) => ({ minHeight: CHIP_HEIGHT, paddingHorizontal: 8, flexDirection: 'row',
        alignItems: 'center', gap: 4, borderRadius: 8,
        backgroundColor: chipTriggerBackground({ pressed, open: !!menu.anchor }, colors.muted) })}>
      <Folder size={16} color={colors.mutedForeground} />
      <View style={{ minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8,
        alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: colors.mutedForeground }}>{total}</Text>
      </View>
    </Pressable>
    <AnchoredMenu anchor={menu.anchor} title="Additional folders" onDismiss={menu.close} width={300}>
      <AdditionalDirsMenu projectDirs={projectDirs} sessionDirs={sessionDirs}
        onManage={() => { menu.close(); onManage() }} />
    </AnchoredMenu>
  </>
}

/**
 * The popover's body, exported so it can be tested without a layout pass —
 * `useMenuAnchor` measures a real view, which never happens under jest.
 */
export function AdditionalDirsMenu({ projectDirs, sessionDirs, onManage }: AdditionalDirsChipProps) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  return <>
    <Scope label={t('Project').toUpperCase()} dirs={projectDirs} />
    <Scope label={t('Session').toUpperCase()} dirs={sessionDirs} />
    <MenuSeparator />
    <MenuRow label="Manage folders" onPress={onManage}
      leading={<FolderPlus size={15} color={colors.mutedForeground} />} />
  </>
}

function Scope({ label, dirs }: { label: string; dirs: string[] }) {
  const { tokens: { colors } } = useMobileTheme()
  // An empty scope is left out rather than labelled `none`: this is a readout of
  // what exists, and the page is where an absence is worth stating.
  if (!dirs.length) return null
  return <View style={{ paddingBottom: 4 }}>
    <Text accessibilityRole="header" style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 2,
      fontSize: 10, fontWeight: '600', letterSpacing: 0.8, color: colors.mutedForeground }}>{label}</Text>
    {dirs.map((dir) => <View key={dir} style={{ paddingHorizontal: 8, paddingVertical: 4, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Folder size={13} color={colors.primary} />
        <Text style={{ fontSize: 13, fontWeight: '500', color: colors.foreground }}>{remotePathName(dir)}</Text>
      </View>
      {/* Wraps rather than truncating, for the same reason the page's rows do:
          two folders can share a name, and the segment that separates them is
          exactly what an ellipsis eats. */}
      <Text style={{ fontSize: 11, lineHeight: 15, fontFamily: 'Menlo', color: colors.mutedForeground }}>{dir}</Text>
    </View>)}
  </View>
}
