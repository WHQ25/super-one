# SuperOne iOS Simulator Helper

This helper is the native process behind SuperOne's headless iOS Simulator
integration. It attaches to a booted `SimDevice`, streams its IOSurface through
a low-latency VideoToolbox H.264 encoder, and injects normalized touch, keyboard,
and hardware-button input. PNG remains available as an automatic compatibility
fallback.

The helper resolves CoreSimulator, SimulatorKit, and Indigo symbols dynamically.
It does not open `Simulator.app`, capture the macOS screen, or request
Accessibility/Screen Recording permission.

Control requests and responses use newline-delimited JSON on stdin/stdout. Frame
data uses a separate Unix-domain socket with a versioned binary envelope carrying
the frame kind, keyframe flag, monotonic timestamp, and payload length. H.264 uses
Annex-B samples with SPS/PPS on keyframes so Chromium WebCodecs can decode it
without remuxing. Binary backpressure remains independent from the control
channel. The wire protocol is versioned by `IOS_SIMULATOR_PROTOCOL_VERSION` in
the shared package.

Touch updates carry an atomic snapshot of up to two identified contacts. Contact
slots remain stable when one finger lifts before the other, allowing iOS to
recognize pinch and rotation directly instead of replaying synthesized gestures.

Build with the user's selected Xcode:

```bash
./build.sh /tmp/superone-ios-helper
/tmp/superone-ios-helper/superone-ios-simulator-helper --probe
```
