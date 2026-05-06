import { Input } from '@superone/ui/components/ui/input'
import { Switch } from '@superone/ui/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@superone/ui/components/ui/select'
import type { ElicitationFormField } from '@superone/shared/agent-types'

interface ElicitationFormProps {
  fields: ElicitationFormField[]
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

export function isElicitationFormValid(
  fields: ElicitationFormField[],
  value: Record<string, unknown>,
): boolean {
  for (const field of fields) {
    if (!field.required) continue
    const v = value[field.name]
    if (field.type === 'boolean') continue
    if (v === undefined || v === null) return false
    if (field.type === 'string' || field.type === 'enum') {
      if (typeof v !== 'string' || v.trim().length === 0) return false
    }
    if (field.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return false
    }
  }
  return true
}

export function ElicitationForm({ fields, value, onChange }: ElicitationFormProps) {
  const setField = (name: string, next: unknown): void => {
    onChange({ ...value, [name]: next })
  }

  return (
    <div className="mb-2 flex flex-col gap-2">
      {fields.map((field) => {
        const current = value[field.name]
        const labelEl = (
          <div className="flex items-center gap-1 text-[11px] font-medium text-foreground">
            <span>{field.label}</span>
            {field.required && <span className="text-destructive">*</span>}
          </div>
        )
        const descriptionEl = field.description ? (
          <p className="text-[10px] text-muted-foreground">{field.description}</p>
        ) : null

        if (field.type === 'boolean') {
          return (
            <div key={field.name} className="flex items-center justify-between gap-2 rounded border border-border bg-background/40 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                {labelEl}
                {descriptionEl}
              </div>
              <Switch
                checked={current === true}
                onCheckedChange={(checked) => setField(field.name, checked)}
              />
            </div>
          )
        }

        if (field.type === 'enum') {
          return (
            <div key={field.name} className="flex flex-col gap-1">
              {labelEl}
              {descriptionEl}
              <Select
                value={typeof current === 'string' ? current : ''}
                onValueChange={(v) => setField(field.name, v)}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {(field.enumOptions ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        }

        if (field.type === 'number') {
          return (
            <div key={field.name} className="flex flex-col gap-1">
              {labelEl}
              {descriptionEl}
              <Input
                type="number"
                value={typeof current === 'number' ? String(current) : ''}
                onChange={(e) => {
                  const raw = e.target.value
                  if (raw === '') {
                    const next = { ...value }
                    delete next[field.name]
                    onChange(next)
                    return
                  }
                  const n = Number(raw)
                  if (Number.isFinite(n)) setField(field.name, n)
                }}
                className="h-7 text-xs"
              />
            </div>
          )
        }

        return (
          <div key={field.name} className="flex flex-col gap-1">
            {labelEl}
            {descriptionEl}
            <Input
              type="text"
              value={typeof current === 'string' ? current : ''}
              onChange={(e) => setField(field.name, e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        )
      })}
    </div>
  )
}
