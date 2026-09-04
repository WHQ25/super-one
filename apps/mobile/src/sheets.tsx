import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import type {
  AskUserQuestionRequest,
  PermissionRequest,
  PlanApprovalRequest,
  SessionAgentLaunchProposal,
} from '@superone/shared/agent-types'
import { buildCollaborationFormAnswers, collaborationLaunchLabel } from './collaboration-state'
import { useMobileStyles } from './theme/context'

export function PermissionSheet(props: {
  perm: PermissionRequest | null
  onAllow: (id: string, formAnswers?: Record<string, unknown>) => void
  onDeny: (id: string) => void
}) {
  const styles = useMobileStyles()
  const perm = props.perm
  const collab = perm?.requestKind === 'session_agents_confirm'
    ? perm.sessionAgentsConfirm
    : undefined
  return (
    <Modal visible={!!perm} transparent animationType="fade">
      <View style={styles.modal}>
        <Text style={styles.rowTitle}>{collab ? 'Approve collaboration?' : `Allow ${perm?.toolName ?? 'tool'}?`}</Text>
        {collab ? (
          <ScrollView style={styles.collabList}>
            {collab.launches.map((launch) => (
              <CollaborationLaunch key={launch.launchId} launch={launch} profileName={
                collab.profiles.find((profile) => profile.id === launch.agentId)?.name
              } />
            ))}
          </ScrollView>
        ) : null}
        <Pressable
          style={styles.btn}
          onPress={() => {
            if (!perm) return
            props.onAllow(perm.requestId, collab ? buildCollaborationFormAnswers(collab) : undefined)
          }}
        >
          <Text style={styles.btnText}>{collab ? `Approve ${collab.launches.length} launch${collab.launches.length === 1 ? '' : 'es'}` : 'Allow'}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => { if (perm) props.onDeny(perm.requestId) }}><Text style={styles.btnText}>Deny</Text></Pressable>
      </View>
    </Modal>
  )
}

function CollaborationLaunch(props: {
  launch: SessionAgentLaunchProposal
  profileName?: string
}) {
  const styles = useMobileStyles()
  const launch = props.launch
  const name = launch.mode === 'link'
    ? launch.peerTitle || launch.name || launch.sessionId || 'session'
    : launch.name || launch.config.name || props.profileName || launch.agentId
  const role = launch.role || launch.config.role
  const worktree = launch.config.worktree?.enabled ? launch.config.worktree : null
  return (
    <View style={styles.collabCard}>
      <Text style={styles.rowTitle}>{collaborationLaunchLabel(launch)} {name}{role ? ` · ${role}` : ''}</Text>
      {launch.mode === 'handoff' ? (
        <Text style={styles.warningText}>One-way handoff to a new sibling session; it cannot reply here.</Text>
      ) : null}
      <Text style={styles.rowMeta}>{launch.summary || launch.task}</Text>
      {launch.task && launch.task !== launch.summary ? (
        <Text style={styles.collabTask}>{launch.task}</Text>
      ) : null}
      <Text style={styles.rowMeta}>
        {launch.config.model || 'default model'} · {launch.config.permissionMode || 'default permission'}
      </Text>
      {launch.config.cwd ? <Text numberOfLines={1} style={styles.rowMeta}>{launch.config.cwd}</Text> : null}
      {worktree ? (
        <Text style={styles.rowMeta}>worktree {worktree.mode} · {worktree.branchName || worktree.baseBranch}</Text>
      ) : null}
    </View>
  )
}

export function PlanSheet(props: {
  plan: PlanApprovalRequest | null
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
  const styles = useMobileStyles()
  const plan = props.plan
  return (
    <Modal visible={!!plan} transparent animationType="fade">
      <View style={styles.modal}>
        <Text style={styles.rowTitle}>Approve plan?</Text>
        <ScrollView style={styles.planBox}><Text style={styles.rowMeta}>{plan?.planContent}</Text></ScrollView>
        <Pressable style={styles.btn} onPress={() => { if (plan) props.onApprove(plan.requestId) }}><Text style={styles.btnText}>Approve</Text></Pressable>
        <Pressable style={styles.btn} onPress={() => { if (plan) props.onReject(plan.requestId) }}><Text style={styles.btnText}>Reject</Text></Pressable>
      </View>
    </Modal>
  )
}

export function QuestionSheet(props: {
  question: AskUserQuestionRequest | null
  answers: Record<string, string>
  onPick: (header: string, label: string) => void
  onSubmit: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const styles = useMobileStyles()
  const question = props.question
  return (
    <Modal visible={!!question} transparent animationType="fade">
      <View style={styles.modal}>
        <Text style={styles.rowTitle}>Question</Text>
        <ScrollView style={styles.planBox}>
          {(question?.questions ?? []).map((q) => (
            <View key={q.header} style={{ marginBottom: 12 }}>
              <Text style={styles.rowTitle}>{q.question}</Text>
              {q.options.map((opt) => (
                <Pressable key={opt.label} style={styles.row} onPress={() => props.onPick(q.header, opt.label)}>
                  <Text style={props.answers[q.header] === opt.label ? styles.rowTitle : styles.rowMeta}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
        <Pressable style={styles.btn} onPress={() => { if (question) props.onSubmit(question.requestId) }}><Text style={styles.btnText}>Submit</Text></Pressable>
        <Pressable style={styles.btn} onPress={() => { if (question) props.onDismiss(question.requestId) }}><Text style={styles.btnText}>Dismiss</Text></Pressable>
      </View>
    </Modal>
  )
}
