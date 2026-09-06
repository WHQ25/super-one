import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { checkLanReachable } from '@superone/relay-client'
import { Text } from '../ui/text'
import { Button, ListRow } from '../ui'
import { LanBrowser } from '../lan-browser'
import type { LanService } from '../device-discovery'
import { useMobileTheme } from '../theme/context'

type ProbeResult = { reachable: boolean; ms: number }

/**
 * Diagnostic for the native Bonjour module. The offline fixtures cannot exercise
 * it, so this page browses the real network: it is the only way to see whether the
 * development client has the module linked, whether the desktop's TXT record
 * parses, and whether the resolved address answers the LAN server's HTTP probe.
 */
export function LanBrowserPreview() {
  const styles = useStyles()
  const { tokens } = useMobileTheme()
  const [services, setServices] = useState<LanService[]>([])
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({})
  const [error, setError] = useState('')
  const browserRef = useRef<LanBrowser | null>(null)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    const browser = new LanBrowser(() => {
      setServices(browser.services())
    })
    browserRef.current = browser
    setSupported(browser.isSupported)
    browser.ensureBrowsing()
      .then(() => setServices(browser.services()))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    return () => browser.stop()
  }, [])

  const probeAll = async () => {
    const results: Record<string, ProbeResult> = {}
    for (const service of services) {
      const started = Date.now()
      const reachable = await checkLanReachable({ host: service.host, port: service.port })
      results[service.roomId] = { reachable, ms: Date.now() - started }
    }
    setProbes(results)
  }

  return (
    <View style={styles.page}>
      <Text style={styles.heading} testID="lan-browser-support">
        {supported ? 'Native browser linked' : 'Native browser missing — relay only'}
      </Text>
      <Text style={styles.body}>
        {services.length ? `${services.length} desktop(s) advertising _superone._tcp` : 'Searching…'}
      </Text>
      {error ? <Text style={[styles.body, { color: tokens.colors.error }]}>{error}</Text> : null}
      <ScrollView style={styles.list}>
        {services.map((service) => {
          const probe = probes[service.roomId]
          return (
            <ListRow
              key={service.roomId}
              title={service.hostName ?? service.roomId.slice(0, 8)}
              subtitle={[
                `${service.host}:${service.port}`,
                `room ${service.roomId.slice(0, 8)}…`,
                probe ? `${probe.reachable ? 'reachable' : 'no answer'} · ${probe.ms}ms` : 'not probed',
              ].join('  ·  ')}
            />
          )
        })}
      </ScrollView>
      <Button
        label="Probe reachability"
        disabled={services.length === 0}
        onPress={() => void probeAll()}
      />
    </View>
  )
}

function useStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => StyleSheet.create({
    page: { flex: 1, gap: tokens.spacing.sm, padding: tokens.spacing.md },
    heading: { color: tokens.colors.foreground, fontSize: 15, fontWeight: '600' },
    body: { color: tokens.colors.mutedForeground, fontSize: 13 },
    list: { flex: 1 },
  }), [tokens])
}
