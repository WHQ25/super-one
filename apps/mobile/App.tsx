import { useMemo, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { buildLanWsUrl, buildRelayWsUrl } from '@superone/relay-client'
import { CHAT_WINDOW } from './src/chat-window'

export default function App() {
  const [relayUrl, setRelayUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [hostPort, setHostPort] = useState('')
  const [status, setStatus] = useState('Not paired')

  const batch = useMemo(() => AGENT_EVENT_BATCH_MS, [])

  const pairRelay = async () => {
    try {
      const built = await buildRelayWsUrl({
        relayUrl: relayUrl.trim(),
        masterSecret: secret.trim(),
        role: 'mobile',
        deviceId: 'expo-dev',
      })
      setStatus(`relay ready · room in URL · ${built.channelKeyHex.slice(0, 8)}…`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'pair failed')
    }
  }

  const pairLan = () => {
    const [host, port] = hostPort.trim().split(':')
    if (!host || !port) {
      setStatus('host:port required')
      return
    }
    setStatus(buildLanWsUrl(host, Number(port)))
  }

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <Text style={styles.title}>SuperOne</Text>
      <Text style={styles.body}>Remote Control · Expo</Text>
      <TextInput
        style={styles.input}
        placeholder="wss://relay.example/session"
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        value={relayUrl}
        onChangeText={setRelayUrl}
      />
      <TextInput
        style={styles.input}
        placeholder="master secret (from QR)"
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        value={secret}
        onChangeText={setSecret}
      />
      <Pressable style={styles.btn} onPress={() => void pairRelay()}>
        <Text style={styles.btnText}>Pair via relay</Text>
      </Pressable>
      <TextInput
        style={styles.input}
        placeholder="LAN host:port (optional)"
        placeholderTextColor="#52525b"
        autoCapitalize="none"
        value={hostPort}
        onChangeText={setHostPort}
      />
      <Pressable style={styles.btn} onPress={pairLan}>
        <Text style={styles.btnText}>Use LAN address</Text>
      </Pressable>
      <Text style={styles.meta}>{status}</Text>
      <Text style={styles.meta}>batch {batch} ms · window {CHAT_WINDOW.initialTurns}/{CHAT_WINDOW.maxMountedTurns}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111111',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: '#f4f4f5', fontSize: 28, fontWeight: '600', marginBottom: 8 },
  body: { color: '#a1a1aa', fontSize: 16, marginBottom: 24 },
  input: {
    borderWidth: 1,
    borderColor: '#3f3f46',
    borderRadius: 8,
    color: '#f4f4f5',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  btn: {
    backgroundColor: '#3f3f46',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  btnText: { color: '#f4f4f5', fontWeight: '600' },
  meta: { color: '#a1a1aa', fontSize: 13, marginTop: 4 },
})
