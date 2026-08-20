import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import { CHAT_WINDOW } from './src/chat-window'

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <Text style={styles.title}>SuperOne</Text>
      <Text style={styles.body}>Remote Control · Expo dev client</Text>
      <Text style={styles.meta}>shared batch {AGENT_EVENT_BATCH_MS} ms</Text>
      <Text style={styles.meta}>
        window {CHAT_WINDOW.initialTurns}/{CHAT_WINDOW.maxMountedTurns} turns
      </Text>
      <Text style={styles.hint}>Pair by QR or paste a host:port. mDNS is not required.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#f4f4f5',
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 8,
  },
  body: {
    color: '#a1a1aa',
    fontSize: 16,
    marginBottom: 24,
  },
  meta: {
    color: '#d4d4d8',
    fontSize: 14,
    marginBottom: 4,
  },
  hint: {
    color: '#71717a',
    fontSize: 13,
    marginTop: 24,
    textAlign: 'center',
  },
})
