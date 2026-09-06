import { useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { MentionSuggestions } from '../ui/composer-suggestions'
import { extractMentionQuery, type MentionItem } from '../mentions'
import { selectNativeMention } from '../mention-selection'
import { useMentionArtwork } from '../ui/mention-artwork'
import { NativeMentionEditor, nativeMentionEditorAvailable } from '../ui/native-mention-editor'
import type { MentionEditorCommand, MentionEditorSnapshot } from '../mention-editor-state'
import { Button } from '../ui'
import { useMobileTheme } from '../theme/context'
import { nativeMentionSpans, nativeMentionText, serializeMentionDocument, type MentionDocument } from '../mention-document'
import { mentionGlyphArtwork } from '../ui/mention-glyph-data'
import { rememberMentionArtwork } from '../ui/mention-dynamic-artwork'

const fixture: MentionDocument = [{ text: '检查 ' }, { mention: { kind: 'file', value: 'src/app.ts', displayName: 'app.ts' } }, { text: ' 然后请 ' }, { mention: { kind: 'agent-profile', value: 'codex-base', displayName: 'Codex' } }, { text: ' 帮忙。' }]
const suggestions: MentionItem[] = [
  { kind: 'file', path: 'src/中文 file.ts', label: '中文 file.ts' },
  { kind: 'directory', path: 'src', label: 'src' },
  { kind: 'agent-profile', path: 'codex-base', label: 'Codex' },
  { kind: 'builtin', path: 'debug', label: 'Debug' },
  { kind: 'miniapp', path: 'board', label: 'Board' },
  { kind: 'desktop-app', path: 'com.example.Editor', label: 'Editor' },
]
const initial: MentionEditorCommand = { id: 0, eventCount: 0, start: 0, end: 0, text: nativeMentionText(fixture), tokens: nativeMentionSpans(fixture) }

/** Native feasibility fixture, intentionally separate from the shipping composer. */
export function MentionEditorPreview() {
  const { tokens: { colors, scheme } } = useMobileTheme()
  const [submit, setSubmit] = useState(false)
  const [submissions, setSubmissions] = useState(0)
  const [command, setCommand] = useState(initial)
  const [snapshot, setSnapshot] = useState<MentionEditorSnapshot>({ document: [], text: '', tokens: [], eventCount: 0, start: 0, end: 0, composing: false })
  const artwork = useMentionArtwork(snapshot.tokens)
  const query = !snapshot.composing && snapshot.start === snapshot.end ? extractMentionQuery(snapshot.text, snapshot.end) : null
  const matches = query ? suggestions.filter((item) => `${item.label} ${item.path}`.toLowerCase().includes(query.query.toLowerCase())) : []
  const [serialized, setSerialized] = useState('')
  const [error, setError] = useState('')
  if (!nativeMentionEditorAvailable) return <Text style={{ color: colors.mutedForeground, padding: 16 }}>The native chip prototype requires a rebuilt development client.</Text>
  return <View style={{ padding: 16, gap: 12 }}>
    <Text style={{ color: colors.mutedForeground }}>Native editing prototype · artwork and accessibility review pending</Text>
    <Button label={submit ? 'Return: submit' : 'Return: newline'} onPress={() => setSubmit(!submit)} />
    <Text style={{ color: colors.mutedForeground }}>Keyboard submissions: {submissions}</Text>
    <NativeMentionEditor command={command} submitBehavior={submit ? 'submit' : 'newline'} onSubmit={(value) => {
      setSerialized(serializeMentionDocument(value.document)); setSubmissions((count) => count + 1)
    }} autoSize={{ minHeight: 42, maxHeight: 144 }}
      onChange={(value) => { setSnapshot(value); setError('') }} onError={setError}
      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12 }} />
    <MentionSuggestions items={matches} onSelect={(item) => {
      const next = selectNativeMention(snapshot, item, command.id + 1)
      if (next) setCommand(next)
    }} />
    <Button label="Start mention query" disabled={snapshot.composing} onPress={() => setCommand({
      id: command.id + 1, eventCount: snapshot.eventCount, start: snapshot.start, end: snapshot.end,
      text: ' @', tokens: [],
    })} />
    <Button label="Insert file at selection" disabled={snapshot.composing} onPress={() => setCommand({
      id: command.id + 1, eventCount: snapshot.eventCount, start: snapshot.start, end: snapshot.end,
      text: '\uFFFC ', tokens: [{ offset: 0, kind: 'file', value: 'src/中文 file.ts', displayName: '中文 file.ts' }],
    })} />
    <Button label="Load multiline draft" disabled={snapshot.composing} onPress={() => setCommand({
      id: command.id + 1, eventCount: snapshot.eventCount, start: 0, end: snapshot.text.length,
      text: Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join('\n'), tokens: [],
    })} />
    <Button label="Clear draft" disabled={snapshot.composing} onPress={() => setCommand({
      id: command.id + 1, eventCount: snapshot.eventCount, start: 0, end: snapshot.text.length, text: '', tokens: [],
    })} />
    <Button label="Load identity glyphs" disabled={snapshot.composing} onPress={() => {
      const kinds = ['agent', 'directory', 'session', 'computer', 'browser', 'widget', 'debug'] as const
      const document: MentionDocument = kinds.flatMap((kind) => [
        { mention: { kind, value: kind === 'directory' ? 'src' : kind, displayName: kind } }, { text: ' ' },
      ])
      setCommand({ id: command.id + 1, eventCount: snapshot.eventCount, start: 0, end: snapshot.text.length, text: nativeMentionText(document), tokens: nativeMentionSpans(document) })
    }} />
    <Button label="Load provider brands" disabled={snapshot.composing} onPress={() => {
      const refs = [['claude-base', 'Claude'], ['codex-review', 'Codex'], ['acp-base:grok-build', 'Grok'], ['opencode-base', 'OpenCode'], ['cursor-base', 'Cursor'], ['dsh-base', 'DeepSeek'], ['acp-base:custom', 'ACP'], ['future-base', 'Future']] as const
      const document: MentionDocument = refs.flatMap(([value, displayName]) => [
        { mention: { kind: 'agent-profile' as const, value, displayName } }, { text: ' ' },
      ])
      setCommand({ id: command.id + 1, eventCount: snapshot.eventCount, start: 0, end: snapshot.text.length, text: nativeMentionText(document), tokens: nativeMentionSpans(document) })
    }} />
    <Button label="Load app identities" disabled={snapshot.composing} onPress={() => {
      const dynamicLogo = mentionGlyphArtwork('widget', scheme, colors.foreground)
      if (dynamicLogo) rememberMentionArtwork({ kind: 'miniapp', path: 'board', iconPng: dynamicLogo })
      const document: MentionDocument = [
        { mention: { kind: 'miniapp', value: 'board', displayName: 'Board' } }, { text: ' ' },
        { mention: { kind: 'miniapp', value: 'missing-logo', displayName: 'Default app' } }, { text: ' ' },
        { mention: { kind: 'desktop-app', value: 'com.example.Editor', displayName: 'Editor' } },
      ]
      setCommand({ id: command.id + 1, eventCount: snapshot.eventCount, start: 0, end: snapshot.text.length, text: nativeMentionText(document), tokens: nativeMentionSpans(document) })
    }} />
    <Text style={{ color: colors.mutedForeground }}>Selection {snapshot.start}–{snapshot.end} · {snapshot.tokens.length} chips · {artwork.length} images · event {snapshot.eventCount} · {snapshot.composing ? 'composing' : 'committed'}</Text>
    <Button label="Inspect serialized draft" onPress={() => {
      try { setSerialized(serializeMentionDocument(snapshot.document)) }
      catch (error) { setSerialized(error instanceof Error ? error.message : 'Invalid native snapshot') }
    }} />
    {serialized ? <Text selectable style={{ color: colors.foreground }}>{serialized}</Text> : null}
    {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
    {snapshot.rejection ? <Text style={{ color: colors.destructive }}>{snapshot.rejection}</Text> : null}
  </View>
}
