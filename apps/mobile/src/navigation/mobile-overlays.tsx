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
  answers: Record<string, string>
  onPickAnswer: (header: string, label: string) => void
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
        onAllow={(id, formAnswers, alwaysAllow) => runUiAction(
          () => runtime()?.respondPermission(id, true, formAnswers, alwaysAllow),
          props.setStatus,
          'permission response failed',
        )}
        onDeny={(id) => runUiAction(
          () => runtime()?.respondPermission(id, false),
          props.setStatus,
          'permission response failed',
        )}
      />
      <PlanSheet
        plan={props.plan}
        onApprove={(id) => runUiAction(
          () => runtime()?.respondPlan(id, true),
          props.setStatus,
          'plan response failed',
        )}
        onReject={(id) => runUiAction(
          () => runtime()?.respondPlan(id, false, 'rejected from mobile'),
          props.setStatus,
          'plan response failed',
        )}
      />
      <QuestionSheet
        question={props.question}
        answers={props.answers}
        onPick={props.onPickAnswer}
        onSubmit={(id) => runUiAction(
          () => runtime()?.answerQuestion(id, props.answers),
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
