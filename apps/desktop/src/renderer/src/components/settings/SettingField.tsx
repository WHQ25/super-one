import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { Textarea } from '@superone/ui/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'

export type SettingFieldType = 'boolean' | 'enum' | 'number' | 'string' | 'json'
export type SettingFieldValue = string | number | boolean | null

export interface SettingFieldDefLike {
  key: string
  label: string
  type: SettingFieldType
  enumValues?: readonly string[]
  min?: number
  max?: number
  clearable?: boolean
  note?: string
}

export interface SettingFieldProps {
  field: SettingFieldDefLike
  value: SettingFieldValue
  onChange: (value: SettingFieldValue) => void
  size?: 'compact' | 'default'
  disabled?: boolean
}

export function SettingField({ field, value, onChange, size = 'default', disabled }: SettingFieldProps) {
  const { t } = useTranslation()
  const isCompact = size === 'compact'

  switch (field.type) {
    case 'boolean':
      return <Switch checked={value === true} onCheckedChange={(checked) => onChange(checked)} disabled={disabled} />

    case 'enum': {
      const selected = value === null || value === '' ? null : String(value)
      const displayLabel = selected ?? t('chat.configConfirm.defaultOption')
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={
                isCompact
                  ? '!h-7 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
                  : 'flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
              }
            >
              <span className="truncate">{displayLabel}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={isCompact ? 'w-40' : 'w-48'}>
            {field.clearable && (
              <DropdownMenuItem onClick={() => onChange(null)} className="flex items-center justify-between">
                <span>{t('chat.configConfirm.defaultOption')}</span>
                {selected === null && <Check className="size-4 text-muted-foreground" />}
              </DropdownMenuItem>
            )}
            {field.enumValues?.map((opt) => (
              <DropdownMenuItem key={opt} onClick={() => onChange(opt)} className="flex items-center justify-between">
                <span>{opt}</span>
                {selected === opt && <Check className="size-4 text-muted-foreground" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    case 'number':
      return (
        <Input
          type="number"
          min={field.min}
          max={field.max}
          disabled={disabled}
          value={value === null || value === undefined ? '' : Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? (field.clearable ? null : 0) : Number(e.target.value))}
          className={isCompact ? '!h-7 w-40 text-xs' : 'w-full'}
        />
      )

    case 'string':
      return (
        <Input
          type="text"
          disabled={disabled}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? (field.clearable ? null : '') : e.target.value)}
          className={isCompact ? '!h-7 w-40 text-xs' : 'w-full'}
        />
      )

    case 'json':
      return (
        <Textarea
          disabled={disabled}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={isCompact ? 4 : 8}
          className={isCompact ? 'w-full font-mono text-xs' : 'w-full font-mono text-sm'}
        />
      )
  }
}
