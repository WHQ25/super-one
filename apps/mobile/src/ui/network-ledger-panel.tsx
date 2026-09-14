import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { TransportLedger } from '@superone/relay-client/transport-ledger'
import { Text } from './text'
import { Button } from './primitives'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

export function NetworkLedgerPanel({ ledger }: { ledger: TransportLedger }) {
  const [snapshot, setSnapshot] = useState(() => ledger.snapshot())
  const { tokens: { colors } } = useMobileTheme()
  const { locale } = useMobileLocale()
  useEffect(() => {
    const timer = setInterval(() => setSnapshot(ledger.snapshot()), 1000)
    return () => clearInterval(timer)
  }, [ledger])
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: colors.foreground }}>{locale === 'zh' ? '开发者：网络计量' : 'Developer: network ledger'}</Text>
    <Text style={{ color: colors.mutedForeground }}>{snapshot.moment} · {locale === 'zh' ? '次数 / 字节 / 毫秒' : 'count / bytes / ms'}</Text>
    {snapshot.rows.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{locale === 'zh' ? '暂无网络流量' : 'No network traffic yet'}</Text> : null}
    {snapshot.rows.map(row => <View key={`${row.kind}:${row.name}:${row.transport}`} style={{ gap: 2 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{row.kind} · {row.name} · {row.transport ?? ''}</Text>
      <Text style={{ color: colors.foreground, fontSize: 12 }}>{row.count} / {row.bytes.toLocaleString()} / {Math.round(row.durationMs)}</Text>
    </View>)}
    <Button label={locale === 'zh' ? '重置计量' : 'Reset metrics'} variant="secondary" onPress={() => { ledger.reset(); setSnapshot(ledger.snapshot()) }} />
  </View>
}
