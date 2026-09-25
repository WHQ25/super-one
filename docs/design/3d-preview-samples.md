# 3D preview acceptance samples

The desktop and mobile viewers recognize 11 file extensions. Keep official Apple device assets in `~/Downloads/SuperOne-Apple-3D`; they are local acceptance inputs and are not redistributed with the app. The other downloaded samples live in `~/Downloads/SuperOne-3D-Test-Assets`.

| Format | Test file | Source |
| --- | --- | --- |
| GLB | `Box.glb` | [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box), CC BY 4.0 |
| glTF | `Box.gltf` + `Box0.bin` | Same Khronos Box sample; keep the binary sibling beside the JSON |
| USDZ | `iphone-17.usdz` | Apple official AR asset, local folder above |
| USD | `triangle.usd` | Generated from the USDA fixture with `usdcat` |
| USDA | `triangle.usda` | Repository authored fixture |
| USDC | `triangle.usdc` | Generated from the USDA fixture with `usdcat` |
| OBJ | `tree.obj` | [Three.js example](https://github.com/mrdoob/three.js/blob/r185/examples/models/obj/tree.obj) |
| FBX | `nurbs.fbx` | [Three.js example](https://github.com/mrdoob/three.js/blob/r185/examples/models/fbx/nurbs.fbx), CC0 per directory README |
| STL | `slotted_disk.stl` | [Three.js example](https://github.com/mrdoob/three.js/blob/r185/examples/models/stl/ascii/slotted_disk.stl) |
| PLY | `dolphins_colored.ply` | [Three.js example](https://github.com/mrdoob/three.js/blob/r185/examples/models/ply/ascii/dolphins_colored.ply) |
| 3MF | `facecolors.3mf` | [Three.js example](https://github.com/mrdoob/three.js/blob/r185/examples/models/3mf/facecolors.3mf) |

Small fixtures are in `apps/desktop/src/renderer/src/components/coding/__fixtures__`, including `triangle.usdz` for the desktop USDZ lighting path and `variant-card.usdz` for the variant selector. Run the parser and composer tests from `apps/desktop` with `bunx vitest run src/renderer/src/components/coding/model-loader.test.ts src/main/usdz-preview.test.ts`. To also check the downloaded files, run:

```sh
SUPERONE_3D_SAMPLES="$HOME/Downloads/SuperOne-3D-Test-Assets" \
SUPERONE_APPLE_3D_SAMPLES="$HOME/Downloads/SuperOne-Apple-3D" \
bunx vitest run src/renderer/src/components/coding/model-loader.samples.test.ts src/main/usdz-preview.test.ts
```

The local sample test embeds the glTF buffer as a data URI because its parser test has no file server. In the desktop app, the media server serves `Box0.bin` from the model's folder. The mobile preview gallery bundles `Box.glb` and a generated `triangle.usdz` for offline simulator checks. Only the selected file transfers to mobile, so external glTF resources require conversion to a self-contained GLB. The viewer supports mesh geometry, ordinary textures, orbit, zoom, pan and glTF/FBX animation. The desktop viewer can select root USDZ variants on macOS; this switches authored configurations rather than continuously animating a folding mechanism. The mobile viewer does not expose these variant controls. Optional compressed glTF extensions such as Draco or KTX2 are not decoded.

The Three.js USD parser alone produces an empty scene for Apple's `iphone-18-pro-and-pro-max.usdz` and `iphone-duo.usdz` (unsupported USDC scalar types). On macOS, the desktop preview now composes an original USDZ with `/usr/bin/usdcat`, packages its referenced textures for Three.js, and shows the root variant sets as controls. If composition is unavailable, the viewer falls back to the original parser. The parser-only acceptance test still marks these two as expected failures; the native composer test covers the original files separately.

Apple's `iphone-17e.usdz` and `iphone-duo.usdz` include metadata on `outputs:mtlx:surface`. Three.js's USDA parser misreads that metadata opener and loses later material scopes, leaving many meshes white. The composer and standalone flattening script rewrite only that unused MaterialX output name in the preview copy. The desktop USD loader also restores numeric USD material colors to their default linear Rec.709 interpretation; Three.js currently decodes those values as sRGB, making dark finishes such as the iPhone 18 Pro Burgundy much too dark. The original USDZ files are unchanged. The local Apple acceptance tests cover 17e and Duo material retention, and the portable parser test covers the metadata scope.

For static preview on macOS, `apps/desktop/scripts/flatten-usdz-for-preview.py` uses `usdcat --flatten` and repackages referenced textures into a USDZ copy. The two validated outputs are `~/Downloads/SuperOne-3D-Test-Assets/iphone-18-pro-preview.usdz` and `iphone-duo-preview.usdz`. To regenerate one:

```sh
python3 apps/desktop/scripts/flatten-usdz-for-preview.py \
  "$HOME/Downloads/SuperOne-Apple-3D/iphone-duo.usdz" \
  "$HOME/Downloads/SuperOne-3D-Test-Assets/iphone-duo-preview.usdz"
```

The standalone script produces a static copy at the current USD variant, so it cannot supply a pose selector or act as the source of a continuous device simulation. The desktop viewer composes a temporary copy from the original file whenever the selected variant changes; it does not modify the source file.

Apple [Quick Look exposes root USD variant sets as configuration controls](https://developer.apple.com/documentation/usd/creating-usd-files-for-apple-devices). Verified on the original `iphone-18-pro-and-pro-max.usdz`: its `Color` choices are Black, Burgundy, Glacier, and Silver. The original `iphone-duo.usdz` has `Color` and `Pose` sets. The desktop selector reads these from the original stage and recomposes each choice. It supports the root variant sets exposed by these samples; nested variant sets and animation are outside this preview path.

The desktop USDZ lighting path uses [Apple's `studio_lighting_objectmode_v002.exr`](https://developer.apple.com/documentation/arkit/specifying-a-lighting-environment-in-ar-quick-look) with a head-on default camera. The EXR supplies Quick Look's object-mode reflections, but Three.js still evaluates materials and tone mapping independently of Apple's renderer, so exact visual parity is not guaranteed.
