import { useTranslation } from 'react-i18next'

export function AcpContextWindowSelect({
  windows,
  value,
  onChange,
  disabled,
}: {
  windows: number[]
  value: number | null
  onChange: (contextWindow: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  if (windows.length <= 1) return null
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="sr-only">{t('chat.acpPermissionModes.contextWindowLabel')}</span>
      <select
        aria-label={t('chat.acpPermissionModes.contextWindowLabel')}
        className="max-w-28 rounded-md border border-border bg-transparent px-1.5 py-1 text-xs"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next) && next > 0) onChange(next)
        }}
      >
        <option value="">{t('chat.acpPermissionModes.contextWindowPreserve')}</option>
        {windows.map((size) => (
          <option key={size} value={size}>{size.toLocaleString()}</option>
        ))}
      </select>
    </label>
  )
}
