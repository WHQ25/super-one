import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { FilePenLine } from 'lucide-react-native'
import type { PlanApprovalRequest } from '@superone/shared/agent-types'
import { pendingPromptHeader } from '../pending-prompt-state'
import { PromptSheet } from './PromptSheet'
import { PromptActions, PromptChoice } from './PromptControls'
import { NativeMarkdown } from './NativeMarkdown'
import { usePromptStyles } from './styles'
import { useMobileLocale } from '../i18n/context'

export function PlanSheet(props: {
  plan: PlanApprovalRequest | null; continueMode?: string
  onApprove: (id: string) => void
  onApproveAndContinue: (id: string, mode: string) => void
  onReject: (id: string, feedback?: string) => void
  /** Put away behind a strip rather than rejected; see `PromptSheet`. */
  collapsed?: boolean
  onCollapse?: (id: string) => void
}) {
  const styles = usePromptStyles()
  const { locale, t } = useMobileLocale()
  const [feedback, setFeedback] = useState('')
  const [continueAfter, setContinueAfter] = useState(false)
  useEffect(() => { setFeedback(''); setContinueAfter(false) }, [props.plan?.requestId])
  const plan = props.plan
  if (!plan) return null
  const modeLabel = props.continueMode === 'auto' ? t('Auto') : t('Accept Edits')
  const reject = () => props.onReject(plan.requestId, feedback.trim() || undefined)
  const header = pendingPromptHeader({ kind: 'plan', request: plan })
  return <PromptSheet spacious title={header.title} subtitle={header.detail} icon={FilePenLine} onDismiss={reject} collapsed={props.collapsed} onCollapse={props.onCollapse && (() => props.onCollapse!(plan.requestId))} footer={<PromptActions
    approveLabel={continueAfter && props.continueMode ? locale === 'zh' ? `批准并切换到${modeLabel}` : `Approve & ${modeLabel}` : t('Approve')}
    rejectLabel={feedback.trim() ? locale === 'zh' ? '拒绝并附上反馈' : 'Reject with Feedback' : t('Reject')}
    feedback={{ value: feedback, onChange: setFeedback }}
    onApprove={() => continueAfter && props.continueMode ? props.onApproveAndContinue(plan.requestId, props.continueMode) : props.onApprove(plan.requestId)}
    onReject={reject}
  >{props.continueMode ? <PromptChoice multi label={locale === 'zh' ? `批准后切换到${modeLabel}` : `Switch to ${modeLabel} after Approval`} selected={continueAfter} onPress={() => setContinueAfter(!continueAfter)} /> : null}</PromptActions>}>
    <NativeMarkdown content={plan.planContent} />
    {plan.allowedPrompts.length ? <View style={styles.card}><Text style={styles.label}>{t('Requested permissions')}</Text>{plan.allowedPrompts.map((prompt, index) => <View key={index} style={styles.tight}><Text style={styles.title}>{prompt.tool}</Text><Text style={styles.meta}>{prompt.prompt}</Text></View>)}</View> : null}
  </PromptSheet>
}
