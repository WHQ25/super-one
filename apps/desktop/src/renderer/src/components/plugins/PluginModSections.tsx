import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@superone/ui/components/ui/button'
import { initialSchemaFormValues, parseSchemaForm, schemaFormContent, validateSchemaForm, type SchemaFormValues } from '@superone/shared/schema-form'
import type { PluginInfo, PluginModFlag, PluginModReview, PluginUserConfig } from '@superone/shared/agent-types'
import { SchemaFormFields } from '@/components/schema-form/SchemaFormFields'
import { useAppStore } from '@/stores/app'
import { DetailGroup, MetaPill } from './plugin-detail-parts'

const FLAG_TEXT: Record<PluginModFlag, 'resources.plugins.mods.toolApproval' | 'resources.plugins.mods.promptSubmit'> = {
  'tool-approval': 'resources.plugins.mods.toolApproval',
  'prompt-submit': 'resources.plugins.mods.promptSubmit',
}

/** What a Claude Code mod hooks and calls, and what that lets it do. */
export function PluginModReviewGroup({ review }: { review: PluginModReview | null | 'loading' }) {
  const { t } = useTranslation()
  return (
    <DetailGroup title={t('resources.plugins.mods.title')}>
      {review === 'loading' ? (
        <p className="text-xs text-muted-foreground">{t('resources.plugins.mods.reviewing')}</p>
      ) : !review ? (
        <p className="text-xs text-muted-foreground">{t('resources.plugins.mods.unavailable')}</p>
      ) : (
        <div className="space-y-2">
          {review.flags.map((flag) => (
            <p key={flag} className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {t(FLAG_TEXT[flag])}
            </p>
          ))}
          {[...review.errors, ...review.warnings].map((line) => (
            <p key={line} className="text-xs text-muted-foreground">{line}</p>
          ))}
          {review.modules.map((m) => (
            <div key={m.module} className="space-y-1">
              <div className="font-mono text-[11px] text-foreground">{m.module}</div>
              {(['hooks', 'calls'] as const).map((kind) => m[kind].length > 0 && (
                <div key={kind} className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">{t(`resources.plugins.mods.${kind}`)}</span>
                  {m[kind].map((entry) => <MetaPill key={entry}><span className="font-mono">{entry}</span></MetaPill>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </DetailGroup>
  )
}

/** A plugin's `userConfig` form; saving writes user settings and reloads live Claude sessions. */
export function PluginOptionsForm({ config, onSave }: { config: PluginUserConfig; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  const { t } = useTranslation()
  const form = useMemo(() => parseSchemaForm(config.schema), [config.schema])
  const fields = useMemo(() => (form.supported ? form.fields : []), [form])
  const [values, setValues] = useState<SchemaFormValues>(() => ({ ...initialSchemaFormValues(fields), ...(config.values as SchemaFormValues) }))
  const [saving, setSaving] = useState(false)
  const errors = useMemo(() => validateSchemaForm(fields, values), [fields, values])
  if (fields.length === 0 && config.sensitive.length === 0) return null
  return (
    <DetailGroup title={t('resources.plugins.options.title')}>
      <div className="space-y-3">
        {fields.length > 0 && (
          <SchemaFormFields fields={fields} values={values} errors={errors} onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))} />
        )}
        {config.sensitive.length > 0 && (
          <p className="text-xs text-muted-foreground">{t('resources.plugins.options.sensitive', { names: config.sensitive.join(', ') })}</p>
        )}
        {fields.length > 0 && (
          <Button
            size="sm"
            disabled={saving || Object.keys(errors).length > 0}
            onClick={async () => {
              setSaving(true)
              try {
                await onSave(schemaFormContent(fields, values))
                toast.success(t('resources.plugins.options.saved'))
              } catch (err) {
                toast.error(t('resources.plugins.options.saveFailed', { error: err instanceof Error ? err.message : String(err) }))
              } finally {
                setSaving(false)
              }
            }}
          >
            {t('resources.plugins.options.save')}
          </Button>
        )}
      </div>
    </DetailGroup>
  )
}

/** The Claude-only sections of an installed plugin: its mod review and options. */
export function PluginModSections({ plugin }: { plugin: PluginInfo }) {
  const projectPath = useAppStore((s) => s.currentFolder) ?? ''
  const [review, setReview] = useState<PluginModReview | null | 'loading'>(plugin.hasMod ? 'loading' : null)
  const [config, setConfig] = useState<PluginUserConfig | null>(null)
  useEffect(() => {
    let live = true
    if (plugin.hasMod) void window.app.reviewPluginMods(projectPath, plugin.key).then((r) => live && setReview(r))
    void window.app.readPluginConfig(projectPath, plugin.key).then((c) => live && setConfig(c))
    return () => { live = false }
  }, [projectPath, plugin.key, plugin.hasMod])
  return (
    <>
      {plugin.hasMod && <PluginModReviewGroup review={review} />}
      {config && <PluginOptionsForm config={config} onSave={(values) => window.app.savePluginConfig(projectPath, plugin.key, values)} />}
    </>
  )
}
