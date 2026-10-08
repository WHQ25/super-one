import { useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { PasteChipEditor, PasteChipEditorDialog } from './paste-chip-editor'
import { Button } from './primitives'
import { Text } from './text'

function Preview({ text = 'First line\nSecond line', fail = false, pending = false, width = 360 }: {
  text?: string; fail?: boolean; pending?: boolean; width?: number
}) {
  const { tokens: { colors } } = useMobileTheme()
  const [result, setResult] = useState('')
  return <View style={{ width, backgroundColor: colors.background }}>
    <PasteChipEditor text={text} onApply={async (next, expand) => {
      if (pending) return new Promise(() => {})
      if (fail) return false
      setResult(`${expand ? 'Plain text' : 'Paste chip'}: ${next}`)
      return true
    }} onClose={() => {}} />
    {result ? <Text>{result}</Text> : null}
  </View>
}

export default { title: 'Mobile/PasteChipEditor', component: PasteChipEditor }
export const Editable = { render: () => <MobileThemeProvider><Preview /></MobileThemeProvider> }
export const Dark = { render: () => <MobileThemeProvider colorScheme="dark"><Preview /></MobileThemeProvider> }
export const Empty = { render: () => <MobileThemeProvider><Preview text="" /></MobileThemeProvider> }
export const Pending = { render: () => <MobileThemeProvider><Preview pending /></MobileThemeProvider> }
export const SaveRejected = { render: () => <MobileThemeProvider><Preview fail /></MobileThemeProvider> }
export const ChineseNarrow = { render: () => <MobileThemeProvider locale="zh"><Preview width={280} text={'粘贴的长文本\n'.repeat(40)} /></MobileThemeProvider> }
export const LightChineseNarrow = { render: () => <MobileThemeProvider colorScheme="light" locale="zh"><Preview width={280} text={'粘贴的长文本\n'.repeat(40)} /></MobileThemeProvider> }

function DialogPreview() {
  const [chip, setChip] = useState<{ value: string; offset: number } | null>({ value: 'First line\nSecond line', offset: 0 })
  return <View style={{ flex: 1 }}>
    <Button label="Open pasted text" onPress={() => setChip({ value: 'First line\nSecond line', offset: 0 })} />
    <PasteChipEditorDialog chip={chip} onDismiss={() => setChip(null)} onApply={async () => true} />
  </View>
}
export const CenteredDialog = { render: () => <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
  <MobileThemeProvider colorScheme="dark"><DialogPreview /></MobileThemeProvider>
</SafeAreaProvider> }
