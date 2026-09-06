import { CameraView, type BarcodeScanningResult } from 'expo-camera'
import { useEffect, useState } from 'react'
import { ChevronDown, Link2Off, QrCode, RefreshCw } from 'lucide-react-native'
import { FlatList, Pressable, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import type { SavedPairing } from '@superone/relay-client'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Badge, Button, IconButton, ListRow, SectionHeader, Sheet } from '../ui'
import { DeviceRow, deviceLabel } from '../ui/device-row'
import type { DeviceStatus, ReconnectInfo } from '../device-status'

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
  onConnect: (pairing: SavedPairing) => void
  onRename: (pairing: SavedPairing, name: string) => void
  onForget: (pairing: SavedPairing) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
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
          <Text style={styles.secondaryBtnText}>Cancel scan</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <View style={styles.screenSection}>
      <View style={styles.sectionHeader}>
        <SectionHeader
          title="My Devices"
          action={(
            <View style={styles.pairingActions}>
              {props.pairings.length ? <Badge label={`${props.pairings.length}`} /> : null}
              <IconButton
                icon={RefreshCw}
                iconSize={16}
                label="Refresh devices"
                disabled={props.refreshing || props.pairings.length === 0}
                spinning={props.refreshing}
                onPress={props.onRefresh}
              />
            </View>
          )}
        />
      </View>
      {props.code ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Confirm on your desktop</Text>
          <Text style={styles.emptyBody}>Enter this code in SuperOne desktop to complete pairing.</Text>
          <Text style={styles.code}>{props.code}</Text>
        </View>
      ) : props.pairings.length ? (
        <FlatList
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
      ) : (
        <View style={styles.emptyState}>
          <Link2Off color={tokens.colors.border} size={54} />
          <Text style={styles.emptyTitle}>No devices yet</Text>
          <Text style={styles.emptyBody}>Scan the QR code from your desktop app to pair a device.</Text>
        </View>
      )}
      <Button label="Pair New Device" icon={QrCode} onPress={props.onOpenScanner} />
      {__DEV__ ? (
        <View style={styles.devPairing}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: developerOpen }} onPress={() => setDeveloperOpen(!developerOpen)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.rowMeta}>Developer pairing</Text><ChevronDown size={16} color={tokens.colors.mutedForeground} />
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
            placeholder="optional LAN host:port"
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
          placeholder="Device name"
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
