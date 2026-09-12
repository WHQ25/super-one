import { CameraView, type BarcodeScanningResult } from 'expo-camera'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, QrCode, RefreshCw } from 'lucide-react-native'
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import type { SavedPairing } from '@superone/relay-client'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Badge, Button, IconButton, ListRow, SectionHeader, Sheet } from '../ui'
import { DeviceRow, deviceLabel } from '../ui/device-row'
import { PairingCode } from './pairing-code'
import { Wordmark } from '../ui/wordmark'
import type { DeviceStatus, ReconnectInfo } from '../device-status'
import { useMobileLocale } from '../i18n/context'

export function PairingsScreen(props: {
  scannerOpen: boolean
  paste: string
  lan: string
  code: string | null
  pairings: SavedPairing[]
  statusOf: (pairing: SavedPairing) => DeviceStatus
  /** Backoff of the live socket; only the active device can be retrying. */
  reconnect: ReconnectInfo | null
  activePairingId: string | null
  connectingPairingId: string | null
  refreshing: boolean
  onRefresh: () => void
  onBarcodeScanned: (result: BarcodeScanningResult) => void
  onCancelScanner: () => void
  onPasteChange: (value: string) => void
  onLanChange: (value: string) => void
  onPair: () => void
  onOpenScanner: () => void
  onCancelPairing: () => void
  onConnect: (pairing: SavedPairing) => void
  onRename: (pairing: SavedPairing, name: string) => void
  onForget: (pairing: SavedPairing) => void
}) {
  const styles = useMobileStyles()
  const layout = useLayoutStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const [editing, setEditing] = useState<SavedPairing | null>(null)
  const [developerOpen, setDeveloperOpen] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => setName(editing?.name ?? editing?.hostName ?? ''), [editing])
  if (props.scannerOpen) {
    return (
      <View style={styles.scannerBox}>
        <CameraView
          style={styles.scanner}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={props.onBarcodeScanned}
        />
        <Pressable style={styles.scannerCancel} onPress={props.onCancelScanner}>
          <Text style={styles.secondaryBtnText}>{t('Cancel scan')}</Text>
        </Pressable>
      </View>
    )
  }
  if (props.code) return <PairingCode code={props.code} onCancel={props.onCancelPairing} />
  const hasDevices = props.pairings.length > 0
  return (
    <View style={styles.screenSection}>
      {/* Wordmark, device list and pair button are one group, centred while it
          fits. Only the list may give way: when the devices outgrow the screen
          it shrinks and scrolls, so the wordmark and the button stay put at
          either end however many devices are saved. */}
      <View style={layout.group}>
        <Wordmark />
        {hasDevices ? (
          <View style={layout.devices}>
            <View style={styles.sectionHeader}>
              <SectionHeader
                title="My Devices"
                badge={<Badge label={`${props.pairings.length}`} />}
                action={(
                  <IconButton
                    icon={RefreshCw}
                    iconSize={16}
                    label="Refresh devices"
                    disabled={props.refreshing}
                    spinning={props.refreshing}
                    onPress={props.onRefresh}
                  />
                )}
              />
            </View>
            <FlatList
              testID="device-list"
              style={layout.list}
              // Rows are rebuilt with their status so a reachability change repaints
              // them; FlatList would otherwise skip cells whose `data` entry is ===.
              data={props.pairings.map((pairing) => ({ pairing, status: props.statusOf(pairing) }))}
              keyExtractor={(item) => item.pairing.id}
              renderItem={({ item }) => (
                <DeviceRow
                  pairing={item.pairing}
                  status={item.status}
                  reconnect={props.activePairingId === item.pairing.id ? props.reconnect : null}
                  disabled={props.connectingPairingId !== null && props.connectingPairingId !== item.pairing.id}
                  onPress={() => props.onConnect(item.pairing)}
                  onRename={() => setEditing(item.pairing)}
                  onForget={() => props.onForget(item.pairing)}
                />
              )}
            />
          </View>
        ) : null}
        <Button label="Pair New Device" icon={QrCode} onPress={props.onOpenScanner} />
        {hasDevices ? null : (
          // With nothing to list the button sits right under the wordmark and
          // the hint takes the list's place beneath it.
          <Text style={styles.emptyBody}>{t('Scan the QR code from your desktop app to pair a device.')}</Text>
        )}
      </View>
      {__DEV__ ? (
        <View style={styles.devPairing}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: developerOpen }} onPress={() => setDeveloperOpen(!developerOpen)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.rowMeta}>{t('Developer pairing')}</Text><ChevronDown size={16} color={tokens.colors.mutedForeground} />
          </Pressable>
          {developerOpen ? <>
          <TextInput
            style={[styles.input, styles.multi]}
            placeholder={'superone://pair?…  or  {"relayUrl","secret"}'}
            placeholderTextColor={tokens.colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            keyboardType="url"
            multiline
            value={props.paste}
            onChangeText={props.onPasteChange}
          />
          <TextInput
            style={styles.input}
            placeholder={t('optional LAN host:port')}
            placeholderTextColor={tokens.colors.mutedForeground}
            autoCapitalize="none"
            value={props.lan}
            onChangeText={props.onLanChange}
          />
          <Button label="Pair from link" onPress={props.onPair} variant="secondary" />
          </> : null}
        </View>
      ) : null}
      <Sheet visible={!!editing} title="Rename device" onDismiss={() => setEditing(null)}>
        {editing ? <ListRow title={deviceLabel(editing)} subtitle={editing.relayUrl} /> : null}
        <TextInput
          style={styles.input}
          placeholder={t('Device name')}
          placeholderTextColor={tokens.colors.mutedForeground}
          value={name}
          onChangeText={setName}
        />
        <Button
          label="Rename"
          disabled={!name.trim()}
          onPress={() => {
            if (!editing) return
            props.onRename(editing, name.trim())
            setEditing(null)
          }}
        />
      </Sheet>
    </View>
  )
}

function useLayoutStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => StyleSheet.create({
    /** Centres while the group is short; only the list gives way once it is not. */
    group: { flex: 1, flexShrink: 1, gap: tokens.spacing.lg, justifyContent: 'center' },
    devices: { flexShrink: 1, gap: tokens.spacing.md },
    /** No grow: the list is as tall as its rows until the group runs out of room. */
    list: { flexGrow: 0, flexShrink: 1 },
  }), [tokens])
}
