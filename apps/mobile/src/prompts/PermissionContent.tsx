import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { ChevronDown, ChevronRight, FileText, ShieldAlert } from 'lucide-react-native'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { permissionSheetPresentation } from '../permission-sheet-state'
import { permissionToolContent } from './prompt-content'
import { usePromptStyles } from './styles'
import { NativeDiff } from './NativeDiff'
import { NativeMarkdown } from './NativeMarkdown'

export function PermissionContent({ request }: { request: PermissionRequest }) {
  const styles = usePromptStyles()
  const { tokens: { colors } } = useMobileTheme()
  const content = permissionToolContent(request)
  const presentation = permissionSheetPresentation(request)
  return <View style={styles.stack}>
    {request.requestKind ? <>
      {presentation.description && request.requestKind !== 'video_gen_confirm' ? <Text style={styles.meta}>{presentation.description}</Text> : null}
      {presentation.items.length && !['video_gen_confirm', 'config_confirm', 'automation_confirm'].includes(request.requestKind) ? <View style={styles.card}>{presentation.items.map((item, index) => <View key={index} style={styles.tight}>
        {index ? <View style={styles.divider} /> : null}
        <Text selectable style={[styles.body, item.warning && { color: colors.warning }]}>{item.title}</Text>
        {item.subtitle ? <Text selectable style={styles.meta}>{item.subtitle}</Text> : null}
      </View>)}</View> : null}
    </> : <>
      {content.description && !content.sandboxOverride ? <Text style={styles.meta}>{content.description}</Text> : null}
      {content.sandboxOverride ? <View style={styles.warning}><View style={styles.row}><ShieldAlert size={14} color={colors.warning} /><Text style={styles.warningText}>Sandbox override</Text></View>{content.description ? <Text style={styles.meta}>{content.description}</Text> : null}</View> : null}
      {content.filePath ? <View style={styles.card}><View style={styles.row}><FileText size={14} color={colors.mutedForeground} /><Text style={[styles.title, styles.grow]}>{content.fileName}</Text>{request.toolLineDelta ? <Text style={styles.meta}>+{request.toolLineDelta.added} −{request.toolLineDelta.removed}</Text> : null}</View><Text selectable style={styles.meta}>{content.filePath}</Text></View> : null}
      {content.command ? <View style={styles.card}><Text style={styles.label}>Command</Text><Text selectable style={styles.code}>{content.command}</Text></View> : null}
      {content.target ? <Text selectable style={styles.code}>{content.target}</Text> : null}
      {content.diff ? <NativeDiff diff={content.diff} tokens={request.toolDiffTokens} /> : content.content ? <Disclosure title="File content"><Text selectable style={styles.code}>{content.content}</Text></Disclosure> : null}
      {content.rawInput ? <Disclosure title="Tool input" initiallyOpen><Text selectable style={styles.code}>{content.rawInput}</Text></Disclosure> : null}
      {request.blockedPath ? <View style={styles.warning}><Text style={styles.warningText}>Blocked path</Text><Text selectable style={styles.code}>{request.blockedPath}</Text></View> : null}
      {request.decisionReason ? <Text style={styles.meta}>{request.decisionReason}</Text> : null}
    </>}
  </View>
}

export function Disclosure({ title, children, initiallyOpen = false }: { title: string; children: React.ReactNode; initiallyOpen?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen)
  const styles = usePromptStyles()
  const { tokens } = useMobileTheme()
  const Icon = expanded ? ChevronDown : ChevronRight
  return <View style={styles.card}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={[styles.row, { minHeight: 30 }]}><Icon size={14} color={tokens.colors.mutedForeground} /><Text style={styles.meta}>{title}</Text></Pressable>
    {expanded ? children : null}
  </View>
}

export function CollaborationContent({ request }: { request: PermissionRequest }) {
  const styles = usePromptStyles()
  return <View style={styles.tight}>{request.sessionAgentsConfirm?.launches.map((launch) => {
    const name = launch.peerTitle || launch.name || launch.agentId
    const mode = launch.mode === 'link' ? 'Link session' : launch.mode === 'handoff' ? 'Hand off to' : 'Spawn agent'
    return <View key={launch.launchId} style={styles.card}>
      <Text style={styles.label}>{mode}</Text><Text style={styles.title}>{name}{launch.role ? ` · ${launch.role}` : ''}</Text>
      <Text style={styles.meta}>{launch.summary || launch.task}</Text>
      {launch.mode === 'handoff' ? <Text style={styles.warningText}>One-way handoff to a sibling session.</Text> : null}
      <Text style={styles.meta}>{[launch.config.model, launch.config.permissionMode, launch.config.effort].filter(Boolean).join(' · ') || 'Default agent configuration'}</Text>
      {launch.config.cwd ? <Text selectable style={styles.meta}>{launch.config.cwd}</Text> : null}
      {launch.config.worktree?.enabled ? <Text style={styles.meta}>Worktree · {launch.config.worktree.branchName || launch.config.worktree.baseBranch || launch.config.worktree.mode}</Text> : null}
      {launch.task && launch.task !== launch.summary ? <Disclosure title="Full task"><NativeMarkdown content={launch.task} /></Disclosure> : null}
    </View>
  })}</View>
}
