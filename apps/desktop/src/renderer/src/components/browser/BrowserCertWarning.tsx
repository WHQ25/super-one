import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { hostOf } from './browser-url'

interface BrowserCertWarningProps {
  error: { url: string; error: string }
  onBack: () => void
  onProceed: () => void
}

export function BrowserCertWarning({ error, onBack, onProceed }: BrowserCertWarningProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const host = hostOf(error.url) ?? error.url

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-background p-8">
      <div className="flex w-full max-w-md flex-col items-start gap-4">
        <ShieldAlert className="size-12 text-destructive" strokeWidth={1.5} />
        <h1 className="text-xl font-semibold text-foreground">{t('chat.browser.insecureTitle')}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t('chat.browser.insecureBody', { host })}
        </p>
        <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{error.error}</code>

        <div className="mt-2 flex w-full items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {expanded ? t('chat.browser.insecureHide') : t('chat.browser.insecureDetails')}
          </button>
          <Button onClick={onBack}>{t('chat.browser.insecureBack')}</Button>
        </div>

        {expanded && (
          <div className="w-full border-t border-border pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('chat.browser.insecureAdvanced', { host })}
            </p>
            <button
              type="button"
              onClick={onProceed}
              className="mt-2 text-xs text-destructive underline-offset-2 hover:underline"
            >
              {t('chat.browser.insecureProceed', { host })}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
