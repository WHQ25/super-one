import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { TerminalMenuBody } from './terminal-menu'

test('creates, switches, and closes terminals from the menu body', async () => {
  const onSelect = jest.fn()
  const onCreate = jest.fn()
  const onClose = jest.fn()
  await renderWithTheme(
    <TerminalMenuBody
      tabs={[
        { terminalId: 'a', title: 'npm run dev', status: 'running' },
        { terminalId: 'b', title: 'vim', status: 'running' },
        { terminalId: 'c', title: 'git status', status: 'exited' },
      ]}
      activeId="a"
      onSelect={onSelect}
      onCreate={onCreate}
      onClose={onClose}
    />,
  )

  fireEvent.press(screen.getByLabelText('New Terminal'))
  expect(onCreate).toHaveBeenCalled()
  fireEvent.press(screen.getByRole('radio', { name: 'vim' }))
  expect(onSelect).toHaveBeenCalledWith('b')
  fireEvent.press(screen.getByRole('radio', { name: 'git status' }))
  expect(onSelect).toHaveBeenCalledWith('c')
  fireEvent.press(screen.getByLabelText('Close Terminal npm run dev'))
  expect(onClose).toHaveBeenCalledWith('a')
})
