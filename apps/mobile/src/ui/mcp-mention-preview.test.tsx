import { expect, jest, test } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { encodeMcpMentionValue, type McpMentionReadResource } from '@superone/shared/mcp-app-mentions'
import { MobileThemeProvider } from '../theme/context'
import { McpMentionPreviewMenu } from './mcp-mention-preview'

const VALUE = encodeMcpMentionValue('bits', 'cad://parts/hex-bolt')
const ANCHOR = { x: 12, y: 700, width: 80, height: 22 }

/** The surface mounts in the theme provider's `MenuHost`; safe areas sit outside it. */
const open = async (read: (value: string) => Promise<McpMentionReadResource | null>, locale: 'en' | 'zh' = 'en') => render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    <MobileThemeProvider colorScheme="dark" locale={locale}>
      <McpMentionPreviewMenu press={{ value: VALUE, anchor: ANCHOR }} read={read} onDismiss={() => {}} />
    </MobileThemeProvider>
  </SafeAreaProvider>,
)

test('reads the chip on open and shows what sending will inline', async () => {
  let answer!: (resource: McpMentionReadResource) => void
  const read = jest.fn((_value: string) => new Promise<McpMentionReadResource | null>((resolve) => { answer = resolve }))
  await open(read)
  expect(read).toHaveBeenCalledWith(VALUE)
  expect(screen.getByText('bits')).toBeTruthy()
  expect(screen.getByText('Reading the resource…')).toBeTruthy()
  answer({ server: 'bits', uri: 'cad://parts/hex-bolt', text: 'Grade 8.8 stainless' })
  await waitFor(() => expect(screen.getByText('Grade 8.8 stainless')).toBeTruthy())
  expect(screen.getByText('Will be sent to the agent with the message (19 characters, read again at send):')).toBeTruthy()
})

test('says the read failed and that sending tries again', async () => {
  await open(async () => null, 'zh')
  await waitFor(() => expect(screen.getByText('暂时无法读取，发送时会再试一次。')).toBeTruthy())
})

test('says only the link will go for a resource that cannot be inlined', async () => {
  await open(async () => ({ server: 'bits', uri: 'cad://parts/hex-bolt', skipped: 'binary' }))
  await waitFor(() => expect(screen.getByText("This resource can't be inlined; only the link will be sent.")).toBeTruthy())
})
