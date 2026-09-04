import { useEffect, useMemo, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { WebView } from 'react-native-webview'
import type {
  AskUserQuestionRequest,
  PermissionRequest,
  PlanApprovalRequest,
  QuestionAnnotations,
  SessionAgentLaunchProposal,
} from '@superone/shared/agent-types'
import { collaborationLaunchLabel } from './collaboration-state'
import {
  defaultPermissionFormAnswers,
  elicitationAnswersAreValid,
  initialElicitationAnswers,
  permissionSheetPresentation,
} from './permission-sheet-state'
import { useMobileStyles } from './theme/context'
import { Badge, Button, Chip, ListRow, Sheet } from './ui'
import {
  buildQuestionAnnotations,
  initialQuestionAnswers,
  questionAnswersAreComplete,
  questionKey,
  questionNoteKey,
  selectedQuestionOptions,
  toggleQuestionOption,
} from './question-sheet-state'

export function PermissionSheet(props: {
  perm: PermissionRequest | null
  onAllow: (id: string, formAnswers?: Record<string, unknown>, alwaysAllow?: boolean) => void
  onDeny: (id: string) => void
}) {
  const styles = useMobileStyles()
  const perm = props.perm
  const fields = useMemo(() => perm?.elicitationForm ?? [], [perm?.elicitationForm])
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  useEffect(() => {
    setFormValues(initialElicitationAnswers(fields))
  }, [fields, perm?.requestId])
  const collab = perm?.requestKind === 'session_agents_confirm'
    ? perm.sessionAgentsConfirm
    : undefined
  if (!perm) return null
  const presentation = permissionSheetPresentation(perm)
  const formValid = elicitationAnswersAreValid(fields, formValues)
  const answers = perm.requestKind === 'mcp_elicitation'
    ? formValues
    : defaultPermissionFormAnswers(perm)
  const approve = (alwaysAllow = false) => {
    const formAnswers = perm.requestKind === 'webmcp_trust_confirm'
      ? { scope: alwaysAllow ? 'always' : 'session' }
      : answers
    props.onAllow(perm.requestId, formAnswers, alwaysAllow)
  }
  return (
    <Sheet
      visible
      title={presentation.title}
      onDismiss={() => props.onDeny(perm.requestId)}
    >
      {presentation.description ? <Text style={styles.permissionDescription}>{presentation.description}</Text> : null}
      <ScrollView style={styles.permissionBody} keyboardShouldPersistTaps="handled">
        {collab ? (
          <View style={styles.collabList}>
            {collab.launches.map((launch) => (
              <CollaborationLaunch key={launch.launchId} launch={launch} profileName={
                collab.profiles.find((profile) => profile.id === launch.agentId)?.name
              } />
            ))}
          </View>
        ) : null}
        {fields.map((field) => (
          <View key={field.name} style={styles.permissionField}>
            <Text style={styles.rowTitle}>{field.label}{field.required ? ' *' : ''}</Text>
            {field.description ? <Text style={styles.rowMeta}>{field.description}</Text> : null}
            {field.type === 'enum' ? (
              <View style={styles.chips}>
                {(field.enumOptions ?? []).map((option) => (
                  <Chip
                    key={option}
                    label={option}
                    selected={formValues[field.name] === option}
                    onPress={() => setFormValues((current) => ({ ...current, [field.name]: option }))}
                  />
                ))}
              </View>
            ) : field.type === 'boolean' ? (
              <Chip
                label={formValues[field.name] ? 'Enabled' : 'Disabled'}
                selected={Boolean(formValues[field.name])}
                onPress={() => setFormValues((current) => ({ ...current, [field.name]: !current[field.name] }))}
              />
            ) : (
              <TextInput
                style={styles.input}
                value={String(formValues[field.name] ?? '')}
                keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                onChangeText={(value) => setFormValues((current) => ({
                  ...current,
                  [field.name]: field.type === 'number' && value !== '' ? Number(value) : value,
                }))}
              />
            )}
          </View>
        ))}
        {!collab ? presentation.items.map((item, index) => (
          <ListRow
            key={`${item.title}:${index}`}
            title={item.title}
            subtitle={item.subtitle}
            trailing={item.warning ? <Badge label="Review" tone="warning" /> : undefined}
          />
        )) : null}
      </ScrollView>
      <View style={styles.permissionActions}>
        <Button
          label={presentation.approveLabel}
          disabled={!formValid}
          variant={presentation.destructive ? 'danger' : 'primary'}
          onPress={() => approve(false)}
        />
        {presentation.alwaysLabel ? (
          <Button
            label={presentation.alwaysLabel}
            disabled={!formValid}
            variant="secondary"
            onPress={() => approve(true)}
          />
        ) : null}
        <Button label={presentation.denyLabel} variant="ghost" onPress={() => props.onDeny(perm.requestId)} />
      </View>
    </Sheet>
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
  if (!plan) return null
  return (
    <Sheet visible title="Approve plan?" onDismiss={() => props.onReject(plan.requestId)}>
      <ScrollView style={styles.planBox}><Text style={styles.rowMeta}>{plan.planContent}</Text></ScrollView>
      <View style={styles.permissionActions}>
        <Button label="Approve" onPress={() => props.onApprove(plan.requestId)} />
        <Button label="Reject" variant="ghost" onPress={() => props.onReject(plan.requestId)} />
      </View>
    </Sheet>
  )
}

export function QuestionSheet(props: {
  question: AskUserQuestionRequest | null
  onSubmit: (id: string, answers: Record<string, string>, annotations?: QuestionAnnotations) => void
  onDismiss: (id: string) => void
}) {
  const styles = useMobileStyles()
  const question = props.question
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [notesTexts, setNotesTexts] = useState<Record<string, string>>({})
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0)
  useEffect(() => {
    setAnswers(initialQuestionAnswers(question?.questions ?? []))
    setOtherTexts({})
    setNotesTexts({})
    setActiveQuestionIndex(0)
  }, [question?.requestId])
  if (!question) return null
  const complete = questionAnswersAreComplete(question.questions, answers)
  const activeQuestion = question.questions[activeQuestionIndex] ?? question.questions[0]
  return (
    <Sheet visible title={question.questions.length === 1 ? 'Question' : 'Questions'} onDismiss={() => props.onDismiss(question.requestId)}>
      <ScrollView style={styles.questionBody} keyboardShouldPersistTaps="handled">
        {question.questions.length > 1 ? (
          <ScrollView horizontal contentContainerStyle={styles.chips} showsHorizontalScrollIndicator={false}>
            {question.questions.map((item, index) => (
              <Chip
                key={questionKey(item)}
                label={`${item.header}${answers[questionKey(item)]?.trim() ? ' ✓' : ''}`}
                selected={index === activeQuestionIndex}
                onPress={() => setActiveQuestionIndex(index)}
              />
            ))}
          </ScrollView>
        ) : null}
        {activeQuestion ? (() => {
          const q = activeQuestion
          const key = questionKey(q)
          const selected = selectedQuestionOptions(answers[key])
          const selectedOption = q.options.find((option) => option.label === selected.at(-1))
          const preview = selectedOption?.preview
          const noteKey = selectedOption ? questionNoteKey(q, selectedOption.label) : null
          return (
            <View key={key} style={styles.questionGroup}>
              <Text style={styles.rowTitle}>{q.question}</Text>
              {q.multiSelect ? <Text style={styles.rowMeta}>Select one or more</Text> : null}
              {q.options.map((option) => (
                <ListRow
                  key={option.label}
                  title={option.label}
                  subtitle={option.description}
                  selected={selected.includes(option.label)}
                  trailing={selected.includes(option.label) ? <Badge label="Selected" tone="success" /> : undefined}
                  onPress={() => {
                    setOtherTexts((current) => ({ ...current, [key]: '' }))
                    setAnswers((current) => ({
                      ...current,
                      [key]: toggleQuestionOption(q, current[key], option.label),
                    }))
                  }}
                />
              ))}
              <TextInput
                style={styles.input}
                placeholder="Other"
                value={otherTexts[key] ?? ''}
                onChangeText={(value) => {
                  setOtherTexts((current) => ({ ...current, [key]: value }))
                  setAnswers((current) => ({ ...current, [key]: value }))
                }}
              />
              {preview && question.previewFormat === 'html' ? (
                <WebView
                  javaScriptEnabled={false}
                  originWhitelist={[]}
                  scrollEnabled={false}
                  source={{ html: preview }}
                  style={styles.questionPreview}
                />
              ) : preview ? <Text style={styles.previewText}>{preview}</Text> : null}
              {preview && noteKey ? (
                <TextInput
                  style={styles.input}
                  placeholder="Add a note (optional)"
                  value={notesTexts[noteKey] ?? ''}
                  onChangeText={(value) => setNotesTexts((current) => ({ ...current, [noteKey]: value }))}
                />
              ) : null}
            </View>
          )
        })() : null}
      </ScrollView>
      <View style={styles.permissionActions}>
        <Button
          label="Submit"
          disabled={!complete}
          onPress={() => props.onSubmit(
            question.requestId,
            answers,
            buildQuestionAnnotations(question.questions, answers, notesTexts),
          )}
        />
        <Button label="Dismiss" variant="ghost" onPress={() => props.onDismiss(question.requestId)} />
      </View>
    </Sheet>
  )
}
