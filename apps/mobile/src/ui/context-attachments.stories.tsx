import { useState } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { ContextAttachments, ContextAttachmentPreview } from './context-attachments'
import type { ContextAttachment } from '@superone/shared/context-attachments'
import { previewAppContext as selectedView } from '../preview/context-attachment-fixtures'

const initial: ContextAttachment[] = [{ id: 'dial', title: 'Agent dial', source: 'Bits & Bolts', content: '{"part":"dial"}' }, { id: 'bg', title: 'CAD context', content: 'Background selection\n{"part":"dial"}' }]
function Scenario({ items = initial, loading = false, error, narrow = false, removing = false, dark = false }: { items?: ContextAttachment[]; loading?: boolean; error?: string; narrow?: boolean; removing?: boolean; dark?: boolean }) {
  const [values, setValues] = useState(items)
  return <MobileThemeProvider colorScheme={dark ? 'dark' : 'light'}><View style={{ width: narrow ? 280 : 390 }}>
    <ContextAttachments items={values} loading={loading} error={error} removing={removing ? values.map(value => value.id) : []} onRemove={id => setValues(current => current.filter(value => value.id !== id))} />
  </View></MobileThemeProvider>
}
export default { title: 'Mobile/ContextAttachments', component: Scenario, render: Scenario }
export const Attached = {}
export const AppIcon = { args: { items: [selectedView, ...initial] } }
export const AppIconDark = { args: { items: [selectedView, ...initial], dark: true } }
export const Loading = { args: { items: [], loading: true } }
export const Empty = { args: { items: [] } }
export const Error = { args: { error: 'Could not remove context. The host is disconnected.' } }
export const Removing = { args: { removing: true } }
export const LongNarrow = { args: { narrow: true, items: [{ id: 'long', title: 'An extremely long attachment label '.repeat(5), content: 'Long context\n'.repeat(100) }] } }
export const BackgroundPreview = { render: () => <MobileThemeProvider><View style={{ width: 300 }}><ContextAttachmentPreview item={initial[1]} /></View></MobileThemeProvider> }
export const AppPreviewDark = { render: () => <MobileThemeProvider colorScheme="dark"><View style={{ width: 360 }}><ContextAttachmentPreview item={selectedView} /></View></MobileThemeProvider> }
