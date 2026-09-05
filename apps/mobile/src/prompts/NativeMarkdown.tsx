import { useMemo, useState, type ReactNode } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import { Lexer, type Token, type Tokens } from 'marked'
import { useMobileTheme } from '../theme/context'
import { runUiAction } from '../ui-action'
import { monospace, usePromptStyles } from './styles'

/** Parse with the same CommonMark/GFM lexer on every platform; paint native text. */
export function NativeMarkdown({ content }: { content: string }) {
  const tokens = useMemo(() => Lexer.lex(content, { gfm: true }), [content])
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const [error, setError] = useState('')
  const openLink = (url: string) => {
    if (!/^https?:\/\//i.test(url)) { setError('This link cannot be opened on mobile.'); return }
    runUiAction(() => Linking.openURL(url), setError, 'Unable to open link')
  }
  function inline(items: Token[]): ReactNode {
    return items.map((token, index) => {
      switch (token.type) {
        case 'strong': return <Text key={index} style={{ fontWeight: '700' }}>{inline((token as Tokens.Strong).tokens)}</Text>
        case 'em': return <Text key={index} style={{ fontStyle: 'italic' }}>{inline((token as Tokens.Em).tokens)}</Text>
        case 'del': return <Text key={index} style={{ textDecorationLine: 'line-through' }}>{inline((token as Tokens.Del).tokens)}</Text>
        case 'codespan': return <Text key={index} style={{ fontFamily: monospace, backgroundColor: colors.muted }}>{(token as Tokens.Codespan).text}</Text>
        case 'br': return '\n'
        case 'link': {
          const link = token as Tokens.Link
          return <Text key={index} accessibilityRole="link" onPress={() => openLink(link.href)} style={{ color: colors.primary, textDecorationLine: 'underline' }}>{inline(link.tokens)}</Text>
        }
        case 'image': {
          const image = token as Tokens.Image
          return <Text key={index} accessibilityRole="link" onPress={() => openLink(image.href)} style={{ color: colors.primary }}>{image.text || 'Image'}</Text>
        }
        default: return 'tokens' in token && token.tokens ? <Text key={index}>{inline(token.tokens)}</Text> : 'text' in token ? String(token.text) : token.raw
      }
    })
  }
  function blocks(items: Token[]): ReactNode {
    return items.map((token, index) => {
      switch (token.type) {
        case 'space': case 'def': return null
        case 'heading': {
          const heading = token as Tokens.Heading
          return <Text key={index} selectable accessibilityRole="header" style={[styles.title, { fontSize: heading.depth === 1 ? 21 : heading.depth === 2 ? 18 : 15, lineHeight: heading.depth <= 2 ? 28 : 23, marginTop: index ? 8 : 0 }]}>{inline(heading.tokens)}</Text>
        }
        case 'paragraph': case 'text': {
          const paragraph = token as Tokens.Paragraph
          return <Text key={index} selectable style={styles.body}>{paragraph.tokens ? inline(paragraph.tokens) : paragraph.text}</Text>
        }
        case 'code': {
          const code = token as Tokens.Code
          return <View key={index} style={styles.card}>{code.lang ? <Text style={styles.label}>{code.lang}</Text> : null}<ScrollView horizontal><Text selectable style={styles.code}>{code.text}</Text></ScrollView></View>
        }
        case 'blockquote': return <View key={index} style={[styles.note, styles.tight]}>{blocks((token as Tokens.Blockquote).tokens)}</View>
        case 'list': {
          const list = token as Tokens.List
          return <View key={index} style={styles.tight}>{list.items.map((item, row) => <View key={row} style={[styles.row, { alignItems: 'flex-start' }]}>
            <Text style={styles.body}>{item.task ? item.checked ? '☑' : '☐' : list.ordered ? `${Number(list.start) + row}.` : '•'}</Text>
            <View style={[styles.grow, styles.tight]}>{blocks(item.tokens)}</View>
          </View>)}</View>
        }
        case 'table': {
          const table = token as Tokens.Table
          return <ScrollView key={index} horizontal><View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: 'hidden' }}>
            {[table.header, ...table.rows].map((row, rowIndex) => <View key={rowIndex} style={{ flexDirection: 'row', backgroundColor: rowIndex === 0 ? colors.muted : undefined }}>
              {row.map((cell, col) => <View key={col} style={{ width: 150, padding: 8, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.border }}><Text selectable style={[styles.body, { fontWeight: rowIndex === 0 ? '600' : '400', textAlign: table.align[col] ?? 'left' }]}>{inline(cell.tokens)}</Text></View>)}
            </View>)}
          </View></ScrollView>
        }
        case 'hr': return <View key={index} style={styles.divider} />
        // Raw HTML stays literal native text; it never executes in a document.
        default: return <Text key={index} selectable style={styles.body}>{token.raw}</Text>
      }
    })
  }
  return <View style={styles.tight}>{blocks(tokens)}{error ? <Text accessibilityRole="alert" style={styles.warningText}>{error}</Text> : null}</View>
}
