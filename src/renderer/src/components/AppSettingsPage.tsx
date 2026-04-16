import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { initAnalytics, shutdownAnalytics } from '@/lib/analytics'

export function AppSettingsPage() {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      setAnalyticsEnabled(settings.analyticsEnabled)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [])

  async function handleAnalyticsToggle(enabled: boolean) {
    const result = await window.app.saveAppSettings({ analyticsEnabled: enabled })
    setAnalyticsEnabled(result.analyticsEnabled)
    if (result.analyticsEnabled) {
      initAnalytics()
    } else {
      shutdownAnalytics()
    }
    toast.success(result.analyticsEnabled ? 'Analytics enabled' : 'Analytics disabled')
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">General</h2>
        <p className="text-sm text-muted-foreground">Configure SuperOne application behavior</p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">Privacy</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Usage Analytics</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Send anonymous usage data to help improve SuperOne. No personal data or conversation content is collected.
              </p>
            </div>
            <Switch
              checked={analyticsEnabled}
              onCheckedChange={handleAnalyticsToggle}
              disabled={loading}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
