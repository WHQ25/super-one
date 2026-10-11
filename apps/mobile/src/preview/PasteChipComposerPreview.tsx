import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useComposerDraft } from '../navigation/use-composer-draft'
import { useComposerSend } from '../navigation/use-composer-send'
import { NativeComposerInput } from '../ui/native-composer-input'
import { nativeMentionEditorAvailable } from '../ui/native-mention-editor'
import { useMobileTheme } from '../theme/context'
import { Button } from '../ui'
import { Text } from '../ui/text'
import { linkOrigin } from '../link-favicons'
import { mentionGlyphArtwork } from '../ui/mention-glyph-data'
import type { FaviconResolver } from '../ui/use-link-favicons'

const document = [{ text: 'Before ' }, { paste: 'A short paste' }, { text: ' after\n' }, { paste: 'Long pasted text\n'.repeat(20) }]

const linksText = 'Docs at https://github.com/superone/app/blob/main/README.md, a site without an icon https://no-icon.example/path, '
  + 'and a long one https://example.com/' + 'segment/'.repeat(12) + ' done.'

/** Offline favicons: GitHub answers with its generated glyph, every other site with none (the globe). */
function previewFavicon(foreground: string): FaviconResolver {
  return async (href, isDark) => {
    const png = linkOrigin(href) === 'https://github.com' ? mentionGlyphArtwork('github', isDark ? 'dark' : 'light', foreground) : undefined
    return png ? `data:image/png;base64,${png}` : null
  }
}

/** Shipping native composer and send capture, without a live model or connection. */
export function PasteChipComposerPreview() {
  const draft = useComposerDraft()
  const { tokens: { colors } } = useMobileTheme()
  const [feedback, setFeedback] = useState('Tap a paste chip to edit, copy or expand it. System Paste creates a new chip.')
  useEffect(() => { draft.replaceWith({ text: '', document, insertions: [] }) }, [])
  const send = useComposerSend(draft.editorRef, 'paste-preview', () => {
    const sent = draft.capture()
    setFeedback(JSON.stringify(sent.userMessageContent.map(block => block.type === 'text'
      ? { text: block.text, isPaste: block.isPaste } : block), null, 2))
  }, setFeedback)
  if (!nativeMentionEditorAvailable) return <Text>A rebuilt native client is required for this preview.</Text>
  return <View style={{ padding: 16, gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: 16 }}>Paste chip composer</Text>
    <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12 }}>
      <NativeComposerInput key={draft.generation} binding={{ controller: draft.editorRef, document: draft.document.current,
        generation: draft.generation, onChange: draft.accept, onError: setFeedback, resolveFavicon: previewFavicon(colors.foreground) }} tablet={false} editable placeholder="Type or paste text…" onSubmit={() => void send()} />
    </View>
    <Button label="Inspect sent paste marks" onPress={() => void send()} />
    <Button label="Load links draft" onPress={() => draft.replaceWith({ text: linksText, document: [{ text: linksText }], insertions: [] })} />
    <Button label="Load long ordinary text" onPress={() => draft.replaceWith({ text: 'Typed line\n'.repeat(12), document: [{ text: 'Typed line\n'.repeat(12) }], insertions: [] })} />
    <Button label="Load long Chinese paste" onPress={() => draft.replaceWith({ text: '', document: [{ text: 'Before ' },
      { paste: '这是一段用于检查粘贴标签换行和编辑窗口的中文内容。'.repeat(5) }, { text: ' after' }], insertions: [] })} />
    <Text selectable style={{ color: colors.mutedForeground, fontSize: 12 }}>{feedback}</Text>
  </View>
}
