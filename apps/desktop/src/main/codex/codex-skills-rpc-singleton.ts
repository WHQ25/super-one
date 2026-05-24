import { CodexSkillsRpcService } from './codex-skills-rpc-service'
import { getSharedCodexService } from './codex-experiment-service'

let sharedSkillsService: CodexSkillsRpcService | null = null

export function getSharedCodexSkillsService(): CodexSkillsRpcService {
  if (!sharedSkillsService) {
    sharedSkillsService = new CodexSkillsRpcService(getSharedCodexService())
  }
  return sharedSkillsService
}

export function resetCodexSkillsServiceForTests(): void {
  sharedSkillsService = null
}
