import { View } from 'react-native'
import { Workflow } from 'lucide-react-native'
import { Text } from './text'
import { ComposerPanel } from './composer-panel'
import { useMobileTheme } from '../theme/context'
import type { WorkflowRunRow } from '../workflow-runs'

/**
 * `/workflows`: what this session has run, newest first.
 *
 * Read-only, like the desktop popup. A workflow spawns agents and spends
 * tokens, so *starting* one is a different question with a permission story
 * this surface deliberately does not answer.
 */
export function WorkflowsPanel({ visible, runs, onDismiss }: {
  visible: boolean
  runs: WorkflowRunRow[]
  onDismiss: () => void
}) {
  const { tokens: { colors } } = useMobileTheme()
  if (!visible) return null
  const tone = (status: WorkflowRunRow['status']) =>
    status === 'running' ? colors.warning : status === 'failed' ? colors.error : colors.success
  const label = (status: WorkflowRunRow['status']) =>
    status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : 'Finished'
  return <ComposerPanel title="Workflows" icon={Workflow} testID="workflows-panel" onClose={onDismiss}>
    {!runs.length ? <Text style={{ padding: 8, color: colors.mutedForeground, fontSize: 13 }}>
      No workflows in this session yet
    </Text> : runs.map((run) => <View key={run.id} style={{ gap: 3, paddingHorizontal: 4, paddingVertical: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone(run.status) }} />
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{run.name}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{label(run.status)}</Text>
      </View>
      {run.description ? <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: 12, paddingLeft: 16 }}>
        {run.description}
      </Text> : null}
      {/* Phases are the shape of the run: what it will do, in order. */}
      {run.phases.length ? <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 12, paddingLeft: 16 }}>
        {run.phases.join(' → ')}
      </Text> : null}
    </View>)}
  </ComposerPanel>
}
