import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { StatusBar } from 'expo-status-bar'
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'
import { CHAT_VIEW_HTML, TERMINAL_VIEW_HTML } from '@superone/chat-view'
import {
  loadPairings,
  memoryKv,
  parsePairQr,
  RelayClient,
  savePairings,
  startPairingHandshake,
  upsertPairing,
  type SavedPairing,
} from '@superone/relay-client'
import type { AskUserQuestionRequest, PlanApprovalRequest, RemoteCommand } from '@superone/shared/agent-types'
import { ChatRuntime } from './src/runtime'
import { TerminalRuntime } from './src/terminal-runtime'
import { randomId } from './src/ids'
import { CHAT_WINDOW } from './src/chat-window'
import { filterSlashCommands } from './src/slash'
import { extractMentionQuery, insertMention, type MentionItem } from './src/mentions'
import { styles } from './src/styles'
import { PermissionSheet, PlanSheet, QuestionSheet } from './src/sheets'

type Project = { path: string; name: string }
type SessionRow = { sessionId: string; title: string; lastActiveAt?: string; provider?: string }
type Screen = 'pair' | 'projects' | 'sessions' | 'chat' | 'terminal'

const kv = memoryKv()
const deviceId = randomId()

export default function App() {
  const [screen, setScreen] = useState<Screen>('pair')
  const [paste, setPaste] = useState('')
  const [lan, setLan] = useState('')
  const [status, setStatus] = useState('Paste a superone://pair QR or {relayUrl,secret} JSON')
  const [code, setCode] = useState<string | null>(null)
  const [pairings, setPairings] = useState<SavedPairing[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [termDraft, setTermDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [permMode, setPermMode] = useState('default')
  const [permModes, setPermModes] = useState<string[]>(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
  const [slashHits, setSlashHits] = useState<ReturnType<typeof filterSlashCommands>>([])
  const [mentionHits, setMentionHits] = useState<MentionItem[]>([])
  const [perm, setPerm] = useState<{ requestId: string; toolName: string } | null>(null)
  const [plan, setPlan] = useState<PlanApprovalRequest | null>(null)
  const [question, setQuestion] = useState<AskUserQuestionRequest | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const webRef = useRef<WebView>(null)
  const termRef = useRef<WebView>(null)
  const clientRef = useRef<RelayClient | null>(null)
  const runtimeRef = useRef<ChatRuntime | null>(null)
  const termRuntimeRef = useRef<TerminalRuntime | null>(null)
  const reconnecting = useRef(false)

  useEffect(() => { void loadPairings(kv).then(setPairings) }, [])

  const inject = (ref: RefObject<WebView | null>, msg: unknown) => {
    ref.current?.injectJavaScript(`window.__applyHost(${JSON.stringify(msg)});true;`)
  }

  const paint = useCallback((messages: unknown, todos?: unknown) => {
    inject(webRef, { type: 'applyReductionPatch', messages, todos })
  }, [])

  const syncSheets = (runtime: ChatRuntime) => {
    paint(runtime.session.messages, runtime.session.todos)
    setStreaming(runtime.streaming)
    setPermMode(runtime.permissionMode)
    const pending = runtime.session.pendingPermissions[0]
    setPerm(pending ? { requestId: pending.requestId, toolName: pending.toolName } : null)
    setPlan(runtime.session.pendingPlanApproval)
    setQuestion(runtime.session.pendingQuestion)
  }

  const rememberPairing = async (row: SavedPairing) => {
    const next = upsertPairing(await loadPairings(kv), row)
    await savePairings(kv, next)
    setPairings(next)
  }

  const connectWithSecret = async (relayUrl: string, secret: string, lanHostPort?: string, hostName?: string) => {
    const client = new RelayClient({
      onEvents: (events) => runtimeRef.current?.ingest(events),
      onTerminal: (payload) => termRuntimeRef.current?.ingest(payload),
      onReset: () => {
        setStatus('server reset — rehydrating')
        void runtimeRef.current?.reopen()
      },
      onShutdown: () => setStatus('desktop shut down'),
      onStatus: (ok) => {
        setStatus(ok ? 'connected' : 'disconnected')
        if (ok) {
          reconnecting.current = false
          return
        }
        if (reconnecting.current) return
        reconnecting.current = true
        setTimeout(() => {
          void client.reconnect()
            .then(() => runtimeRef.current?.reopen())
            .catch(() => { reconnecting.current = false })
        }, 1200)
      },
    })
    clientRef.current = client
    const hp = (lanHostPort ?? lan).trim()
    if (hp.includes(':')) {
      const [host, port] = hp.split(':')
      await client.connectLan(host, Number(port), secret)
    } else {
      await client.connectRelay({ relayUrl, masterSecret: secret, deviceId })
    }
    await rememberPairing({
      id: hostName || relayUrl,
      relayUrl,
      secret,
      hostName,
      lan: hp.includes(':') ? hp : undefined,
    })
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
        await connectWithSecret(paired.relayUrl || qr.relayUrl, paired.masterSecret, undefined, paired.hostName)
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

  const bindRuntime = (client: RelayClient) => {
    const runtime = new ChatRuntime(client, () => syncSheets(runtime))
    runtimeRef.current = runtime
    const term = new TerminalRuntime(client, (paints) => {
      for (const p of paints) inject(termRef, p)
    })
    termRuntimeRef.current = term
    return runtime
  }

  const openSession = async (row: SessionRow) => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    setSessionId(row.sessionId)
    const runtime = bindRuntime(client)
    setScreen('chat')
    await runtime.open(p.path, row.sessionId)
    const info = await runtime.loadSystemInfo(row.provider ?? 'claude')
    if (info.permissionModes?.length) setPermModes(info.permissionModes)
    else if (info.permissionPresets?.length) setPermModes(info.permissionPresets)
  }

  const createSession = async () => {
    const client = clientRef.current
    const p = project
    if (!client || !p) return
    const runtime = bindRuntime(client)
    const id = await runtime.create(p.path)
    setSessionId(id)
    setScreen('chat')
    const info = await runtime.loadSystemInfo('claude')
    if (info.permissionModes?.length) setPermModes(info.permissionModes)
  }

  const send = async () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    setSlashHits([])
    setMentionHits([])
    await runtimeRef.current?.send(text)
  }

  const onDraft = (text: string) => {
    setDraft(text)
    const runtime = runtimeRef.current
    setSlashHits(filterSlashCommands(text, runtime?.slashCommands ?? []))
    const q = extractMentionQuery(text, text.length)
    if (!q) {
      setMentionHits([])
      return
    }
    void runtime?.searchMentions(q.query).then((res) => {
      const items = (res.items ?? []).map((row) => {
        const r = row as Record<string, unknown>
        return {
          kind: String(r.kind ?? 'file'),
          path: String(r.path ?? r.name ?? ''),
          isDirectory: Boolean(r.isDirectory),
        }
      }).filter((m) => m.path)
      setMentionHits(items)
    })
  }

  const back = () => {
    if (screen === 'terminal') {
      setScreen('chat')
      return
    }
    if (screen === 'chat') {
      const sid = sessionId
      if (sid) clientRef.current?.send({ type: 'unsubscribe_session', sessionId: sid })
      setScreen('sessions')
      return
    }
    if (screen === 'sessions') setScreen('projects')
    if (screen === 'projects') setScreen('pair')
  }

  const openTerminal = () => {
    const p = project
    const runtime = runtimeRef.current
    const term = termRuntimeRef.current
    if (!p || !term) return
    setScreen('terminal')
    if (!term.terminalId) term.create(p.path, runtime?.sessionId)
  }

  const header = useMemo(() => {
    if (screen === 'projects') return 'Projects'
    if (screen === 'sessions') return project?.name ?? 'Sessions'
    if (screen === 'chat') return sessionId?.slice(0, 8) ?? 'Chat'
    if (screen === 'terminal') return termRuntimeRef.current?.title ?? 'Terminal'
    return 'SuperOne'
  }, [screen, project, sessionId])

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <View style={styles.top}>
        {screen !== 'pair' ? (
          <Pressable onPress={back}><Text style={styles.back}>Back</Text></Pressable>
        ) : <View />}
        <Text style={styles.title}>{header}</Text>
        {screen === 'chat' ? (
          <Pressable onPress={openTerminal}><Text style={styles.back}>Term</Text></Pressable>
        ) : null}
      </View>

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
          <TextInput
            style={styles.input}
            placeholder="optional LAN host:port"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            value={lan}
            onChangeText={setLan}
          />
          <Pressable style={styles.btn} onPress={() => void onPair()}>
            <Text style={styles.btnText}>Pair</Text>
          </Pressable>
          {code ? <Text style={styles.code}>{code}</Text> : null}
          {pairings.length ? (
            <FlatList
              data={pairings}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.row}
                  onPress={() => void connectWithSecret(item.relayUrl, item.secret, item.lan || lan, item.hostName)}
                >
                  <Text style={styles.rowTitle}>{item.hostName || item.relayUrl}</Text>
                  <Text style={styles.rowMeta}>{item.lan ?? item.relayUrl}</Text>
                </Pressable>
              )}
            />
          ) : null}
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
        <>
          <Pressable style={styles.btn} onPress={() => void createSession()}>
            <Text style={styles.btnText}>New session</Text>
          </Pressable>
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
        </>
      ) : null}

      {screen === 'chat' ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: CHAT_VIEW_HTML }}
            style={styles.flex}
            onMessage={(ev) => {
              try {
                const msg = JSON.parse(ev.nativeEvent.data) as { type?: string }
                if (msg.type === 'ready' && runtimeRef.current) syncSheets(runtimeRef.current)
              } catch { /* ignore */ }
            }}
          />
          <View style={styles.chips}>
            {permModes.map((mode) => (
              <Pressable
                key={mode}
                style={[styles.chip, permMode === mode ? styles.chipOn : null]}
                onPress={() => { setPermMode(mode); runtimeRef.current?.setPermissionMode(mode) }}
              >
                <Text style={styles.rowMeta}>{mode}</Text>
              </Pressable>
            ))}
          </View>
          {slashHits.length ? (
            <ScrollView style={styles.overlay}>
              {slashHits.slice(0, 8).map((hit) => (
                <Pressable
                  key={hit.command.name}
                  style={styles.row}
                  onPress={() => { setDraft(`/${hit.command.name} `); setSlashHits([]) }}
                >
                  <Text style={styles.rowTitle}>/{hit.command.name}</Text>
                  <Text style={styles.rowMeta}>{hit.command.description}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {mentionHits.length ? (
            <ScrollView style={styles.overlay}>
              {mentionHits.slice(0, 8).map((item) => (
                <Pressable
                  key={`${item.kind}:${item.path}`}
                  style={styles.row}
                  onPress={() => {
                    const q = extractMentionQuery(draft, draft.length)
                    if (q) setDraft(insertMention(draft, q, item))
                    setMentionHits([])
                  }}
                >
                  <Text style={styles.rowTitle}>{item.path}</Text>
                  <Text style={styles.rowMeta}>{item.kind}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              placeholder={streaming ? 'Streaming…' : 'Message'}
              placeholderTextColor="#52525b"
              value={draft}
              onChangeText={onDraft}
              onSubmitEditing={() => void send()}
              autoCorrect
            />
            {streaming ? (
              <Pressable style={styles.send} onPress={() => void runtimeRef.current?.interrupt()}>
                <Text style={styles.btnText}>Stop</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.send} onPress={() => void send()}>
                <Text style={styles.btnText}>Send</Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {screen === 'terminal' ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <WebView ref={termRef} originWhitelist={['*']} source={{ html: TERMINAL_VIEW_HTML }} style={styles.flex} />
          <View style={styles.composer}>
            <TextInput
              style={styles.composerInput}
              placeholder={termRuntimeRef.current?.writable === false ? 'read-only' : 'terminal input'}
              placeholderTextColor="#52525b"
              value={termDraft}
              onChangeText={setTermDraft}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => {
                const line = termDraft
                setTermDraft('')
                termRuntimeRef.current?.input(`${line}\n`)
              }}
            />
            <Pressable
              style={styles.send}
              onPress={() => {
                termRuntimeRef.current?.claim()
              }}
            >
              <Text style={styles.btnText}>Claim</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      <Text style={styles.meta}>{status} · window {CHAT_WINDOW.initialTurns}</Text>

      <PermissionSheet
        perm={perm}
        onAllow={(id) => void runtimeRef.current?.respondPermission(id, true)}
        onDeny={(id) => void runtimeRef.current?.respondPermission(id, false)}
      />
      <PlanSheet
        plan={plan}
        onApprove={(id) => void runtimeRef.current?.respondPlan(id, true)}
        onReject={(id) => void runtimeRef.current?.respondPlan(id, false, 'rejected from mobile')}
      />
      <QuestionSheet
        question={question}
        answers={answers}
        onPick={(header, label) => setAnswers((prev) => ({ ...prev, [header]: label }))}
        onSubmit={(id) => void runtimeRef.current?.answerQuestion(id, answers)}
        onDismiss={(id) => void runtimeRef.current?.dismissQuestion(id)}
      />
    </View>
  )
}
