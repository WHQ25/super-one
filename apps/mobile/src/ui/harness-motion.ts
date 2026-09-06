import type { IconMotion } from './harness-scene-types'

type TransformName = 'translateX' | 'translateY' | 'scale' | 'scaleX' | 'scaleY' | 'rotate'
export function motionTransforms(source: string | undefined, size: number): Partial<Record<TransformName, number>> {
  const values: Partial<Record<TransformName, number>> = {}
  const length = (text: string) => parseFloat(text) * (text.endsWith('%') ? size / 100 : 1)
  for (const match of source?.matchAll(/(translate|scaleY|scaleX|scale|rotate)\(([^)]+)\)/g) ?? []) {
    const args = match[2]!.split(/,\s*|\s+/)
    if (match[1] === 'translate') {
      values.translateX = length(args[0]!)
      values.translateY = length(args[1] ?? '0')
    } else values[match[1] as TransformName] = parseFloat(args[0]!)
  }
  return values
}

export function motionTracks(motion: IconMotion, size: number) {
  const frames = motion.frames.map((frame) => ({ ...motionTransforms(frame.transform, size), ...(frame.opacity == null ? {} : { opacity: frame.opacity }) }))
  const properties = [...new Set(frames.flatMap((frame) => Object.keys(frame)))] as (TransformName | 'opacity')[]
  return properties.map((property) => {
    const fallback = property === 'opacity' || property.startsWith('scale') ? 1 : 0
    let inputRange = motion.frames.map((frame) => frame.at)
    let outputRange = frames.map((frame) => frame[property] ?? fallback)
    if (motion.easing === 'step-end') {
      const steps: number[] = [], values: number[] = []
      inputRange.forEach((at, index) => {
        if (index > 0) { steps.push(at - 0.00001); values.push(outputRange[index - 1]!) }
        steps.push(at); values.push(outputRange[index]!)
      })
      inputRange = steps; outputRange = values
    }
    return { property, inputRange, outputRange }
  })
}
