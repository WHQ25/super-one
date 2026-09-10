import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { CodexAsyncQuestionView, type CodexAsyncQuestionViewProps } from './CodexAsyncQuestionView'
import { formatCodexAsyncQuestionReply } from '@superone/shared/codex-async-question'

/** Local interaction only: Storybook never steers a real agent. */
function InteractiveQuestion(props: CodexAsyncQuestionViewProps) {
  const [answers, setAnswers] = useState(props.answers)
  const [reply, setReply] = useState(props.submittedReply)
  const [error, setError] = useState(props.error)
  return (
    <CodexAsyncQuestionView
      {...props}
      answers={answers}
      submittedReply={reply}
      error={error}
      canSubmit={props.canSubmit && answers.every((answer) => answer.trim().length > 0)}
      onAnswerChange={(index, answer) => setAnswers((current) => current.map((value, i) => i === index ? answer : value))}
      onSubmit={() => {
        setError(null)
        setReply(formatCodexAsyncQuestionReply(props.questions, answers))
      }}
    />
  )
}

const questions = [{
  title: 'Which environment should I use for verification?',
  options: ['Staging (Recommended)', 'Production'],
}]

const meta = {
  title: 'Chat/Codex/Async Question',
  component: CodexAsyncQuestionView,
  parameters: { layout: 'padded' },
  globals: { harness: 'codex' },
  decorators: [(Story) => <div className="w-full max-w-2xl"><Story /></div>],
  args: {
    questions,
    answers: ['Staging (Recommended)'],
    submitting: false,
    submittedReply: null,
    error: null,
    canSubmit: true,
    onAnswerChange: () => {},
    onSubmit: () => {},
  },
  render: (args) => <InteractiveQuestion key={JSON.stringify(args)} {...args} />,
} satisfies Meta<typeof CodexAsyncQuestionView>

export default meta
type Story = StoryObj<typeof meta>

export const Choices: Story = {
  name: 'Choices · input left / submit right',
}

export const FreeText: Story = {
  name: 'Free text · empty / submit disabled',
  args: {
    questions: [{ title: 'What should the release notes highlight?', options: null }],
    answers: [''],
  },
}

export const CustomAnswer: Story = {
  name: 'Custom answer · ready to submit',
  args: { answers: ['Use the preview deployment for this branch.'] },
}

export const MultipleQuestions: Story = {
  args: {
    questions: [...questions, { title: 'When should verification finish?', options: null }],
    answers: ['Staging (Recommended)', 'Friday afternoon'],
  },
}

export const Submitting: Story = {
  name: 'Submitting · inputs locked',
  args: { submitting: true },
}

export const Answered: Story = {
  name: 'Answered · restored from history',
  args: { submittedReply: 'Staging (Recommended)' },
}

export const MultipleAnswered: Story = {
  args: {
    ...MultipleQuestions.args,
    submittedReply: 'Which environment should I use for verification?\nStaging (Recommended)\n\nWhen should verification finish?\nFriday afternoon',
  },
}

export const Failed: Story = {
  name: 'Failed · retry preserves the answer',
  args: { answers: ['Production'], error: 'No active Codex turn to steer' },
}

export const Unavailable: Story = {
  name: 'Unavailable session · inputs disabled',
  args: { canSubmit: false, disabled: true },
}

export const MobileControlled: Story = {
  name: 'Mobile control · desktop read-only',
  args: { disabled: true },
}

export const NarrowLongContent: Story = {
  name: 'Narrow pane · long content',
  decorators: [(Story) => <div style={{ width: 320, maxWidth: '100%' }}><Story /></div>],
  args: {
    questions: [{
      title: 'Which verification approach should I use before continuing with the remaining implementation work?',
      options: ['Run all relevant integration checks (Recommended)', 'Only verify the changed interaction manually'],
    }],
    answers: ['Run all relevant integration checks (Recommended)'],
  },
}

export const NarrowAnswered: Story = {
  name: 'Narrow pane · answered',
  decorators: NarrowLongContent.decorators,
  args: { submittedReply: 'Staging (Recommended)' },
}
