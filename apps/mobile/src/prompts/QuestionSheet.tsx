import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { MessageCircle } from 'lucide-react-native'
import { WebView } from 'react-native-webview'
import type { AskUserQuestionRequest, QuestionAnnotations } from '@superone/shared/agent-types'
import { buildQuestionAnnotations, initialQuestionAnswers, questionAnswersAreComplete, questionKey, questionNoteKey, selectedQuestionOptions, toggleQuestionOption } from '../question-sheet-state'
import { useMobileTheme } from '../theme/context'
import { PromptSheet } from './PromptSheet'
import { PromptActions, PromptInput, PromptPill } from './PromptControls'
import { NativeMarkdown } from './NativeMarkdown'
import { usePromptStyles } from './styles'

export function QuestionSheet(props: {
  question: AskUserQuestionRequest | null
  onSubmit: (id: string, answers: Record<string, string>, annotations?: QuestionAnnotations) => void
  onDismiss: (id: string) => void
}) {
  const styles = usePromptStyles()
  const { tokens } = useMobileTheme()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [tab, setTab] = useState(0)
  useEffect(() => { setAnswers(initialQuestionAnswers(props.question?.questions ?? [])); setOtherTexts({}); setNotes({}); setTab(0) }, [props.question?.requestId])
  const question = props.question
  if (!question) return null
  const q = question.questions[tab] ?? question.questions[0]
  const key = q ? questionKey(q) : ''
  const selected = selectedQuestionOptions(answers[key])
  const option = q?.options.find((item) => item.label === selected.at(-1))
  const noteKey = option && q ? questionNoteKey(q, option.label) : ''
  const answered = question.questions.filter((item) => answers[questionKey(item)]?.trim()).length
  return <PromptSheet title={question.questions.length === 1 ? 'Question' : 'Questions'} subtitle={question.questions.length > 1 ? `${answered} of ${question.questions.length} answered` : undefined} icon={MessageCircle} onDismiss={() => props.onDismiss(question.requestId)} footer={<PromptActions
    approveLabel="Submit" rejectLabel="Dismiss"
    disabled={!questionAnswersAreComplete(question.questions, answers)}
    onApprove={() => props.onSubmit(question.requestId, answers, buildQuestionAnnotations(question.questions, answers, notes))}
    onReject={() => props.onDismiss(question.requestId)}
  />}>
    {question.questions.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{question.questions.map((item, index) => <PromptPill key={questionKey(item)} label={`${item.header}${answers[questionKey(item)]?.trim() ? ' ✓' : ''}`} selected={tab === index} onPress={() => setTab(index)} />)}</ScrollView> : null}
    {q ? <View style={styles.stack}>
      <NativeMarkdown content={q.question} />
      {q.multiSelect ? <Text style={styles.meta}>Select one or more</Text> : null}
      <View style={styles.wrap}>{q.options.map((item) => <PromptPill key={item.label} label={item.label} multi={q.multiSelect} selected={selected.includes(item.label)} onPress={() => {
        setOtherTexts((current) => ({ ...current, [key]: '' })); setAnswers((current) => ({ ...current, [key]: toggleQuestionOption(q, current[key], item.label) }))
      }} />)}</View>
      {option?.description ? <View style={styles.note}><Text style={styles.body}>{option.description}</Text></View> : null}
      <PromptInput accessibilityLabel="Other answer" placeholder="Other…" value={otherTexts[key] ?? ''} onChangeText={(value) => { setOtherTexts((current) => ({ ...current, [key]: value })); setAnswers((current) => ({ ...current, [key]: value })) }} />
      {option?.preview ? <View style={styles.tight}>
        <View style={styles.divider} /><Text style={styles.label}>Preview</Text>
        {question.previewFormat === 'html' ? <WebView javaScriptEnabled={false} originWhitelist={[]} scrollEnabled nestedScrollEnabled source={{ html: option.preview }} style={{ height: 260, backgroundColor: tokens.colors.background }} /> : <NativeMarkdown content={option.preview} />}
        <PromptInput accessibilityLabel="Preview notes" placeholder="Add a note (optional)…" value={notes[noteKey] ?? ''} onChangeText={(value) => setNotes((current) => ({ ...current, [noteKey]: value }))} />
      </View> : null}
    </View> : <Text style={styles.meta}>No questions to answer.</Text>}
  </PromptSheet>
}
