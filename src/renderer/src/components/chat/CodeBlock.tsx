import { useState, useCallback, useRef } from 'react'
import { Check, Copy } from 'lucide-react'

export function CodeBlock({ children, style, ...props }: React.ComponentProps<'pre'>) {
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  const handleCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? ''
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  return (
    <div className="my-1.5 flex overflow-hidden rounded-md">
      <pre
        ref={preRef}
        {...props}
        style={style}
        className="min-w-0 flex-1 overflow-x-auto p-2.5 text-xs [&_span]:!bg-transparent"
      >
        {children}
      </pre>
      <div className="flex shrink-0 items-start p-2" style={style}>
        <button
          onClick={handleCopy}
          className="rounded p-0.5 text-neutral-500 transition-colors hover:text-neutral-300"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}

export function InlineCode({ children, ...props }: React.ComponentProps<'code'>) {
  return (
    <code
      {...props}
      className="rounded bg-neutral-700 px-1 py-0.5 text-xs text-neutral-200"
    >
      {children}
    </code>
  )
}
