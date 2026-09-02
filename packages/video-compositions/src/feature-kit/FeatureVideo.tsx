// Orchestrates a feature video: an intro TitleCard, a series of beats, and an
// OutroCard — each its own Sequence so beat content sees Sequence-relative frames.

import { type ReactNode } from "react"
import { AbsoluteFill, Sequence } from "remotion"
import { BrandScope } from "@superone/desktop-mocks"
import { sec } from "./kit"
import { TitleCard, OutroCard } from "./TitleCard"

export interface FeatureBeat {
  durationInFrames: number
  content: ReactNode
}

export interface FeatureVideoProps {
  index: number
  title: string
  subtitle: string
  beats: FeatureBeat[]
  outroTagline: string
  hue?: number
  darkMode?: boolean
  titleFrames?: number
  outroFrames?: number
}

export function featureVideoDuration(
  beats: FeatureBeat[],
  titleFrames = sec(3),
  outroFrames = sec(2.4),
): number {
  return (
    titleFrames +
    beats.reduce((sum, b) => sum + b.durationInFrames, 0) +
    outroFrames
  )
}

export function FeatureVideo({
  index,
  title,
  subtitle,
  beats,
  outroTagline,
  hue = 42,
  darkMode = false,
  titleFrames = sec(3),
  outroFrames = sec(2.4),
}: FeatureVideoProps) {
  let offset = titleFrames
  const beatSequences = beats.map((beat, i) => {
    const from = offset
    offset += beat.durationInFrames
    return (
      <Sequence key={i} from={from} durationInFrames={beat.durationInFrames}>
        {beat.content}
      </Sequence>
    )
  })

  return (
    <BrandScope brandHue={hue} darkMode={darkMode}>
      <AbsoluteFill>
        <Sequence from={0} durationInFrames={titleFrames}>
          <TitleCard
            index={index}
            title={title}
            subtitle={subtitle}
            hue={hue}
            durationInFrames={titleFrames}
          />
        </Sequence>
        {beatSequences}
        <Sequence from={offset} durationInFrames={outroFrames}>
          <OutroCard tagline={outroTagline} hue={hue} durationInFrames={outroFrames} />
        </Sequence>
      </AbsoluteFill>
    </BrandScope>
  )
}
