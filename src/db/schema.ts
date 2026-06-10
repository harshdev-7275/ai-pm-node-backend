import { pgTable, uuid, varchar, boolean, integer, timestamp, pgEnum, type AnyPgColumn } from 'drizzle-orm/pg-core'

// =============================================================================
// ENUMS
// Hardcoded values that don't change — users cannot modify these
// =============================================================================

/**
 * Billing plan for an organization.
 * Controls which features the org can access.
 * - starter:    free tier, limited features
 * - growth:     paid, more users and features
 * - business:   advanced features, CI/CD, Teams bot
 * - enterprise: unlimited, SSO, white-label, SLA
 */
export const planEnum = pgEnum('plan', ['starter', 'growth', 'business', 'enterprise'])

/**
 * Role of a user within an organization.
 * - owner:  full access including billing and deleting the org. Only 1 per org.
 * - admin:  manage members, projects, settings. Cannot delete org.
 * - member: create/edit issues, comment, view all accessible projects
 * - viewer: read-only access across the org
 */
export const orgRoleEnum = pgEnum('org_role', ['owner', 'admin', 'member', 'viewer'])

export const authProviderEnum = pgEnum('auth_provider', ['email', 'microsoft', 'google'])

/**
 * Role of a user within a specific project.
 * Overrides org role at the project level.
 * - lead:   full access including project settings and archiving
 * - member: create/edit/close issues, manage board columns
 * - viewer: read-only, can comment but cannot change anything
 */
export const projectRoleEnum = pgEnum('project_role', ['lead', 'member', 'viewer'])

/**
 * Type of a work item (issue).
 * - feature: user-facing new work
 * - bug:     defect or unexpected behavior
 * - task:    generic internal work (deploy, docs, refactor)
 * - subtask: child breakdown of a feature, bug, or task
 */
export const issueTypeEnum = pgEnum('issue_type', ['feature', 'bug', 'task', 'subtask'])

/**
 * Priority level of an issue.
 * Hardcoded — users cannot add custom priorities.
 * - critical: production down, needs immediate attention
 * - high:     important, should be resolved this sprint
 * - medium:   normal priority (default)
 * - low:      nice to have, can wait
 */
export const issuePriorityEnum = pgEnum('issue_priority', ['critical', 'high', 'medium', 'low'])

export const sprintStatusEnum = pgEnum('sprint_status', ['planned', 'active', 'completed'])

/**
 * Workflow category of a status. Statuses themselves are user-customizable per
 * project, so this category — not the name — tells the app what a column means.
 * - todo:        not started yet
 * - in_progress: actively being worked on → sets issues.startedAt
 * - done:        complete or closed     → sets issues.completedAt
 */
export const statusCategoryEnum = pgEnum('status_category', ['todo', 'in_progress', 'done'])


/**
 * Data type of a custom field.
 * Determines how the field is rendered in the UI and validated.
 * - text:     free text input
 * - number:   numeric input (integer or decimal)
 * - date:     date picker
 * - dropdown: single select from predefined options (stored in options column as JSON)
 * - checkbox: true/false toggle
 * - url:      validated URL input
 */
export const customFieldTypeEnum = pgEnum('custom_field_type', [
  'text',
  'number',
  'date',
  'dropdown',
  'checkbox',
  'url'
])


// =============================================================================
// LAYER 1 — FOUNDATION
// The root of everything. Every other table depends on this layer.
// =============================================================================

/**
 * organizations
 * One row per company that signs up to your SaaS.
 * This is the top-level tenant — all data is isolated by org_id.
 *
 * Example: "Acme Healthcare" is one organization.
 * All their users, projects, and issues belong to this org only.
 */
export const organizations = pgTable('organizations', {
  /** Primary key — UUID is safer than integer for multi-tenant SaaS (can't be guessed) */
  id: uuid('id').defaultRandom().primaryKey(),

  /** Display name of the company e.g. "Acme Healthcare" */
  name: varchar('name', { length: 255 }).notNull(),

  /**
   * URL-safe unique identifier for the org.
   * Used for subdomain routing: acme.yourtool.com
   * Rules: lowercase, no spaces, alphanumeric + hyphens only
   * Must be globally unique across all orgs.
   */
  slug: varchar('slug', { length: 100 }).notNull().unique(),

  /** URL to the company logo, stored in cloud storage (Azure Blob / S3) */
  logoUrl: varchar('logo_url', { length: 500 }),

  /**
   * Current billing plan.
   * Controls feature access throughout the app.
   * Check this before allowing access to premium features.
   */
  plan: planEnum('plan').default('starter').notNull(),

  /**
   * Whether the org account is active.
   * false = account suspended (e.g. payment failed, violation)
   * When false, all org members should be denied access.
   */
  isActive: boolean('is_active').default(true).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),

  /**
   * Soft delete timestamp.
   * null  = org is active
   * value = org was deleted at this time
   * Never hard-delete orgs — data must be retained for billing/legal reasons.
   */
  deletedAt: timestamp('deleted_at', { withTimezone: true })
})


/**
 * users
 * One row per person across the entire platform.
 * A single user can belong to multiple organizations (e.g. a contractor).
 * Authentication is handled via Microsoft SSO (Azure AD).
 */
export const users = pgTable('users', {
  /** Primary key */
  id: uuid('id').defaultRandom().primaryKey(),

  /** Full display name e.g. "John Smith" */
  name: varchar('name', { length: 255 }).notNull(),

  /**
   * Email address — globally unique across all users.
   * Used as the primary identifier for invitations and SSO matching.
   */
  email: varchar('email', { length: 255 }).notNull().unique(),

  /** URL to the user's profile picture */
  avatarUrl: varchar('avatar_url', { length: 500 }),

  /**
   * Azure AD / Microsoft identity ID.
   * Set when the user first logs in via Microsoft SSO.
   * null = user has not logged in via Microsoft yet.
   * Used to match Teams users to your app users.
   */
  microsoftId: varchar('microsoft_id', { length: 255 }).unique(),
  /**
   * User's job title — collected during signup (step 2).
   * e.g. "engineer", "designer", "product_manager", "founder"
   * Used for onboarding personalisation and AI context.
   * null = not set yet (SSO users skip this step initially)
   */
  jobTitle:     varchar('job_title', { length: 100 }),  

  
  /**
   * User's preferred timezone (IANA format e.g. "Asia/Kolkata", "America/New_York").
   * Used for standup scheduling and notification times.
   * Defaults to UTC.
   */
  timezone: varchar('timezone', { length: 100 }).default('UTC').notNull(),

  /**
   * Timestamp of the user's last activity.
   * Updated on every API request.
   * Used for analytics, presence indicators, and detecting inactive users.
   */
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),

  /** Soft delete — null means account is active */
  deletedAt: timestamp('deleted_at', { withTimezone: true })
})


/**
 * user_auth
 * Stores authentication credentials per user per provider.
 * One user can have multiple rows — one per auth method.
 * e.g. John can log in via email AND Microsoft SSO.
 */
export const userAuth = pgTable('user_auth', {
  id:           uuid('id').defaultRandom().primaryKey(),

  /** Which user these credentials belong to */
  userId:       uuid('user_id').notNull().references(() => users.id),

  /** Which auth method this row represents */
  provider:     authProviderEnum('provider').notNull(),

  /**
   * For email auth: the bcrypt hashed password. Never store plain text.
   * For SSO providers: null (they handle passwords themselves)
   */
  passwordHash: varchar('password_hash', { length: 255 }),

  /**
   * For Microsoft SSO: Azure AD user object ID
   * For Google SSO: Google user ID
   * For email: null
   */
  providerUserId: varchar('provider_user_id', { length: 255 }),

  /**
   * OAuth access token from the provider.
   * Used to make API calls on behalf of the user
   * e.g. reading Teams data for Microsoft SSO users.
   */
  accessToken:  varchar('access_token', { length: 2000 }),

  /**
   * OAuth refresh token — used to get a new access token
   * when the current one expires. Store securely.
   */
  refreshToken: varchar('refresh_token', { length: 2000 }),

  /** When the access token expires */
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),

  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


/**
 * refresh_tokens
 * JWT refresh tokens issued per user per device/session.
 * When a user logs in, a refresh token is created here.
 * Used to issue new access tokens without re-login.
 * One user can have multiple active sessions (phone + laptop + Teams bot).
 */
export const refreshTokens = pgTable('refresh_tokens', {
  id:        uuid('id').defaultRandom().primaryKey(),

  /** Which user this token belongs to */
  userId:    uuid('user_id').notNull().references(() => users.id),

  /**
   * The actual token string — hashed before storing.
   * Never store the raw token. Send the raw token to the client,
   * store the hash here. Compare hashes on validation.
   */
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),

  /**
   * Device/client identifier for this session.
   * e.g. "Chrome on MacOS", "Teams Bot", "Mobile App"
   * Shown in "active sessions" UI so users can revoke specific devices.
   */
  deviceInfo: varchar('device_info', { length: 255 }),

  /** When this refresh token expires — typically 30 days */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  /**
   * When this token was revoked (logged out).
   * null  = token is still valid
   * value = token is invalid, reject it even if not expired
   */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * password_resets
 * Tracks password reset requests for email auth users.
 * Flow: user requests reset → row created here → email sent with token
 * → user clicks link → token validated → password updated → row deleted
 */
export const passwordResets = pgTable('password_resets', {
  id:        uuid('id').defaultRandom().primaryKey(),

  /** Which user requested the reset */
  userId:    uuid('user_id').notNull().references(() => users.id),

  /**
   * Secure random token sent in the reset email link.
   * yourtool.com/reset-password?token=abc123
   * Hashed before storing — same approach as refresh tokens.
   */
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),

  /** When this reset link expires — typically 1 hour */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  /**
   * When the reset was used.
   * null  = reset not yet completed
   * value = password was reset at this time
   * A used token cannot be used again.
   */
  usedAt:    timestamp('used_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * organization_members
 * The join table between users and organizations.
 * Defines who belongs to which company and what role they have.
 *
 * Note: A user can be a member of multiple orgs (separate rows).
 * An org admin automatically has access to all projects in the org.
 */
export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which organization this membership belongs to */
  orgId: uuid('org_id').notNull().references(() => organizations.id),

  /** Which user this membership belongs to */
  userId: uuid('user_id').notNull().references(() => users.id),

  /**
   * The user's role within this organization.
   * See orgRoleEnum for full description of each role.
   */
  role: orgRoleEnum('role').default('member').notNull(),

  /**
   * Whether this membership is currently active.
   * false = user has been removed from the org but record is kept for history.
   * Do not delete membership records — set isActive to false instead.
   */
  isActive: boolean('is_active').default(true).notNull(),

  /**
   * The user who sent the invitation that created this membership.
   * null = founding member (created the org themselves).
   */
  invitedBy: uuid('invited_by').references(() => users.id),

  /** When the user accepted the invitation and joined */
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * invitations
 * Tracks pending invitations before a user accepts and joins an org.
 * When a user accepts, a new organization_members row is created
 * and this row's acceptedAt is set.
 *
 * Invitations expire after 7 days by default.
 */
export const invitations = pgTable('invitations', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which org the user is being invited to */
  orgId: uuid('org_id').notNull().references(() => organizations.id),

  /** Email address of the person being invited */
  email: varchar('email', { length: 255 }).notNull(),

  /** Role the user will receive when they accept */
  role: orgRoleEnum('role').default('member').notNull(),

  /** The user who sent this invitation */
  invitedBy: uuid('invited_by').notNull().references(() => users.id),

  /**
   * Secure random token embedded in the invite link.
   * e.g. yourtool.com/invite/abc123xyz
   * Must be unique. Treat like a password — never expose in logs.
   */
  token: varchar('token', { length: 255 }).notNull().unique(),

  /** When this invitation expires — typically now() + 7 days */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  /**
   * When the invitation was accepted.
   * null  = still pending
   * value = accepted at this time, membership created
   */
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})


// =============================================================================
// LAYER 2 — PROJECTS
// Projects are containers for all work within an organization.
// Each project has its own board, sprints, issues, and members.
// =============================================================================

/**
 * projects
 * A project is the top-level container for work within an org.
 * Equivalent to an Azure DevOps Project.
 *
 * Example: "Website Revamp", "Mobile App v2", "Infrastructure"
 * Each project gets its own board, backlog, sprints, and repos.
 */
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which organization owns this project */
  orgId: uuid('org_id').notNull().references(() => organizations.id),

  /** Display name of the project e.g. "Website Revamp" */
  name: varchar('name', { length: 255 }).notNull(),

  /**
   * Short uppercase code for the project.
   * Used as prefix for issue numbers: WEB-1, WEB-2, WEB-3...
   * Rules: 2-10 chars, uppercase, no spaces (e.g. "WEB", "APP", "INFRA")
   * Must be unique within the org (two orgs can both have "WEB").
   */
  key: varchar('key', { length: 10 }).notNull(),

  /** Optional description of what this project is about */
  description: varchar('description', { length: 1000 }),

  /** Emoji icon for the project e.g. "🚀", "🐛", "📱" */
  icon: varchar('icon', { length: 10 }),

  /** Hex color code for UI theming e.g. "#6366f1" */
  color: varchar('color', { length: 7 }),

  /**
   * Whether this project is archived.
   * Archived projects are read-only — no new issues can be created.
   * Archived projects still appear in search and history.
   */
  isArchived: boolean('is_archived').default(false).notNull(),

  /**
   * Auto-incrementing counter for issue numbers within this project.
   * Incremented every time a new issue is created.
   * WEB-1 means this project's issueCounter was 1 when the issue was created.
   * Never decrement this even if issues are deleted.
   */
  issueCounter: integer('issue_counter').default(0).notNull(),

  /** The user who created this project */
  createdBy: uuid('created_by').notNull().references(() => users.id),

  /**
   * When true, completing a sprint automatically creates the next sprint
   * starting the same day and ending 7 days later, named "Sprint N".
   */
  weeklyAutoCreate: boolean('weekly_auto_create').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),

  /** Soft delete — null means project is active */
  deletedAt: timestamp('deleted_at', { withTimezone: true })
})


/**
 * project_members
 * Controls which org members have access to which projects.
 *
 * Note: Org owners and admins have implicit access to all projects.
 * This table is only checked for org members and viewers.
 * A user must be in organization_members before being added here.
 */
export const projectMembers = pgTable('project_members', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which project this membership belongs to */
  projectId: uuid('project_id').notNull().references(() => projects.id),

  /** Which user has access to this project */
  userId: uuid('user_id').notNull().references(() => users.id),

  /**
   * The user's role within this specific project.
   * Overrides their org-level role for this project only.
   * See projectRoleEnum for full description.
   */
  role: projectRoleEnum('role').default('member').notNull(),

  /** The user who added this person to the project */
  addedBy: uuid('added_by').notNull().references(() => users.id),

  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * sprints
 * A time-boxed iteration (usually 1-4 weeks) containing a set of issues.
 * Issues are assigned to a sprint via issues.sprintId.
 * Only one sprint per project can be 'active' at a time.
 */
export const sprints = pgTable('sprints', {
  id:        uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  orgId:     uuid('org_id').notNull().references(() => organizations.id),
  name:      varchar('name', { length: 255 }).notNull(),
  goal:      varchar('goal', { length: 1000 }),
  status:    sprintStatusEnum('status').default('planned').notNull(),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate:   timestamp('end_date', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


// =============================================================================
// LAYER 3 — ISSUES (Core of the entire application)
// Every feature in the app — boards, sprints, AI, Teams bot — revolves around issues.
// =============================================================================

/**
 * categories
 * A named grouping bucket within a project.
 * Acts as the top-level organiser: issues always belong to a category.
 * A category can be assigned to a sprint — all its issues inherit that sprintId.
 */
export const categories = pgTable('categories', {
  id:          uuid('id').defaultRandom().primaryKey(),
  projectId:   uuid('project_id').notNull().references(() => projects.id),
  orgId:       uuid('org_id').notNull().references(() => organizations.id),
  name:        varchar('name', { length: 100 }).notNull(),
  color:       varchar('color', { length: 7 }).notNull().default('#6366f1'),
  description: varchar('description', { length: 500 }),
  /** Which sprint this category is currently assigned to. null = backlog. */
  sprintId:    uuid('sprint_id'),
  createdBy:   uuid('created_by').notNull().references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


/**
 * issue_statuses
 * Custom workflow statuses per project.
 * Unlike priority and type (which are hardcoded enums),
 * statuses are stored in the DB so users can add, edit, and delete them.
 *
 * When a project is created, default statuses are auto-seeded:
 * Todo (pos:1) → In Progress (pos:2) → In Review (pos:3) → Done (pos:4) → Cancelled (pos:5)
 *
 * Users can then rename, reorder, add, or delete these.
 */
export const issueStatuses = pgTable('issue_statuses', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which project these statuses belong to — statuses are per-project */
  projectId: uuid('project_id').notNull().references(() => projects.id),

  /** Display name e.g. "Todo", "In Progress", "Blocked", "QA Testing", "Done" */
  name: varchar('name', { length: 100 }).notNull(),

  /** Hex color code for the status badge in the UI e.g. "#22c55e" for green */
  color: varchar('color', { length: 7 }).notNull(),

  /**
   * Display order of this status in the board columns and dropdowns.
   * Lower number = further left on the board.
   * When reordering, update all affected positions.
   */
  position: integer('position').notNull(),

  /**
   * Whether this is the default status for newly created issues.
   * Only ONE status per project should have isDefault = true.
   * Enforced at the application layer, not database level.
   */
  isDefault: boolean('is_default').default(false).notNull(),

  /**
   * Workflow category — what this column means semantically.
   * Drives automatic issues.startedAt / issues.completedAt and "is it done?" logic.
   * Custom statuses default to 'todo' unless a category is specified.
   */
  category: statusCategoryEnum('category').default('todo').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


/**
 * issues
 * The central table of the entire application.
 *
 * An issue is a feature, bug, task, or subtask — always belonging to a category.
 * sprintId is derived from its category's sprintId; never set directly.
 */
export const issues = pgTable('issues', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which project this issue belongs to */
  projectId: uuid('project_id').notNull().references(() => projects.id),

  /**
   * Denormalized org reference for performance.
   * Allows filtering all org issues without joining through projects.
   * Must always match projectId's org.
   */
  orgId: uuid('org_id').notNull().references(() => organizations.id),

  /**
   * Human-readable issue number within the project.
   * Auto-generated by incrementing projects.issueCounter.
   * Displayed as: WEB-42, APP-7, INFRA-103
   * Never changes once assigned — even if the issue is moved.
   */
  number: integer('number').notNull(),

  /** Short summary of the issue — shown in board cards and lists */
  title: varchar('title', { length: 500 }).notNull(),

  /**
   * Full description in markdown format.
   * Supports headings, lists, code blocks, and images.
   * null = no description added yet.
   */
  description: varchar('description', { length: 10000 }),

  /** Which category this issue belongs to — required on every issue. */
  categoryId: uuid('category_id').notNull().references(() => categories.id),

  /**
   * The type of this work item: feature | bug | task | subtask.
   * Affects how the issue is displayed and filtered.
   */
  type: issueTypeEnum('type').default('task').notNull(),

  /**
   * Current workflow status of the issue.
   * References issue_statuses — not a hardcoded enum.
   * Status must belong to the same project as the issue.
   * Changing this is the most common user action (drag on board).
   */
  statusId: uuid('status_id').notNull().references(() => issueStatuses.id),

  /**
   * How urgent/important this issue is.
   * See issuePriorityEnum for full description.
   * Affects sort order and visual indicators.
   */
  priority: issuePriorityEnum('priority').default('medium').notNull(),

  /**
   * The user currently responsible for resolving this issue.
   * null = unassigned.
   * AI will suggest an assignee based on expertise and workload.
   */
  assigneeId: uuid('assignee_id').references(() => users.id),

  /** The user who created/reported this issue */
  reporterId: uuid('reporter_id').notNull().references(() => users.id),

  /**
   * For subtasks: points to the parent feature/bug/task. null for top-level issues.
   * Hierarchy rules (only subtasks have parents, parent must be a non-subtask in
   * the same project) are enforced in issues.service `validateParent`.
   * ON DELETE CASCADE covers hard deletes; soft deletes cascade in deleteIssue.
   */
  parentId: uuid('parent_id').references((): AnyPgColumn => issues.id, { onDelete: 'cascade' }),

  /**
   * Derived from the parent category's sprintId — do not set directly.
   * null = issue is in the backlog. Set by assignCategoryToSprint cascade.
   */
  sprintId: uuid('sprint_id'),

  /**
   * Estimated effort in story points (Fibonacci scale: 1,2,3,5,8,13...).
   * Used for sprint planning and velocity tracking.
   * null = not estimated yet.
   */
  storyPoints: integer('story_points'),

  /**
   * Estimated time to complete in hours.
   * Used alongside story points for more granular tracking.
   * null = no time estimate set.
   */
  estimatedHours: integer('estimated_hours'),

  /**
   * Actual time spent on this issue in hours.
   * Updated by team members as they log time.
   * null = no time logged yet.
   */
  actualHours: integer('actual_hours'),

  /**
   * Deadline for this issue.
   * Used in overdue detection and timeline views.
   * null = no deadline set.
   */
  dueDate: timestamp('due_date', { withTimezone: true }),

  /**
   * When work actually began on this issue.
   * Set automatically when status changes to "In Progress".
   * Used for cycle time calculation.
   * null = work hasn't started yet.
   */
  startedAt: timestamp('started_at', { withTimezone: true }),

  /**
   * When the issue was marked as done.
   * Set automatically when status changes to a "Done" type status.
   * Used for lead time and velocity calculations.
   * null = issue is not yet complete.
   */
  completedAt: timestamp('completed_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),

  /** Soft delete — null means issue is active and visible */
  deletedAt: timestamp('deleted_at', { withTimezone: true })
})


/**
 * issue_comments
 * Comments and discussions on an issue.
 * Supports threaded replies via parentId.
 *
 * Markdown is supported in the body field.
 * @mentions are parsed at the application layer and trigger notifications.
 */
export const issueComments = pgTable('issue_comments', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which issue this comment belongs to */
  issueId: uuid('issue_id').notNull().references(() => issues.id),

  /** The user who wrote this comment */
  authorId: uuid('author_id').notNull().references(() => users.id),

  /** Comment content in markdown format. Supports @mentions and code blocks. */
  body: varchar('body', { length: 10000 }).notNull(),

  /**
   * Whether this comment has been edited after posting.
   * Shown as "(edited)" in the UI for transparency.
   */
  isEdited: boolean('is_edited').default(false).notNull(),

  /**
   * Reference to a parent comment for threaded replies.
   * null = this is a top-level comment on the issue.
   * value = this is a reply to another comment.
   * Maximum thread depth should be enforced at app layer (e.g. 2 levels).
   */
  parentId: uuid('parent_id'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),

  /**
   * Soft delete — when a comment is deleted, body should also be
   * replaced with "[deleted]" to preserve thread structure.
   */
  deletedAt: timestamp('deleted_at', { withTimezone: true })
})


/**
 * issue_attachments
 * Files attached to an issue (screenshots, documents, logs, etc.)
 * Actual files are stored in cloud storage (Azure Blob Storage / S3).
 * This table only stores the metadata and URL reference.
 */
export const issueAttachments = pgTable('issue_attachments', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which issue this file is attached to */
  issueId: uuid('issue_id').notNull().references(() => issues.id),

  /** The user who uploaded this file */
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id),

  /** Original filename as uploaded by the user e.g. "screenshot-2026.png" */
  fileName: varchar('file_name', { length: 255 }).notNull(),

  /**
   * Full URL to the file in cloud storage.
   * Should be a signed URL or CDN URL for secure access.
   * e.g. "https://yourstorage.blob.core.windows.net/attachments/uuid.png"
   */
  fileUrl: varchar('file_url', { length: 1000 }).notNull(),

  /** File size in bytes — used for storage quota enforcement */
  fileSize: integer('file_size').notNull(),

  /**
   * MIME type of the file e.g. "image/png", "application/pdf", "text/plain"
   * Used to determine how to render/preview the file in the UI.
   */
  fileType: varchar('file_type', { length: 100 }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * issue_labels
 * Custom tags that can be applied to issues within a project.
 * Labels help categorize and filter issues (e.g. "frontend", "backend", "urgent", "tech-debt").
 *
 * Labels are per-project — "frontend" in Project A is different from "frontend" in Project B.
 */
export const issueLabels = pgTable('issue_labels', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which project these labels belong to */
  projectId: uuid('project_id').notNull().references(() => projects.id),

  /** Display name of the label e.g. "frontend", "needs-design", "security" */
  name: varchar('name', { length: 100 }).notNull(),

  /** Hex color for the label badge in the UI e.g. "#f59e0b" */
  color: varchar('color', { length: 7 }).notNull(),
})


/**
 * issue_label_map
 * Many-to-many join table between issues and labels.
 * An issue can have multiple labels. A label can be on multiple issues.
 *
 * No primary key — the combination of issueId + labelId is unique.
 */
export const issueLabelMap = pgTable('issue_label_map', {
  /** The issue being labelled */
  issueId: uuid('issue_id').notNull().references(() => issues.id),

  /** The label being applied */
  labelId: uuid('label_id').notNull().references(() => issueLabels.id),
})


/**
 * issue_watchers
 * Users who have subscribed to updates on an issue.
 * Watchers receive notifications when the issue is updated,
 * commented on, or has its status changed.
 *
 * The reporter and assignee are automatically added as watchers.
 */
export const issueWatchers = pgTable('issue_watchers', {
  /** The issue being watched */
  issueId: uuid('issue_id').notNull().references(() => issues.id),

  /** The user watching the issue */
  userId: uuid('user_id').notNull().references(() => users.id),

  /** When the user started watching this issue */
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * issue_history
 * Complete audit trail of every change made to an issue.
 * One row is inserted for every field that changes.
 *
 * Example: Changing assignee from John to Sarah creates one row:
 * { fieldChanged: "assignee_id", oldValue: "john-uuid", newValue: "sarah-uuid" }
 *
 * Used for: activity feed on issues, audit logs, AI training data, undo functionality.
 */
export const issueHistory = pgTable('issue_history', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which issue was changed */
  issueId: uuid('issue_id').notNull().references(() => issues.id),

  /** Who made the change */
  changedBy: uuid('changed_by').notNull().references(() => users.id),

  /**
   * Which field was changed.
   * Use the database column name e.g. "status_id", "assignee_id", "title", "priority"
   * For custom fields: "custom_field_{id}"
   */
  fieldChanged: varchar('field_changed', { length: 100 }).notNull(),

  /**
   * The value before the change.
   * Stored as string — convert to appropriate type at app layer.
   * For UUIDs: store the UUID. For enums: store the enum value.
   * null = field had no previous value (e.g. first time setting assignee)
   */
  oldValue: varchar('old_value', { length: 1000 }),

  /**
   * The value after the change.
   * null = field was cleared/removed (e.g. unassigning a user)
   */
  newValue: varchar('new_value', { length: 1000 }),

  /** Exact time the change was made */
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
})


// =============================================================================
// CUSTOM FIELDS
// Allows orgs to extend issues with their own data fields.
// Equivalent to Azure DevOps custom process fields.
// =============================================================================

/**
 * custom_fields
 * Defines what custom fields exist for a project.
 * Each project can have its own set of custom fields.
 *
 * Example: A healthcare org adds "Patient Impact Level" (dropdown)
 * and "HIPAA Related?" (checkbox) to their project.
 *
 * When a new custom field is created, all existing issues in the project
 * will have no value for it until explicitly set.
 */
export const customFields = pgTable('custom_fields', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which project this field belongs to — custom fields are per-project */
  projectId: uuid('project_id').notNull().references(() => projects.id),

  /** Display name shown in the UI e.g. "Severity Score", "Affected Region" */
  name: varchar('name', { length: 100 }).notNull(),

  /**
   * Data type of this field.
   * Determines UI rendering, validation, and storage format.
   * See customFieldTypeEnum for full description.
   */
  fieldType: customFieldTypeEnum('field_type').notNull(),

  /**
   * For dropdown fields only — JSON array of allowed options.
   * Example: '["Low", "Medium", "High", "Critical"]'
   * null for all other field types.
   * Parse as JSON array at the application layer.
   */
  options: varchar('options', { length: 2000 }),

  /**
   * Whether this field must be filled before an issue can be created/saved.
   * Enforced at the application layer during issue creation and editing.
   */
  isRequired: boolean('is_required').default(false).notNull(),

  /**
   * Display order of this field in the issue form and detail view.
   * Lower number = appears first.
   */
  position: integer('position').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * custom_field_values
 * Stores the actual value of each custom field for each issue.
 * One row per (field, issue) combination.
 *
 * All values are stored as strings regardless of field type.
 * The application layer handles conversion:
 * - number:   "42" → 42
 * - checkbox: "true" / "false"
 * - date:     ISO 8601 string "2026-05-29"
 * - dropdown: the selected option string e.g. "High"
 * - url:      full URL string
 * - text:     as-is
 */
export const customFieldValues = pgTable('custom_field_values', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** Which custom field definition this value is for */
  customFieldId: uuid('custom_field_id').notNull().references(() => customFields.id),

  /** Which issue this value belongs to */
  issueId: uuid('issue_id').notNull().references(() => issues.id),

  /**
   * The actual value stored as a string.
   * null = no value set for this field on this issue.
   * See table description above for type conversion rules.
   */
  value: varchar('value', { length: 2000 }),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})

