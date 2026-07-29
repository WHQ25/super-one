# Third-party notice — software cursor (open-computer-use)

## Artwork

SuperOne no longer ships any OCU bitmap. The cursor glyph is drawn procedurally
(`AgentCursorGlyph` in `Sources/AgentOverlay.swift`) as a symmetric swallowtail
arrow, so it can be tinted per session and stays crisp at any size and rotation.

Geometry constants still match OCU `SoftwareCursorGlyphMetrics`, because the
motion model below is expressed in that coordinate space:
- windowSize: 126 × 126
- tipAnchor: (60.35, 70.3)

## Motion model

`Sources/CursorMotionModel.swift` is vendored from open-computer-use
`OpenComputerUseKit/CursorMotionModel.swift` (MIT): heading-driven cubic path
candidates, official progress-spring configuration, and calibrated travel timing.

SuperOne uses these for the software-cursor travel / drag densify path. The system
(hardware) pointer is not replaced by the artwork; HID posts remain separate.

## Source

- Project: https://github.com/iFurySt/open-codex-computer-use
- License: MIT (Copyright (c) 2026 Leo)
