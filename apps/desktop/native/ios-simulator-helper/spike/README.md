# Simulator accessibility probe

`a11y-dump.m` reads a booted iOS Simulator's semantic accessibility tree from the
host — roles, labels, `AXIdentifier`s and frames — with no guest injection, no
WebDriverAgent and no XCTest runner.

It is kept as a standalone binary rather than folded into the helper so the private
framework surface can be re-verified against a new Xcode without rebuilding the
helper or launching the app. It sits outside `Sources/` on purpose: the helper's
build cache keys on `build.sh` plus everything under `Sources/`, so nothing here can
trigger a helper rebuild.

```bash
clang -fobjc-arc -framework Foundation -framework AppKit -o /tmp/a11y-dump a11y-dump.m
/tmp/a11y-dump <udid>          # indented tree
/tmp/a11y-dump <udid> --json   # machine-readable, same shape the helper emits
```

Sample output against a booted iPhone 17 Pro Max on iOS 26.4:

```
AXApplication                                 (0,0 440x956)
  AXButton       Settings          #Settings         (335,418 72x95)
  AXSlider       Search            #spotlight-pill   (181,764 78x30)  = Page 1 of 2
  AXButton       Safari            #Safari           (136,844 72x72)
```

## When it returns nothing

The failure modes here are all silent — no error, no crash, just empty values. Each
one is commented at its site in the source; in short:

| Symptom | Cause |
| --- | --- |
| Every attribute is `nil`, but the attribute-name list looks complete | Only the iOS translator singleton was enabled. All three (`sharediOSInstance`, `sharedmacOSInstance`, `sharedInstance`) must be configured — mac platform elements read a different one. |
| `EXC_BAD_ACCESS` at `0x10` in `-[AXPTranslator sendTranslatorRequest:]` | The delegate went on `bridgeDelegate` instead of `bridgeTokenDelegate`. |
| Crash right after installing the delegate | Nothing retains it; the setter does not, and ARC releases it immediately. |
| `macPlatformElementFromTranslation:` returns `nil` | `platformElementFromTranslation:` was used instead — it yields nothing on a macOS host. |
| No output at all before a crash | `stdout` was left buffered. |
| `no translation token` | The device is not booted. |
| `simctl` reports `Connection invalid` | The sandbox is blocking CoreSimulatorService; run outside it. |

## Coordinate space

Frames are **guest points** (an iPhone 17 Pro Max reports `440x956`) and already
rotate with the device. Touch input, meanwhile, is expressed as ratios of the
framebuffer, which never changes shape. Converting between the two therefore needs
the current orientation — that math lives in `src/main/ios-simulator/`, not here, so
this probe reports raw guest points.
