export type CatalogModality = 'text' | 'audio' | 'image' | 'video' | 'pdf'

export interface CatalogModelCost {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
}

export interface CatalogModel {
  id: string
  name: string
  providerId: string
  contextWindow?: number
  maxOutput?: number
  cost?: CatalogModelCost
  inputModalities: CatalogModality[]
  outputModalities: CatalogModality[]
  reasoning: boolean
  toolCall: boolean
  attachment: boolean
  releaseDate?: string
  knowledge?: string
  status?: 'alpha' | 'beta' | 'deprecated'
}

export interface CatalogProvider {
  id: string
  name: string
  npm: string
  api?: string
  env: string[]
  doc: string
  models: CatalogModel[]
}

export type ModelCatalogSource = 'cache' | 'snapshot' | 'network'

export interface ModelCatalog {
  providers: CatalogProvider[]
  generatedAt: string
  source: ModelCatalogSource
}
