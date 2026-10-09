import { useMemo, useState, type ReactNode } from 'react'
import { Laptop, Monitor, type LucideIcon } from 'lucide-react-native'
import Svg, { Path } from 'react-native-svg'
import { ActivityIndicator, FlatList, Platform, StyleSheet, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import { Button, ListRow } from '../ui'
import { Wordmark } from '../ui/wordmark'
import { deviceLabel } from '../ui/device-row'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { pairingDirection, type DesktopPairingState } from '../navigation/desktop-pairing-state'
import { PairingCode } from './pairing-code'

/**
 * Pairing two desktops through this phone: pick the saved desktop, carry the
 * six-digit code, and report the result. Takes over the page like phone
 * pairing does.
 */
export function DesktopPairingFlow(props: {
  state: DesktopPairingState
  onChoose: (index: number) => void
  onSubmitCode: (code: string) => void
  onCancel: () => void
}) {
  const { state } = props
  const page = usePageStyles()
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  const [typed, setTyped] = useState('')

  if (state.step === 'show-code') {
    return (
      <PairingCode
        code={state.code}
        onCancel={props.onCancel}
        title="Desktop Pairing Code"
        header={<Direction {...pairingDirection(state)} />}
        body="Enter it on the computer you scanned to let the other desktop run tasks there."
        waiting="Waiting for the computer to confirm…"
      />
    )
  }

  let content: ReactNode
  let action: ReactNode = <Button label="Cancel" variant="secondary" onPress={props.onCancel} />
  if (state.step === 'choose') {
    const controller = state.qr.kind === 'controller'
    content = (
      <>
        <Text style={page.title}>{t(controller ? 'Choose the Controlling Desktop' : 'Choose the Desktop to Control')}</Text>
        <Text style={page.body}>
          {t(controller
            ? 'The desktop you choose will be able to run tasks on the computer you scanned.'
            : 'The computer you scanned will be able to run tasks on the desktop you choose.')}
        </Text>
        <Text style={page.scanned} numberOfLines={1}>{state.qr.desktopName}</Text>
        <FlatList
          style={page.list}
          data={state.candidates}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => (
            <ListRow
              title={deviceLabel(item)}
              leading={<Laptop color={tokens.colors.mutedForeground} size={20} />}
              onPress={() => props.onChoose(index)}
            />
          )}
        />
      </>
    )
  } else if (state.step === 'enter-code') {
    const submit = () => {
      if (typed.length === 6) props.onSubmitCode(typed)
    }
    content = (
      <>
        <Text style={page.title}>{t('Enter the Code')}</Text>
        <Direction {...pairingDirection(state)} />
        <Text style={page.body}>{t('Type the code shown on the computer you scanned.')}</Text>
        <TextInput
          style={[styles.input, page.codeInput]}
          value={typed}
          onChangeText={(value) => setTyped(value.replace(/\D/g, '').slice(0, 6))}
          onSubmitEditing={submit}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoFocus
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={tokens.colors.mutedForeground}
          accessibilityLabel={t('Enter the Code')}
        />
        {state.mismatch ? (
          <Text style={page.error}>{t('That code does not match. Check the computer screen and try again.')}</Text>
        ) : null}
      </>
    )
    action = (
      <View style={page.actions}>
        <Button label="Confirm" disabled={typed.length !== 6} onPress={submit} />
        <Button label="Cancel" variant="secondary" onPress={props.onCancel} />
      </View>
    )
  } else if (state.step === 'connecting' || state.step === 'working') {
    content = (
      <>
        <Direction {...pairingDirection(state)} />
        <View style={page.waiting}>
          <ActivityIndicator size="small" color={tokens.colors.mutedForeground} />
          <Text style={page.waitingLabel}>
            {t(state.step === 'connecting' ? 'Connecting to the desktop…' : 'Finishing pairing…')}
          </Text>
        </View>
      </>
    )
  } else if (state.step === 'done') {
    content = (
      <>
        <Text style={page.title}>{t('Desktops Paired')}</Text>
        <Direction {...pairingDirection(state)} />
        <Text style={page.body}>{t('The first desktop can now run tasks on the second.')}</Text>
      </>
    )
    action = <Button label="Done" onPress={props.onCancel} />
  } else {
    content = (
      <>
        <Text style={page.title}>{t('Pairing Failed')}</Text>
        <Text style={page.error}>{t(state.message)}</Text>
      </>
    )
    action = <Button label="Done" variant="secondary" onPress={props.onCancel} />
  }

  return (
    <View style={page.page}>
      <View style={page.center}>
        <Wordmark />
        {content}
      </View>
      {action}
    </View>
  )
}

/** Which desktop will run tasks on which: two device tiles joined by an arrow. */
function Direction(props: { controller: string; node: string }) {
  const page = usePageStyles()
  const { tokens } = useMobileTheme()
  const { t } = useMobileLocale()
  return (
    <View style={page.direction} accessible accessibilityLabel={`${props.controller} → ${props.node}`}>
      <DirectionDevice icon={Laptop} name={props.controller} />
      <View style={page.directionLink}>
        <Text style={page.directionLabel}>{t('Control')}</Text>
        <Svg width={56} height={12} viewBox="0 0 56 12" fill="none">
          <Path
            d="M1 6h53M49 1l5 5-5 5"
            stroke={tokens.colors.mutedForeground}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <DirectionDevice icon={Monitor} name={props.node} />
    </View>
  )
}

function DirectionDevice(props: { icon: LucideIcon; name: string }) {
  const page = usePageStyles()
  const { tokens } = useMobileTheme()
  const Icon = props.icon
  return (
    <View style={page.directionDevice}>
      <View style={page.directionIcon}>
        <Icon color={tokens.colors.foreground} size={22} />
      </View>
      <Text style={page.directionName} numberOfLines={1}>{props.name}</Text>
    </View>
  )
}

function usePageStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => StyleSheet.create({
    page: { flex: 1, paddingBottom: tokens.spacing.md, paddingHorizontal: tokens.spacing.xl },
    center: { flex: 1, justifyContent: 'center' },
    title: { color: tokens.colors.foreground, fontSize: 18, fontWeight: '700', marginTop: 24, textAlign: 'center' },
    body: { color: tokens.colors.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' },
    scanned: { color: tokens.colors.foreground, fontSize: 15, fontWeight: '600', marginTop: 16, textAlign: 'center' },
    list: { flexGrow: 0, marginTop: 16, maxHeight: 320 },
    codeInput: {
      alignSelf: 'center',
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      fontSize: 28,
      letterSpacing: 8,
      marginTop: 20,
      minWidth: 200,
      textAlign: 'center',
    },
    error: { color: tokens.colors.error, fontSize: 13, lineHeight: 19, marginTop: 12, textAlign: 'center' },
    actions: { gap: tokens.spacing.sm },
    waiting: { alignItems: 'center', flexDirection: 'row', gap: tokens.spacing.sm, justifyContent: 'center', marginTop: 32 },
    waitingLabel: { color: tokens.colors.mutedForeground, fontSize: 13 },
    direction: {
      alignItems: 'center',
      backgroundColor: tokens.colors.surface,
      borderColor: tokens.colors.border,
      borderRadius: tokens.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      marginTop: 16,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.lg,
    },
    directionDevice: { alignItems: 'center', flex: 1, gap: 4, minWidth: 0 },
    directionIcon: {
      alignItems: 'center',
      backgroundColor: tokens.colors.muted,
      borderRadius: tokens.radius.md,
      height: 44,
      justifyContent: 'center',
      marginBottom: 4,
      width: 44,
    },
    directionName: { color: tokens.colors.foreground, fontSize: 12, fontWeight: '600', maxWidth: '100%' },
    directionLink: { alignItems: 'center', gap: 4, paddingHorizontal: tokens.spacing.sm },
    directionLabel: { color: tokens.colors.mutedForeground, fontSize: 11, fontWeight: '600' },
  }), [tokens])
}
