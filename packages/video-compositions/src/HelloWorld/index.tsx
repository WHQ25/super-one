import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

export const HELLO_WORLD_FPS = 30
export const HELLO_WORLD_WIDTH = 1920
export const HELLO_WORLD_HEIGHT = 1080
export const HELLO_WORLD_DURATION_IN_FRAMES = 4 * HELLO_WORLD_FPS

export type HelloWorldProps = {
  title: string
  subtitle: string
}

export const helloWorldDefaultProps: HelloWorldProps = {
  title: 'SuperOne',
  subtitle: 'A meta desktop app for makers',
}

export const helloWorldSchema = null

const easeOutExpo = Easing.bezier(0.16, 1, 0.3, 1)

export const HelloWorld = ({ title, subtitle }: HelloWorldProps) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleOpacity = interpolate(frame, [0, fps * 0.8], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  })
  const titleY = interpolate(frame, [0, fps * 0.8], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  })

  const underlineWidth = interpolate(frame, [fps * 0.6, fps * 1.6], [0, 320], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  })

  const subtitleOpacity = interpolate(frame, [fps * 1.4, fps * 2.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  })
  const subtitleY = interpolate(frame, [fps * 1.4, fps * 2.2], [16, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: easeOutExpo,
  })

  return (
    <AbsoluteFill className="bg-background items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <div
          className="text-foreground text-[160px] font-semibold tracking-tight"
          style={{ opacity: titleOpacity, transform: `translateY(${titleY}px)` }}
        >
          {title}
        </div>
        <div
          className="bg-primary h-[3px] rounded-full"
          style={{ width: underlineWidth }}
        />
        <div
          className="text-muted-foreground text-[36px] tracking-wide"
          style={{ opacity: subtitleOpacity, transform: `translateY(${subtitleY}px)` }}
        >
          {subtitle}
        </div>
      </div>
    </AbsoluteFill>
  )
}
