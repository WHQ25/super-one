# 3D preview test assets

- `Box.glb`, `Box.gltf`, and `Box0.bin`: Khronos glTF Sample Assets, Box model by Cesium, [CC BY 4.0](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Box/README.md). Sources: [GLB](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/main/Models/Box/glTF-Binary/Box.glb) and [glTF](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Box/glTF).
- `triangle.usda`: generated in this repository as a minimal triangle mesh.
- `triangle.usdc` and `triangle.usd`: generated from `triangle.usda` with Apple's `usdcat` command. Regenerate with `usdcat triangle.usda -o triangle.usdc` and `usdcat triangle.usda -o triangle.usd`.
- `triangle.usdz`: ZIP_STORED archive containing `triangle.usda` as its first entry, for the USDZ preview and lighting path.
- `variant-card.usdz`: repository-authored card with `Pose = Closed/Open` variants. `variant-card-closed.usdz` and `variant-card-open.usdz` are flattened preview copies used by the Storybook control fixture. Regenerate them with `usdcat --flatten` on macOS.

The other format samples used for local acceptance testing are under `~/Downloads/SuperOne-3D-Test-Assets`; Apple device USDZ files stay under `~/Downloads/SuperOne-Apple-3D` and are not redistributed here.
