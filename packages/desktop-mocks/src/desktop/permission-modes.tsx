"use client"

import type { ReactNode } from "react"
import { AlertTriangle, Bot, Eye, FastForward, Lock, PenLine, Shield, ShieldCheck, ShieldOff, Zap } from "lucide-react"

export type PermissionModeId =
  | "default"
  | "plan"
  | "auto"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions"

export interface PermissionModeDescriptor {
  id: PermissionModeId
  label: string
  description: string
  icon: ReactNode
  /** Text tone for the mode's label wherever it appears (status bar, suggestions). */
  color: string
  /** Fill behind a selected "switch to this mode" suggestion. */
  activeBg: string
}

/**
 * Mirrors the desktop's `PermissionModeList` descriptors. Mode colours are
 * identity colours, not status colours, so — like the desktop — they stay as
 * bare palette steps rather than semantic tokens.
 */
export const PERMISSION_MODES: readonly PermissionModeDescriptor[] = [
  {
    id: "default",
    label: "Normal",
    description: "Prompts for dangerous operations",
    icon: <Shield className="size-3" />,
    color: "text-muted-foreground",
    activeBg: "bg-accent",
  },
  {
    id: "plan",
    label: "Plan Mode",
    description: "Planning only, no actual execution",
    icon: <PenLine className="size-3" />,
    color: "text-blue-600 dark:text-blue-400",
    activeBg: "bg-blue-500/15",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Model classifier decides each permission",
    icon: <Zap className="size-3" />,
    color: "text-amber-500 dark:text-amber-400",
    activeBg: "bg-amber-500/15",
  },
  {
    id: "acceptEdits",
    label: "Accept Edits",
    description: "Auto-accept file edit operations",
    icon: <FastForward className="size-3" />,
    color: "text-purple-600 dark:text-purple-400",
    activeBg: "bg-purple-500/15",
  },
  {
    id: "dontAsk",
    label: "Don't Ask",
    description: "Deny anything not pre-approved",
    icon: <Lock className="size-3" />,
    color: "text-orange-500 dark:text-orange-400",
    activeBg: "bg-orange-500/15",
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Bypass all permission checks",
    icon: <ShieldOff className="size-3" />,
    color: "text-destructive",
    activeBg: "bg-destructive/15",
  },
]

export function permissionMode(id: PermissionModeId): PermissionModeDescriptor {
  return PERMISSION_MODES.find((mode) => mode.id === id) ?? PERMISSION_MODES[0]
}

/** Resolve a showcase label such as "Auto" back to its mode; unknown labels read as Normal. */
export function permissionModeByLabel(label: string): PermissionModeDescriptor {
  return PERMISSION_MODES.find((mode) => mode.label === label) ?? PERMISSION_MODES[0]
}

/** Inline "⚡ Auto" style mode chip used inside sentences. */
export function PermissionModeInline({ id }: { id: PermissionModeId }) {
  const mode = permissionMode(id)
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${mode.color}`}>
      {mode.icon}
      {mode.label}
    </span>
  )
}

export type CodexPermissionId = "read-only" | "default" | "auto-review" | "full-access"

export interface CodexPermissionPreset {
  id: CodexPermissionId
  /** i18n keys under `resources.automation`. */
  labelKey: string
  descriptionKey: string
  icon: ReactNode
  triggerIcon: ReactNode
  /** Tone inside the preset list. */
  toneClass: string
  /** Tone of the status-bar chip. */
  triggerToneClass: string
}

/** Mirrors the desktop's `codexPermissionPresetOptions`. */
export const CODEX_PERMISSION_PRESETS: readonly CodexPermissionPreset[] = [
  {
    id: "read-only",
    labelKey: "resources.automation.readOnly",
    descriptionKey: "resources.automation.readOnlyDesc",
    icon: <Eye className="size-3.5" />,
    triggerIcon: <Eye className="size-3" />,
    toneClass: "text-foreground",
    triggerToneClass: "text-muted-foreground",
  },
  {
    id: "default",
    labelKey: "resources.automation.defaultValue",
    descriptionKey: "resources.automation.defaultDesc",
    icon: <ShieldCheck className="size-3.5" />,
    triggerIcon: <ShieldCheck className="size-3" />,
    toneClass: "text-foreground",
    triggerToneClass: "text-muted-foreground",
  },
  {
    id: "auto-review",
    labelKey: "resources.automation.approveForMe",
    descriptionKey: "resources.automation.approveForMeDesc",
    icon: <Bot className="size-3.5" />,
    triggerIcon: <Bot className="size-3" />,
    toneClass: "text-primary",
    triggerToneClass: "text-primary",
  },
  {
    id: "full-access",
    labelKey: "resources.automation.fullAccess",
    descriptionKey: "resources.automation.fullAccessDesc",
    icon: <AlertTriangle className="size-3.5" />,
    triggerIcon: <ShieldOff className="size-3" />,
    toneClass: "text-destructive",
    triggerToneClass: "text-destructive",
  },
]

export function codexPermissionPreset(id: CodexPermissionId): CodexPermissionPreset {
  return CODEX_PERMISSION_PRESETS.find((preset) => preset.id === id) ?? CODEX_PERMISSION_PRESETS[1]
}
