import { useCallback, useMemo, useRef, useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML } from '@superone/chat-view'
import {
  parsePairQr,
  RelayClient,
  startPairingHandshake,
} from '@superone/relay-client'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { ChatRuntime } from './src/runtime'
import { randomId } from './src/ids'
import { CHAT_WINDOW } from './src/chat-window'

type Project = { path: string; name: string }
type SessionRow = { sessionId: string; title: string; lastActiveAt?: string; provider?: string }

const deviceId = randomId()

export default function App() {
  const [screen, setScreen] = useState<'pair' | 'projects' | 'sessions' | 'chat'>('pair')
  const [paste, setPaste] = useState('')
  const [status, setStatus] = useState('Paste a superone://pair QR or {relayUrl,secret} JSON')
  const [code, setCode] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [perm, setPerm] = useState<{ requestId: string; toolName: string } | null>(null)
  const webRef = useRef<WebView>(null)
  const clientRef = useRef<RelayClient | null>(null)
  const runtimeRef = useRef<ChatRuntime | null>(null)

  const paint = useCallback((messages: unknown) => {
    const js = `window.__applyHost(${JSON.stringify({ type: 'applyReductionPatch', messages })});true;`
    webRef.current?.injectJavaScript(js)
  }, [])

  const connectWithSecret = async (relayUrl: string, secret: string) => {
    const client = new RelayClient({
      onEvents: (events) => runtimeRef.current?.ingest(events),
      onReset: () => setStatus('server reset — reopen the session'),
      onShutdown: () => setStatus('desktop shut down'),
      onStatus: (ok) => setStatus(ok ? 'connected' : 'disconnected'),
    })
    clientRef.current = client
    await client.connectRelay({ relayUrl, masterSecret: secret, deviceId })
    const res = await client.request({ type: 'list_projects', requestId: randomId() } as RemoteCommand) as {
      projects?: Project[]
      error?: string
    }
    if (res.error) throw new Error(res.error)
    setProjects(res.projects ?? [])
    setScreen('projects')
    setStatus(`${res.projects?.length ?? 0} projects`)
  }

  const onPair = async () => {
    const raw = paste.trim()
    try {
      if (raw.startsWith('superone://pair')) {
        const qr = parsePairQr(raw)
        const { code: c, done } = startPairingHandshake({
          qr,
          mobileDeviceId: deviceId,
          deviceName: 'Expo',
          openSocket: (url) => new WebSocket(url) as never,
        })
        setCode(c)
        setStatus('Confirm this code on the desktop')
        const paired = await done
        await connectWithSecret(paired.relayUrl || qr.relayUrl, paired.masterSecret)
        return
      }
      const json = JSON.parse(raw) as { relayUrl?: string; secret?: string; url?: string }
      const url = json.relayUrl ?? json.url
      if (!url || !json.secret) throw new Error('JSON needs relayUrl and secret')
      await connectWithSecret(url, json.secret)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'pair failed')
    }
  }

  const openProject = async (p: Project) => {
    const client = clientRef.current
    if (!client) return
    setProject(p)
    const res = await client.request({
      type: 'list_sessions',
      requestId: randomId(),
      projectPath: p.path,
      limit: 30,
      offset: 0,
    } as RemoteCommand) as { sessions?: SessionRow[]; error?: string }
    if (res.error) {
      setStatus(res.error)
      return
    }
    setSessions(res.sessions ?? [])
    setScreen('sessions')
  }

  const openSession = async (row: SessionRow) => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    setSessionId(row.sessionId)
    const runtime = new ChatRuntime(client, (s) => {
      paint(s.messages)
      const pending = s.pendingPermissions[0]
      setPerm(pending ? { requestId: pending.requestId, toolName: pending.toolName } : null)
    })
    runtimeRef.current = runtime
    setScreen('chat')
    await runtime.open(p.path, row.sessionId)
  }

  const send = async () => {
    const text = draft.trim()
    const client = clientRef.current
    const p = project
    const sid = sessionId
    if (!text || !client || !p || !sid) return
    setDraft('')
    await runtimeRef.current?.send(p.path, sid, text)
  }

  const decide = async (ok: boolean) => {
    if (!perm || !sessionId) return
    await runtimeRef.current?.respondPermission(sessionId, perm.requestId, ok)
    setPerm(null)
  }

  const header = useMemo(() => {
    if (screen === 'projects') return 'Projects'
    if (screen === 'sessions') return project?.name ?? 'Sessions'
    if (screen === 'chat') return sessionId?.slice(0, 8) ?? 'Chat'
    return 'SuperOne'
  }, [screen, project, sessionId])

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <Text style={styles.title}>{header}</Text>
      {screen === 'pair' ? (
        <>
          <TextInput
            style={[styles.input, styles.multi]}
            placeholder="superone://pair?…  or  {&quot;relayUrl&quot;,&quot;secret&quot;}"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            multiline
            value={paste}
            onChangeText={setPaste}
          />
          <Pressable style={styles.btn} onPress={() => void onPair()}>
            <Text style={styles.btnText}>Pair</Text>
          </Pressable>
          {code ? <Text style={styles.code}>{code}</Text> : null}
        </>
      ) : null}
      {screen === 'projects' ? (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.path}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => void openProject(item)}>
              <Text style={styles.rowTitle}>{item.name}</Text>
              <Text style={styles.rowMeta}>{item.path}</Text>
            </Pressable>
          )}
        />
      ) : null}
      {screen === 'sessions' ? (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.sessionId}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => void openSession(item)}>
              <Text style={styles.rowTitle}>{item.title || item.sessionId.slice(0, 8)}</Text>
              <Text style={styles.rowMeta}>{item.provider ?? ''} {item.lastActiveAt ?? ''}</Text>
            </Pressable>
          )}
        />
      ) : null}
      {screen === 'chat' ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: CHAT_VIEW_HTML }}
            style={styles.flex}
            onMessage={() => {}}
          />
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              placeholder="Message"
              placeholderTextColor="#52525b"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => void send()}
            />
            <Pressable style={styles.send} onPress={() => void send()}>
              <Text style={styles.btnText}>Send</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}
      <Text style={styles.meta}>{status} · window {CHAT_WINDOW.initialTurns}</Text>
      <Modal visible={!!perm} transparent animationType="fade">
        <View style={styles.modal}>
          <Text style={styles.rowTitle}>Allow {perm?.toolName}?</Text>
          <Pressable style={styles.btn} onPress={() => void decide(true)}><Text style={styles.btnText}>Allow</Text></Pressable>
          <Pressable style={styles.btn} onPress={() => void decide(false)}><Text style={styles.btnText}>Deny</Text></Pressable>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111111', paddingTop: 56, paddingHorizontal: 16 },
  flex: { flex: 1 },
  title: { color: '#f4f4f5', fontSize: 24, fontWeight: '600', marginBottom: 12 },
  input: {
    borderWidth: 1, borderColor: '#3f3f46', borderRadius: 8, color: '#f4f4f5',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10,
  },
  multi: { minHeight: 88, textAlignVertical: 'top' },
  btn: { backgroundColor: '#3f3f46', borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#f4f4f5', fontWeight: '600' },
  code: { color: '#f4f4f5', fontSize: 32, letterSpacing: 8, textAlign: 'center', marginVertical: 16 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#27272a' },
  rowTitle: { color: '#f4f4f5', fontSize: 16 },
  rowMeta: { color: '#71717a', fontSize: 12, marginTop: 4 },
  composer: { flexDirection: 'row', gap: 8, paddingVertical: 8, alignItems: 'center' },
  composerInput: {
    flex: 1, borderWidth: 1, borderColor: '#3f3f46', borderRadius: 8, color: '#f4f4f5',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  send: { backgroundColor: '#3f3f46', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12 },
  meta: { color: '#71717a', fontSize: 12, paddingVertical: 8 },
  modal: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 24 },
})
