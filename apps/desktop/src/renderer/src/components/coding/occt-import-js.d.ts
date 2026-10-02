declare module 'occt-import-js' {
  interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value'
    linearDeflection?: number
    angularDeflection?: number
  }
  interface OcctMesh {
    name?: string
    color?: [number, number, number]
    attributes: { position: { array: number[] }; normal?: { array: number[] } }
    index?: { array: number[] }
  }
  interface OcctResult { success: boolean; meshes: OcctMesh[] }
  interface Occt {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult
    ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult
  }
  export default function occtimportjs(options?: { wasmBinary?: ArrayBuffer }): Promise<Occt>
}
