import { expect, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import type { ChatMessage } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { QueuedMessages } from './queued-messages'

const queued: ChatMessage = {
  id: 'q1',
  role: 'user',
  status: 'complete',
  content: [{ type: 'text', text: 'fix the queue first' }],
  createdAt: '',
  providerId: 'local',
}

test('queued messages stay visible with edit and steer actions', async () => {
  const edited: string[] = []
  const steered: string[] = []
  await renderWithTheme(<QueuedMessages
    messages={[queued]}
    canSteer
    canSteerSoon
    onEdit={(id) => { edited.push(id) }}
    onSteer={(id) => { steered.push(id) }}
    onSteerSoon={() => {}}
  />)

  expect(screen.getByText('fix the queue first')).toBeTruthy()
  expect(screen.getByLabelText('Steer Now')).toBeTruthy()
  expect(screen.getByLabelText('Steer Soon')).toBeTruthy()
  fireEvent.press(screen.getByLabelText('Edit Queued Message'))
  expect(edited).toEqual(['q1'])
})

test('Codex queued messages omit the non-interrupting steer', async () => {
  await renderWithTheme(<QueuedMessages
    messages={[queued]}
    canSteer
    canSteerSoon={false}
    onEdit={() => {}}
    onSteer={() => {}}
    onSteerSoon={() => {}}
  />)

  expect(screen.getByLabelText('Steer Now')).toBeTruthy()
  expect(screen.queryByLabelText('Steer Soon')).toBeNull()
})
