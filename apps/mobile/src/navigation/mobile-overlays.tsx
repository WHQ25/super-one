import type { RefObject } from 'react'
import { View } from 'react-native'
import type {
  AskUserQuestionRequest,
  PermissionRequest,
  PlanApprovalRequest,
} from '@superone/shared/agent-types'
import type { ChatRuntime } from '../runtime'
import { PermissionSheet, PlanSheet, QuestionSheet } from '../sheets'
import { SharedFileSheet, type useSharedFileInbox } from '../shared-file-inbox'
import { useMobileStyles } from '../theme/context'
import { ListRow, Sheet } from '../ui'
import { runUiAction } from '../ui-action'
import type { TabletSessionRow } from './tablet-session-sidebar'

export function MobileOverlays(props: {
  runtimeRef: RefObject<ChatRuntime | null>
  setStatus: (status: string) => void
  permission: PermissionRequest | null
  plan: PlanApprovalRequest | null
  question: AskUserQuestionRequest | null
  planContinueMode?: string
  onPlanContinueMode: (mode: string) => void
  sessionSwitcherOpen: boolean
  onDismissSessionSwitcher: () => void
  sessions: TabletSessionRow[]
  activeSessionId: string | null
  onOpenSession: (session: TabletSessionRow) => void | Promise<void>
  sharedFileInbox: ReturnType<typeof useSharedFileInbox>
}) {
  const styles = useMobileStyles()
  const runtime = () => props.runtimeRef.current
  return (
    <>
      <PermissionSheet
        perm={props.permission}
        onAllow={(id, formAnswers, alwaysAllow, selectedSuggestions) => runUiAction(
          () => runtime()?.respondPermission(id, true, formAnswers, alwaysAllow, undefined, selectedSuggestions),
          props.setStatus,
          'permission response failed',
        )}
        onDeny={(id, reason) => runUiAction(
          () => runtime()?.respondPermission(id, false, undefined, undefined, reason),
          props.setStatus,
          'permission response failed',
        )}
      />
      <PlanSheet
        plan={props.plan}
        continueMode={props.planContinueMode}
        onApprove={(id) => runUiAction(
          () => runtime()?.respondPlan(id, true),
          props.setStatus,
          'plan response failed',
        )}
        onApproveAndContinue={(id, mode) => runUiAction(() => {
          runtime()?.respondPlan(id, true)
          runtime()?.setPermissionMode(mode)
          props.onPlanContinueMode(mode)
        }, props.setStatus, 'plan response failed')}
        onReject={(id, feedback) => runUiAction(
          () => runtime()?.respondPlan(id, false, feedback),
          props.setStatus,
          'plan response failed',
        )}
      />
      <QuestionSheet
        question={props.question}
        onSubmit={(id, answers, annotations) => runUiAction(
          () => runtime()?.answerQuestion(id, answers, annotations),
          props.setStatus,
          'question response failed',
        )}
        onDismiss={(id) => runUiAction(
          () => runtime()?.dismissQuestion(id),
          props.setStatus,
          'question response failed',
        )}
      />
      <Sheet
        visible={props.sessionSwitcherOpen}
        title="Switch session"
        onDismiss={props.onDismissSessionSwitcher}
      >
        <View style={styles.sessionSwitcherList}>
          {props.sessions.map((session) => (
            <ListRow
              key={session.sessionId}
              title={session.title || 'Untitled'}
              subtitle={session.provider}
              selected={session.sessionId === props.activeSessionId}
              onPress={() => {
                props.onDismissSessionSwitcher()
                void props.onOpenSession(session)
              }}
            />
          ))}
        </View>
      </Sheet>
      <SharedFileSheet inbox={props.sharedFileInbox} />
    </>
  )
}
