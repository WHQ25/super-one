import { useChatStore } from '@/stores/chat'

const SUGGESTIONS = [
  'Design a modern SaaS dashboard',
  'Create a landing page for a mobile app',
  'Build a settings page with sidebar nav',
  'Design a login and signup flow',
]

export function ChatSuggestions() {
  const sendMessage = useChatStore((s) => s.sendMessage)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
      <p className="text-sm font-medium text-neutral-300">Try an example to design...</p>
      <div className="flex w-full flex-col gap-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => sendMessage(text)}
            className="rounded-lg border border-amber-500/30 px-3 py-2 text-left text-sm text-amber-500 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10"
          >
            {text}
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-neutral-500">
        Claude Code will help you design and iterate on your product.
      </p>
    </div>
  )
}
