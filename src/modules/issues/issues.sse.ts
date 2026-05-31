import type { ServerResponse } from 'http'
import type { IssueResponse } from './issues.types.js'

// =============================================================================
// EVENT TYPES
// =============================================================================

export type BoardEvent =
  | { type: 'CONNECTED' }
  | { type: 'ISSUE_STATUS_UPDATED'; issueId: string; statusId: string; actorId: string }
  | { type: 'ISSUE_CREATED'; issue: IssueResponse; actorId: string }

// =============================================================================
// CLIENT REGISTRY
// In-memory map: projectId → Set of raw Node.js ServerResponse objects
// Each ServerResponse is one browser tab connected to that project's board
// =============================================================================

const clients = new Map<string, Set<ServerResponse>>()

export function addClient(projectId: string, res: ServerResponse): void {
  if (!clients.has(projectId)) clients.set(projectId, new Set())
  clients.get(projectId)!.add(res)
}

export function removeClient(projectId: string, res: ServerResponse): void {
  clients.get(projectId)?.delete(res)
  if (clients.get(projectId)?.size === 0) clients.delete(projectId)
}

export function broadcast(projectId: string, event: BoardEvent): void {
  const projectClients = clients.get(projectId)
  if (!projectClients || projectClients.size === 0) return

  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const res of projectClients) {
    try {
      res.write(data)
    } catch {
      // Client disconnected mid-write — remove it
      projectClients.delete(res)
    }
  }
}
