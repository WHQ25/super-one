import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen, within } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import type { TestInstance } from 'test-renderer'
import { renderWithTheme } from '../test-render'
import { AgentMenuOptions } from './agent-selector'

const agents = [
  { id: 'build', name: 'Build', description: 'Write and run code' },
  { id: 'plan', name: 'Plan', description: 'Read-only planning' },
  { id: 'team/reviewer', name: 'A Very Long Custom Agent Name', description: 'Review project changes using the configured permissions.' },
]

test('agent rows retain their name-line icons and left-aligned descriptions', async () => {
  await renderWithTheme(<AgentMenuOptions agents={agents} value="plan" onChange={() => {}} />)
  for (const agent of agents) {
    const row = screen.getByRole('radio', { name: agent.name })
    const name = within(row).getByText(agent.name)
    const description = within(row).getByText(agent.description)
    const icon = name.parent?.children[0] as TestInstance
    // The icon belongs to the name line, not the outer row: descriptions start
    // at the same left edge as that line, matching the desktop picker.
    expect(icon.parent).toBe(name.parent)
    expect(description.parent).toBe(name.parent?.parent)
    expect(icon.type).toMatch(/svg/i)
    expect(StyleSheet.flatten(icon.props.style).flexShrink).toBe(0)
    expect(row.props.accessibilityState.checked).toBe(agent.id === 'plan')
  }
})

test('selecting a custom agent reports its id without replacing its name', async () => {
  const onChange = jest.fn()
  await renderWithTheme(<AgentMenuOptions agents={agents} value={null} onChange={onChange} />)
  await act(async () => { fireEvent.press(screen.getByRole('radio', { name: agents[2].name })) })
  expect(onChange).toHaveBeenCalledWith('team/reviewer')
})

test('a failed refresh leaves the existing agent rows available', async () => {
  await renderWithTheme(<AgentMenuOptions agents={agents} value="build" onChange={() => {}} error="Could not refresh agents" />)
  expect(screen.getByRole('alert')).toHaveTextContent('Could not refresh agents')
  expect(screen.getAllByRole('radio')).toHaveLength(3)
})

test.each([
  ['en', false, 'No agents available'],
  ['en', true, 'Loading agents…'],
  ['zh', false, '暂无可用智能体'],
  ['zh', true, '正在加载智能体…'],
] satisfies Array<['en' | 'zh', boolean, string]>)('empty catalog shows the %s loading=%s state', async (locale, loading, message) => {
  await renderWithTheme(<AgentMenuOptions agents={[]} value={null} onChange={() => {}} loading={loading} />, 'light', locale)
  expect(screen.getByText(message)).toBeTruthy()
  expect(screen.queryByRole('radio')).toBeNull()
})
