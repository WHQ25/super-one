import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ExternalLink, Loader2, X } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'
import type { AntigravityActiveLogin } from '@superone/shared/antigravity-auth'

export function AntigravityLoginPanel({
  activeLogin,
  busy,
  onOpenBrowser,
  onCancel,
  onSubmitResponse,
}: {
  activeLogin: AntigravityActiveLogin
  busy: boolean
  onOpenBrowser: (url: string) => void
  onCancel: () => void
  onSubmitResponse: (response: string) => void
}) {
  const { t } = useTranslation()
  const responseInputId = useId()
  const [response, setResponse] = useState('')
  const [showLoopbackCallback, setShowLoopbackCallback] = useState(false)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (response.trim()) onSubmitResponse(response.trim())
  }

  return (
    <div className="flex flex-col gap-3" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        {activeLogin.authUrl && (
          <Button size="sm" className="h-7" onClick={() => onOpenBrowser(activeLogin.authUrl!)}>
            <ExternalLink data-icon="inline-start" />
            {t('antigravityAuth.openBrowser')}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={onCancel}>
          <X data-icon="inline-start" />
          {t('antigravityAuth.cancel')}
        </Button>
      </div>

      {activeLogin.status === 'waiting' && activeLogin.mode === 'code' && (
        <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
          <Label htmlFor={responseInputId} className="text-xs">
            {t('antigravityAuth.codeLabel')}
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={responseInputId}
              className="h-7 min-w-0 flex-1 basis-48 bg-background"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              placeholder={t('antigravityAuth.codePlaceholder')}
              autoComplete="off"
              maxLength={4096}
              spellCheck={false}
              disabled={busy}
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="h-7"
              disabled={!response.trim() || busy}
            >
              {t('antigravityAuth.submitCallback')}
            </Button>
          </div>
        </form>
      )}

      {activeLogin.status === 'waiting' && activeLogin.mode === 'loopback' && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="group h-7 self-start"
            aria-expanded={showLoopbackCallback}
            onClick={() => setShowLoopbackCallback(!showLoopbackCallback)}
          >
            <ChevronDown className="size-3.5 transition-transform group-aria-expanded:rotate-180" />
            {t('antigravityAuth.haveCallback')}
          </Button>
          {showLoopbackCallback && (
            <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
              <Label htmlFor={responseInputId} className="text-xs">
                {t('antigravityAuth.callbackLabel')}
              </Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id={responseInputId}
                  className="h-7 min-w-0 flex-1 basis-48 bg-background"
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  placeholder={t('antigravityAuth.callbackPlaceholder')}
                  autoComplete="off"
                  maxLength={4096}
                  spellCheck={false}
                  disabled={busy}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={!response.trim() || busy}
                >
                  {t('antigravityAuth.submitCallback')}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
