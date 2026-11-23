import { Globe } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'

export function ExtensionBrowserIcon({ id, className }: { id: string; className?: string }) {
  const base = cn('size-5 shrink-0', className)
  switch (id) {
    case 'chrome':
    case 'chrome-beta':
    case 'chrome-canary':
      return (
        <svg viewBox="0 0 24 24" className={base} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill={id === 'chrome-canary' ? '#FBBF24' : '#EA4335'} />
          <path d="M12 7.5h8.7a10 10 0 0 1-8.7 14.5l4.3-7.4A4.5 4.5 0 0 0 12 7.5z" fill={id === 'chrome-canary' ? '#F59E0B' : '#FBBC05'} />
          <path d="M12 22A10 10 0 0 1 3.3 7.5L7.6 15a4.5 4.5 0 0 0 8.7-.4L12 22z" fill={id === 'chrome-canary' ? '#D97706' : '#34A853'} />
          <circle cx="12" cy="12" r="4.5" fill="#fff" />
          <circle cx="12" cy="12" r="3.4" fill={id === 'chrome-beta' ? '#7C3AED' : '#4285F4'} />
        </svg>
      )
    case 'chromium':
      return (
        <svg viewBox="0 0 24 24" className={base} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#4285F4" />
          <path d="M12 7.5h8.7a10 10 0 0 1-8.7 14.5l4.3-7.4A4.5 4.5 0 0 0 12 7.5z" fill="#93C5FD" />
          <path d="M12 22A10 10 0 0 1 3.3 7.5L7.6 15a4.5 4.5 0 0 0 8.7-.4L12 22z" fill="#60A5FA" />
          <circle cx="12" cy="12" r="4.5" fill="#fff" />
          <circle cx="12" cy="12" r="3.4" fill="#2563EB" />
        </svg>
      )
    case 'edge':
      return (
        <svg viewBox="0 0 24 24" className={base} aria-hidden="true">
          <path d="M21 13.5c0 4.97-4.03 8.5-9 8.5s-9-3.53-9-8.5c0-5.4 4.2-9.5 9.5-9.5 4.4 0 7.7 2.8 8.3 6.7-.8-1.5-2.6-2.5-4.7-2.5-2.9 0-5.1 2.1-5.1 4.8 0 1.4.6 2.6 1.6 3.5-2.7-.2-4.6-2.2-4.6-4.7 0-2.8 2.2-5.1 5-5.1 2.9 0 5.3 2.1 5.8 4.9.1.5.2.9.2 1.4z" fill="#0EA5E9" />
          <path d="M19.8 16.5C18.4 19.7 15.4 22 12 22c-3.9 0-7.2-2.7-8.4-6.4 1.3 1.7 3.4 2.7 5.8 2.7 4 0 7.2-2.6 8.3-6.1.9 1.2 1.6 2.7 2.1 4.3z" fill="#10B981" />
        </svg>
      )
    case 'brave':
      return (
        <svg viewBox="0 0 24 24" className={base} aria-hidden="true">
          <path d="M12 2l7.5 3.2 1.5 6.8-3.2 7L12 22l-5.8-3-3.2-7 1.5-6.8L12 2z" fill="#FB542B" />
          <path d="M12 7.2l3.8 2.1-.8 4.9L12 16.5l-3-2.3-.8-4.9L12 7.2z" fill="#fff" />
        </svg>
      )
    case 'arc':
      return (
        <svg viewBox="0 0 24 24" className={base} aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="#6366F1" />
          <path d="M7.5 17.5a6.5 6.5 0 0 1 9 0" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" fill="none" />
          <circle cx="12" cy="10" r="2.2" fill="#fff" />
        </svg>
      )
    default:
      return <Globe className={cn(base, 'text-muted-foreground')} aria-hidden="true" />
  }
}
