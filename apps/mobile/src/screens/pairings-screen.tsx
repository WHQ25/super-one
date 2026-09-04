import { CameraView, type BarcodeScanningResult } from 'expo-camera'
import { Laptop, Link2Off, QrCode } from 'lucide-react-native'
import { FlatList, Pressable, Text, TextInput, View } from 'react-native'
import type { SavedPairing } from '@superone/relay-client'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { Badge, Button, ListRow, SectionHeader } from '../ui'

export function PairingsScreen(props: {
  scannerOpen: boolean
  paste: string
  lan: string
  code: string | null
  pairings: SavedPairing[]
  onBarcodeScanned: (result: BarcodeScanningResult) => void
  onCancelScanner: () => void
  onPasteChange: (value: string) => void
  onLanChange: (value: string) => void
  onPair: () => void
  onOpenScanner: () => void
  onConnect: (pairing: SavedPairing) => void
}) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
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
          <Text style={styles.btnText}>Cancel scan</Text>
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
              title={item.hostName || item.relayUrl}
              subtitle={item.lan ?? item.relayUrl}
              leading={(
                <View style={styles.iconBox}>
                  <Laptop color={tokens.colors.mutedForeground} size={23} />
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
          <Text style={styles.rowMeta}>Developer pairing</Text>
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
        </View>
      ) : null}
    </View>
  )
}
