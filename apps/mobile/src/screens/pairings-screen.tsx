import { CameraView, type BarcodeScanningResult } from 'expo-camera'
import { useEffect, useState } from 'react'
import { Laptop, Link2Off, MoreHorizontal, QrCode, ChevronDown } from 'lucide-react-native'
import { FlatList, Pressable, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import type { SavedPairing } from '@superone/relay-client'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Badge, Button, IconButton, ListRow, SectionHeader, Sheet } from '../ui'

export function PairingsScreen(props: {
  scannerOpen: boolean
  paste: string
  lan: string
  code: string | null
  pairings: SavedPairing[]
  activePairingId: string | null
  connected: boolean
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
        <SectionHeader title="My Devices" action={props.pairings.length ? <Badge label={`${props.pairings.length}`} /> : null} />
      </View>
      {props.code ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Confirm on your desktop</Text>
          <Text style={styles.emptyBody}>Enter this code in SuperOne desktop to complete pairing.</Text>
          <Text style={styles.code}>{props.code}</Text>
        </View>
      ) : props.pairings.length ? (
        <FlatList
          data={props.pairings}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ListRow
              title={item.name || item.hostName || item.relayUrl}
              subtitle={item.lan ?? item.relayUrl}
              leading={(
                <View style={styles.iconBox}>
                  <Laptop color={tokens.colors.mutedForeground} size={23} />
                </View>
              )}
              trailing={(
                <View style={styles.pairingActions}>
                  <Badge
                    label={props.activePairingId === item.id && props.connected ? 'Online' : 'Offline'}
                    tone={props.activePairingId === item.id && props.connected ? 'success' : 'neutral'}
                  />
                  <IconButton icon={MoreHorizontal} label={`Manage ${item.name || item.hostName || 'device'}`} onPress={() => setEditing(item)} />
                </View>
              )}
              onPress={() => props.onConnect(item)}
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
      <Sheet visible={!!editing} title="Device" onDismiss={() => setEditing(null)}>
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
        <Button
          label="Forget device"
          variant="danger"
          onPress={() => {
            if (!editing) return
            props.onForget(editing)
            setEditing(null)
          }}
        />
      </Sheet>
    </View>
  )
}
