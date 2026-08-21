import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import type { AskUserQuestionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import { styles } from './styles'

export function PermissionSheet(props: {
  perm: { requestId: string; toolName: string } | null
  onAllow: (id: string) => void
  onDeny: (id: string) => void
}) {
  const perm = props.perm
  return (
    <Modal visible={!!perm} transparent animationType="fade">
      <View style={styles.modal}>
        <Text style={styles.rowTitle}>Allow {perm?.toolName}?</Text>
        <Pressable style={styles.btn} onPress={() => { if (perm) props.onAllow(perm.requestId) }}><Text style={styles.btnText}>Allow</Text></Pressable>
        <Pressable style={styles.btn} onPress={() => { if (perm) props.onDeny(perm.requestId) }}><Text style={styles.btnText}>Deny</Text></Pressable>
      </View>
    </Modal>
  )
}

export function PlanSheet(props: {
  plan: PlanApprovalRequest | null
  onApprove: (id: string) => void
  onReject: (id: string) => void
}) {
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
