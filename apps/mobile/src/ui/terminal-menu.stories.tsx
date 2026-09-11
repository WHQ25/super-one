import { useState } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import type { TerminalTabUi } from '../terminal-runtime'
import { TerminalMenuBody } from './terminal-menu'

const many: TerminalTabUi[] = [
  { terminalId: 'a', title: 'npm run dev', status: 'running' },
  { terminalId: 'b', title: 'vim src/main.ts', status: 'running' },
  { terminalId: 'c', title: 'git log --oneline', status: 'running' },
  { terminalId: 'd', title: 'zsh', status: 'exited' },
]

function Frame({ tabs, activeId }: { tabs: TerminalTabUi[]; activeId: string }) {
  const [current, setCurrent] = useState(activeId)
  const [rows, setRows] = useState(tabs)
  return (
    <MobileThemeProvider>
      <View style={{ width: 280, padding: 8, backgroundColor: '#1c1c1e', borderRadius: 12 }}>
        <TerminalMenuBody
          tabs={rows}
          activeId={current}
          onSelect={setCurrent}
          onCreate={() => setRows((currentRows) => [
            ...currentRows,
            { terminalId: `n${currentRows.length}`, title: 'zsh', status: 'running' },
          ])}
          onClose={(id) => {
            setRows((currentRows) => currentRows.filter((tab) => tab.terminalId !== id))
            if (id === current) {
              setCurrent(rows.find((tab) => tab.terminalId !== id)?.terminalId ?? '')
            }
          }}
        />
      </View>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/TerminalMenu',
  component: TerminalMenuBody,
}

export const Empty = {
  name: 'Empty · new terminal at the bottom',
  render: () => <Frame tabs={[]} activeId="" />,
}

export const Several = {
  name: 'Several tabs · active check and close',
  render: () => <Frame tabs={many} activeId="b" />,
}
