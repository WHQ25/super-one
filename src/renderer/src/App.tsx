import { ChatPanel } from '@/components/chat/ChatPanel'
import { useAgentEvents } from '@/hooks/useAgentEvents'

function App(): React.JSX.Element {
  useAgentEvents()

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold">SuperPM</h1>
        <p className="mt-2 text-neutral-400">AI-Powered Product Design</p>
      </div>
      <ChatPanel />
    </div>
  )
}

export default App
