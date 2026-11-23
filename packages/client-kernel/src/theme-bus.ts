import { createDisposer } from './disposer'
import type {
  KernelDisposer,
  ResolvedThemeOverrides,
  ThemeBus,
  ThemeLayerDefinition,
  ThemeScope,
} from './types'

interface StoredThemeLayer {
  seq: number
  layer: ThemeLayerDefinition
}

function matchesScope(layerScope: ThemeScope | undefined, target: ThemeScope | undefined): boolean {
  if (!layerScope) return true
  if (!target) return false
  if (layerScope.harness !== undefined && layerScope.harness !== target.harness) return false
  if (layerScope.projectPath !== undefined && layerScope.projectPath !== target.projectPath) return false
  if (layerScope.sessionId !== undefined && layerScope.sessionId !== target.sessionId) return false
  return true
}

function specificity(scope: ThemeScope | undefined): number {
  if (!scope) return 0
  return (scope.harness ? 1 : 0) + (scope.projectPath ? 2 : 0) + (scope.sessionId ? 4 : 0)
}

export function createThemeBus(): ThemeBus {
  let nextSeq = 1
  let version = 0
  const layers: StoredThemeLayer[] = []
  const listeners = new Set<() => void>()

  function notify() {
    version++
    for (const listener of [...listeners]) listener()
  }

  return {
    registerLayer(layer: ThemeLayerDefinition): KernelDisposer {
      const entry: StoredThemeLayer = { seq: nextSeq++, layer }
      layers.push(entry)
      notify()
      return createDisposer(() => {
        const idx = layers.indexOf(entry)
        if (idx >= 0) layers.splice(idx, 1)
        notify()
      })
    },

    getOverrides(scope?: ThemeScope): ResolvedThemeOverrides {
      const matching = layers
        .filter((entry) => matchesScope(entry.layer.scope, scope))
        .sort((a, b) => {
          const sa = specificity(a.layer.scope)
          const sb = specificity(b.layer.scope)
          if (sa !== sb) return sa - sb
          const pa = a.layer.priority ?? 0
          const pb = b.layer.priority ?? 0
          if (pa !== pb) return pa - pb
          return a.seq - b.seq
        })

      const result: ResolvedThemeOverrides = {
        lightTokens: {},
        darkTokens: {},
        cssVars: {},
      }

      for (const { layer } of matching) {
        if (layer.brandHue !== undefined) {
          result.brandHue = layer.brandHue
        }
        if (layer.lightTokens) {
          for (const [token, patch] of Object.entries(layer.lightTokens)) {
            result.lightTokens[token] = { ...result.lightTokens[token], ...patch }
          }
        }
        if (layer.darkTokens) {
          for (const [token, patch] of Object.entries(layer.darkTokens)) {
            result.darkTokens[token] = { ...result.darkTokens[token], ...patch }
          }
        }
        if (layer.cssVars) {
          Object.assign(result.cssVars, layer.cssVars)
        }
      }

      return result
    },

    getVersion(): number {
      return version
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
