/**
 * Contextual suggestion engine — template phase.
 *
 * Returns 4 ready-to-send prompt chips based on the user's current page and
 * (optionally) the project they are working in. The project name is resolved
 * from the DB so suggestions read "Web App sprint blockers" rather than generic
 * "Sprint blockers".
 *
 * Architecture note: this module is intentionally stateless and pure-template
 * so it responds in <5 ms with zero LLM cost. The "hybrid" upgrade path is
 * additive — a future `llmSuggestions()` call can enrich or replace the
 * templates once real sprint/issue data is fetched. No callers need to change.
 */

import { eq, and } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { projects } from '../../db/schema.js'
import type { Suggestion, SuggestionRequest } from './ai.types.js'

// ---------------------------------------------------------------------------
// Project name resolver
// ---------------------------------------------------------------------------

async function resolveProjectName(
  projectId: string,
  orgId:     string,
): Promise<string | null> {
  const rows = await db
    .select({ name: projects.name, key: projects.key })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return row.key ? `${row.name} (${row.key})` : row.name
}

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

type Page = SuggestionRequest['page']

function buildSuggestions(page: Page, project: string | null): Suggestion[] {
  const p   = project ?? null          // project name, null = no scope
  const pid = undefined as string | undefined  // filled by caller

  switch (page) {
    case 'board':
      return [
        {
          id:     'board-sprint-status',
          label:  p ? `${p} sprint status` : 'Sprint status',
          prompt: p
            ? `Give me a full status of the current sprint for ${p} — what's in progress, done, and blocked.`
            : "Give me the current sprint status — what's in progress, done, and blocked.",
        },
        {
          id:     'board-blockers',
          label:  'Sprint blockers',
          prompt: p
            ? `What issues are blocking the current sprint in ${p}? Who owns them and what's the risk?`
            : "What issues are blocking the current sprint? Who owns them and what's the risk?",
        },
        {
          id:     'board-workload',
          label:  'Team workload',
          prompt: p
            ? `Show the workload distribution for each team member in ${p} this sprint.`
            : 'Show the workload distribution for each team member in the current sprint.',
        },
        {
          id:     'board-progress',
          label:  'Sprint progress',
          prompt: p
            ? `How many issues are done vs open in the current sprint for ${p}? Am I on track to complete it?`
            : 'How many issues are done vs open in the current sprint? Are we on track to complete it?',
        },
      ]

    case 'backlog':
      return [
        {
          id:     'backlog-unassigned',
          label:  'Unassigned issues',
          prompt: p
            ? `List all unassigned issues in the ${p} backlog, ordered by priority.`
            : 'List all unassigned backlog issues ordered by priority.',
        },
        {
          id:     'backlog-summary',
          label:  'Backlog summary',
          prompt: p
            ? `Summarize the ${p} backlog — how many issues per priority, and what are the top critical ones?`
            : 'Summarize the backlog — issue counts per priority and the top critical ones.',
        },
        {
          id:     'backlog-next-sprint',
          label:  'Next sprint picks',
          prompt: p
            ? `Which backlog issues in ${p} are the best candidates for the next sprint? Consider priority and dependencies.`
            : 'Which backlog issues are the best candidates for the next sprint?',
        },
        {
          id:     'backlog-duplicates',
          label:  'Duplicate issues',
          prompt: p
            ? `Are there any similar or duplicate issues in the ${p} backlog I should merge or close?`
            : 'Are there any similar or duplicate issues in the backlog I should merge or close?',
        },
      ]

    case 'members':
      return [
        {
          id:     'members-workload',
          label:  'Workload distribution',
          prompt: p
            ? `Show the open-issue workload for each team member in ${p}. Who is overloaded?`
            : 'Show the open-issue workload for each team member. Who is overloaded?',
        },
        {
          id:     'members-most-active',
          label:  'Most active member',
          prompt: p
            ? `Who has been the most active contributor in ${p} recently?`
            : 'Who has been the most active contributor across my projects recently?',
        },
        {
          id:     'members-assignee',
          label:  'Assignee suggestions',
          prompt: p
            ? `Who should I assign new issues to in ${p} based on current workload and past performance?`
            : 'Who should I assign new issues to based on current workload and past performance?',
        },
        {
          id:     'members-available',
          label:  'Available capacity',
          prompt: p
            ? `Which team members in ${p} have the least open issues and could take on more work?`
            : 'Which team members have the least open issues and could take on more work?',
        },
      ]

    case 'analytics':
      return [
        {
          id:     'analytics-velocity',
          label:  'Sprint velocity',
          prompt: 'What is the sprint velocity trend across my projects over recent sprints?',
        },
        {
          id:     'analytics-top-contributors',
          label:  'Top contributors',
          prompt: 'Who resolved the most issues this month across all projects?',
        },
        {
          id:     'analytics-overdue',
          label:  'Overdue issues',
          prompt: 'Show me all overdue issues across my projects, sorted by priority.',
        },
        {
          id:     'analytics-completion',
          label:  'Sprint completion rate',
          prompt: 'What percentage of sprint issues have been completed on average across recent sprints?',
        },
      ]

    case 'dashboard':
      return [
        {
          id:     'dashboard-priorities',
          label:  'Top priorities today',
          prompt: 'What are the highest-priority issues I should focus on today across all my projects?',
        },
        {
          id:     'dashboard-health',
          label:  'Project health',
          prompt: 'Give me a health check across all my projects — which ones are on track and which need attention?',
        },
        {
          id:     'dashboard-blocked',
          label:  'Blocked issues',
          prompt: 'Show me all blocked issues across my projects and who is responsible for unblocking them.',
        },
        {
          id:     'dashboard-week',
          label:  'Week summary',
          prompt: "Summarize what happened across my projects this week — completed work, new issues, and anything I should know.",
        },
      ]

    case 'chat':
    default:
      return [
        {
          id:     'chat-open',
          label:  'Open issues',
          prompt: 'List all open issues across my projects, grouped by project and ordered by priority.',
        },
        {
          id:     'chat-sprint',
          label:  'Sprint status',
          prompt: 'What is the current sprint status? Which issues are in progress, done, and blocked?',
        },
        {
          id:     'chat-team',
          label:  'Team overview',
          prompt: "Give me an overview of my team's current workload across all projects.",
        },
        {
          id:     'chat-activity',
          label:  'Recent activity',
          prompt: 'Summarize recent activity across my projects — what was completed, what was opened, and any notable changes.',
        },
      ]
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSuggestions(
  req:   SuggestionRequest,
  orgId: string,
): Promise<Suggestion[]> {
  let projectName: string | null = null

  if (req.projectId) {
    projectName = await resolveProjectName(req.projectId, orgId)
  }

  return buildSuggestions(req.page, projectName).map(s =>
    req.projectId ? { ...s, projectId: req.projectId } : s,
  )
}
