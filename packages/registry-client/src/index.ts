// @goodboy/registry-client
// HTTP client for the GoodBoy public registry API (Phase 3)
// This package is a stub — full implementation ships with Phase 3

export interface RegistrySkill {
  name: string
  version: string
  description: string
  author: string
  status: 'experimental' | 'stable' | 'deprecated'
  keywords: string[]
  downloads: number
}

export interface SearchResult {
  skills: RegistrySkill[]
  total: number
  page: number
}

export interface RegistryClientConfig {
  baseUrl: string
  apiKey?: string
}

export class RegistryClient {
  constructor(private config: RegistryClientConfig) {}

  async search(_query: string): Promise<SearchResult> {
    throw new Error('RegistryClient.search: not implemented — Phase 3 only')
  }

  async getSkill(_name: string, _version?: string): Promise<RegistrySkill> {
    throw new Error('RegistryClient.getSkill: not implemented — Phase 3 only')
  }

  async publish(_manifestPath: string): Promise<void> {
    throw new Error('RegistryClient.publish: not implemented — Phase 3 only')
  }
}

export const createRegistryClient = (config: RegistryClientConfig): RegistryClient => {
  return new RegistryClient(config)
}
