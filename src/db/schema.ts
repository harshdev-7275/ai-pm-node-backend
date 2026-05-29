import { pgTable, uuid, varchar, boolean, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core'

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
 * Equivalent to Azure DevOps work item types.
 * - epic:    large body of work, contains stories/features
 * - story:   user-facing feature or requirement
 * - task:    general work item
 * - bug:     defect or unexpected behavior
 * - feature: new functionality
 * - subtask: child of any other issue type
 */
export const issueTypeEnum = pgEnum('issue_type', ['epic', 'story', 'task', 'bug', 'feature', 'subtask'])

/**
 * Priority level of an issue.
 * Hardcoded — users cannot add custom priorities.
 * - critical: production down, needs immediate attention
 * - high:     important, should be resolved this sprint
 * - medium:   normal priority (default)
 * - low:      nice to have, can wait
 */
export const issuePriorityEnum = pgEnum('issue_priority', ['critical', 'high', 'medium', 'low'])

/**
 * Type of relationship between two issues.
 * Used in the issue_links table.
 * - blocks:        this issue must be resolved before the target
 * - is_blocked_by: this issue cannot proceed until the target is done
 * - relates_to:    general relationship, no dependency
 * - duplicates:    this issue is a duplicate of the target
 */
export const issueLinkTypeEnum = pgEnum('issue_link_type', ['blocks', 'is_blocked_by', 'relates_to', 'duplicates'])

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


// =============================================================================
// LAYER 3 — ISSUES (Core of the entire application)
// Every feature in the app — boards, sprints, AI, Teams bot — revolves around issues.
// =============================================================================

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

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


/**
 * issues
 * The central table of the entire application.
 * Equivalent to Azure DevOps Work Items.
 *
 * An issue can be a task, bug, story, epic, feature, or subtask.
 * Everything else in the app (boards, sprints, AI, Teams bot) reads from this table.
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

  /**
   * The type/category of this work item.
   * See issueTypeEnum for full description.
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
   * Reference to a parent issue.
   * Used for subtasks (parentId = the parent task's id)
   * and for stories under an epic (parentId = the epic's id).
   * null = this is a top-level issue with no parent.
   */
  parentId: uuid('parent_id'),

  /**
   * Which sprint this issue is assigned to.
   * null = issue is in the backlog (not in any sprint).
   * References sprints table (added in Layer 4).
   * Left as plain uuid for now to avoid circular dependency.
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
 * issue_links
 * Defines relationships between two issues.
 * Used to model dependencies, duplicates, and related work.
 *
 * Example: "WEB-42 blocks WEB-50" means WEB-50 cannot be started until WEB-42 is done.
 * The AI uses this table to detect blocker chains and calculate impact of delays.
 */
export const issueLinks = pgTable('issue_links', {
  id: uuid('id').defaultRandom().primaryKey(),

  /** The issue that is the source of the relationship */
  sourceIssueId: uuid('source_issue_id').notNull().references(() => issues.id),

  /** The issue that is the target of the relationship */
  targetIssueId: uuid('target_issue_id').notNull().references(() => issues.id),

  /**
   * The type of relationship between the two issues.
   * See issueLinkTypeEnum for full description.
   * Note: "blocks" and "is_blocked_by" are inverse relationships.
   * When you create "A blocks B", also create "B is_blocked_by A".
   */
  linkType: issueLinkTypeEnum('link_type').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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



/**
 * user_expertise
 * Cached expertise scores per user per topic.
 * Built automatically by the AI from user activity:
 * - commits to files tagged with a topic
 * - issues closed in a topic area
 * - PRs reviewed in a topic area
 * - comments written on topic-related issues
 *
 * Higher score = more expertise in that topic.
 * Used by AI to suggest the best assignee for new issues.
 * Recalculated periodically by a background job.
 */
export const userExpertise = pgTable('user_expertise', {
  id:        uuid('id').defaultRandom().primaryKey(),

  /** Which user has this expertise */
  userId:    uuid('user_id').notNull().references(() => users.id),

  /** Which org this expertise is tracked within */
  orgId:     uuid('org_id').notNull().references(() => organizations.id),

  /**
   * The topic/area of expertise.
   * Derived from issue labels, PR file paths, and issue types.
   * e.g. "authentication", "payments", "frontend", "database", "devops"
   */
  topic:     varchar('topic', { length: 100 }).notNull(),

  /**
   * Expertise score from 0.0 to 100.0
   * Calculated from weighted activity:
   * - Closed bug in topic = +5
   * - Merged PR touching topic files = +3
   * - Reviewed PR in topic = +2
   * - Commented on topic issue = +1
   * Decays over time if no recent activity.
   */
  score:     integer('score').default(0).notNull(),

  /** When this score was last recalculated */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


/**
 * kg_sync_log
 * Tracks what has been synced from PostgreSQL to Neo4j.
 * Every time a user, issue, or project changes in PostgreSQL,
 * a background job syncs the change to the knowledge graph.
 *
 * This table ensures nothing is missed — if Neo4j goes down,
 * we can resync everything that failed using this log.
 */
export const kgSyncLog = pgTable('kg_sync_log', {
  id:         uuid('id').defaultRandom().primaryKey(),

  /**
   * What type of entity was synced.
   * e.g. "user", "issue", "project", "organization", "issue_link"
   */
  entityType: varchar('entity_type', { length: 50 }).notNull(),

  /** The PostgreSQL UUID of the entity that was synced */
  entityId:   uuid('entity_id').notNull(),

  /**
   * What operation was performed in Neo4j.
   * - create: new node/relationship created
   * - update: existing node/relationship updated
   * - delete: node/relationship removed
   */
  operation:  varchar('operation', { length: 20 }).notNull(),

  /**
   * Whether the sync succeeded.
   * - success: synced to Neo4j successfully
   * - failed:  sync failed, will be retried
   * - pending: queued but not yet processed
   */
  status:     varchar('status', { length: 20 }).default('pending').notNull(),

  /** Error message if sync failed — used for debugging */
  errorMsg:   varchar('error_msg', { length: 1000 }),

  /** How many times sync has been attempted (for retry logic) */
  attempts:   integer('attempts').default(0).notNull(),

  /** When the sync was successfully completed */
  syncedAt:   timestamp('synced_at', { withTimezone: true }),

  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * ai_insights
 * AI-generated insights about projects and teams.
 * Generated by the Python AI service by traversing the knowledge graph.
 * Displayed in dashboards, reports, and the Teams bot.
 *
 * Examples:
 * - "Sprint 3 is at 60% risk of not completing on time"
 * - "John has been overloaded for 2 weeks — 8 open tasks"
 * - "The authentication module has had 5 bugs in 30 days — needs refactoring"
 */
export const aiInsights = pgTable('ai_insights', {
  id:          uuid('id').defaultRandom().primaryKey(),

  /** Which org this insight belongs to */
  orgId:       uuid('org_id').notNull().references(() => organizations.id),

  /**
   * Which project this insight is about.
   * null = org-wide insight (e.g. team performance across all projects)
   */
  projectId:   uuid('project_id').references(() => projects.id),

  /**
   * Category of insight — used for filtering and icons in UI.
   * e.g. "bottleneck", "velocity_drop", "overload", "risk", "duplicate_pattern"
   */
  type:        varchar('type', { length: 100 }).notNull(),

  /** Short title shown in the dashboard e.g. "Sprint at risk" */
  title:       varchar('title', { length: 255 }).notNull(),

  /**
   * Full explanation of the insight in plain English.
   * Written by the AI — should be actionable, not just descriptive.
   * e.g. "Sprint 3 has 12 open tasks but only 4 days remaining.
   *       Based on current velocity, only 7 tasks will complete."
   */
  body:        varchar('body', { length: 2000 }).notNull(),

  /**
   * How important this insight is.
   * - info:     informational, no action needed
   * - warning:  should be looked at soon
   * - critical: needs immediate attention
   */
  severity:    varchar('severity', { length: 20 }).default('info').notNull(),

  /**
   * Whether a user has dismissed this insight.
   * Dismissed insights are hidden from the dashboard.
   * null = not dismissed, shown to user.
   */
  isDismissed: boolean('is_dismissed').default(false).notNull(),

  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * ai_suggestions
 * Specific AI recommendations on entities (issues, sprints, PRs).
 * More targeted than insights — these suggest a concrete action.
 *
 * Examples:
 * - "Assign this issue to Sarah (confidence: 87%)"
 * - "This issue looks like a duplicate of WEB-23"
 * - "This PR has a potential SQL injection vulnerability"
 */
export const aiSuggestions = pgTable('ai_suggestions', {
  id:             uuid('id').defaultRandom().primaryKey(),

  /** Which org this suggestion belongs to */
  orgId:          uuid('org_id').notNull().references(() => organizations.id),

  /**
   * What type of entity this suggestion is about.
   * e.g. "issue", "pr", "sprint", "pipeline"
   */
  entityType:     varchar('entity_type', { length: 50 }).notNull(),

  /** The UUID of the entity this suggestion is about */
  entityId:       uuid('entity_id').notNull(),

  /**
   * What kind of suggestion this is.
   * e.g. "assignee", "duplicate", "priority", "effort", "security", "review"
   */
  type:           varchar('type', { length: 100 }).notNull(),

  /**
   * The actual suggestion as a JSON object.
   * Structure depends on type:
   * assignee:   { userId: "uuid", reason: "fixed 3 similar bugs" }
   * duplicate:  { issueId: "uuid", similarity: 0.92 }
   * priority:   { suggested: "high", reason: "affects login flow" }
   */
  suggestion:     varchar('suggestion', { length: 2000 }).notNull(),

  /**
   * How confident the AI is in this suggestion (0.0 to 1.0).
   * e.g. 0.87 = 87% confidence
   * Shown to users as a percentage.
   * Suggestions below 0.6 are typically not shown.
   */
  confidenceScore: integer('confidence_score').notNull(),

  /**
   * Whether the user accepted this suggestion.
   * null      = not yet acted on
   * true      = user accepted the suggestion
   * false     = user rejected the suggestion
   * Used to improve AI accuracy over time.
   */
  wasAccepted:    boolean('was_accepted'),

  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})




/**
 * teams_configs
 * Stores Microsoft Teams connection per org.
 * One org can connect MULTIPLE Teams workspaces.
 * e.g. Acme Healthcare connects both their main tenant
 * and their IT department's separate Teams tenant.
 *
 * Created when an org admin clicks "Connect Teams" and
 * completes the Microsoft OAuth flow.
 */
export const teamsConfigs = pgTable('teams_configs', {
  id:           uuid('id').defaultRandom().primaryKey(),

  /** Which org owns this Teams connection */
  orgId:        uuid('org_id').notNull().references(() => organizations.id),

  /**
   * Microsoft Teams tenant ID (from Azure AD).
   * Uniquely identifies the Microsoft 365 organization.
   * Found in Azure Portal → Azure AD → Tenant ID.
   */
  tenantId:     varchar('tenant_id', { length: 255 }).notNull(),

  /**
   * Display name of the Teams workspace.
   * e.g. "Acme Healthcare - Main", "Acme IT Department"
   * Helps admins identify which workspace is which.
   */
  workspaceName: varchar('workspace_name', { length: 255 }).notNull(),

  /**
   * OAuth access token for calling Microsoft Graph API
   * on behalf of this Teams workspace.
   * Used to send messages, read channels, get user presence.
   * Expires and must be refreshed using refreshToken.
   */
  accessToken:  varchar('access_token', { length: 2000 }),

  /**
   * OAuth refresh token — used to get new access token
   * when current one expires.
   * Store securely — treat like a password.
   */
  refreshToken: varchar('refresh_token', { length: 2000 }),

  /** When the access token expires */
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),

  /**
   * Microsoft App ID registered in Azure Portal.
   * The bot uses this to authenticate with Teams.
   */
  botAppId:     varchar('bot_app_id', { length: 255 }),

  /**
   * Whether this Teams connection is active.
   * false = disconnected by admin or token revoked.
   */
  isActive:     boolean('is_active').default(true).notNull(),

  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


/**
 * teams_channel_links
 * Links a Microsoft Teams channel to a project in your app.
 * Controls which Teams channel receives notifications for which project.
 *
 * Example:
 * Teams channel #engineering → Project "Website Revamp"
 * Teams channel #mobile-team → Project "Mobile App v2"
 *
 * When an issue is created/updated in "Website Revamp",
 * a notification is sent to #engineering in Teams.
 */
export const teamsChannelLinks = pgTable('teams_channel_links', {
  id:               uuid('id').defaultRandom().primaryKey(),

  /** Which org this link belongs to */
  orgId:            uuid('org_id').notNull().references(() => organizations.id),

  /** Which Teams workspace this channel is in */
  teamsConfigId:    uuid('teams_config_id').notNull().references(() => teamsConfigs.id),

  /** Which project notifications come from */
  projectId:        uuid('project_id').notNull().references(() => projects.id),

  /**
   * Microsoft Teams channel ID.
   * Format: "19:abc123@thread.tacv2"
   * Used by Graph API to send messages to this channel.
   */
  teamsChannelId:   varchar('teams_channel_id', { length: 255 }).notNull(),

  /** Human-readable channel name e.g. "#engineering" */
  teamsChannelName: varchar('teams_channel_name', { length: 255 }).notNull(),

  /**
   * Which events trigger a notification to this channel.
   * Stored as JSON array of event types.
   * e.g. '["issue_created", "issue_closed", "build_failed", "pr_merged"]'
   *
   * Available events:
   * - issue_created, issue_closed, issue_assigned
   * - pr_created, pr_merged, pr_review_requested
   * - build_failed, build_succeeded
   * - sprint_started, sprint_completed
   * - blocker_detected
   */
  notifyOn:         varchar('notify_on', { length: 1000 }).default('["issue_created"]').notNull(),

  isActive:         boolean('is_active').default(true).notNull(),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})


/**
 * standup_sessions
 * Configures scheduled daily standup for a project via Teams bot.
 * When active, the bot DMs each project member at the scheduled time
 * asking their 3 standup questions, then posts a summary to the channel.
 *
 * One project can have one active standup session.
 */
export const standupSessions = pgTable('standup_sessions', {
  id:             uuid('id').defaultRandom().primaryKey(),

  /** Which org this standup belongs to */
  orgId:          uuid('org_id').notNull().references(() => organizations.id),

  /** Which project this standup is for */
  projectId:      uuid('project_id').notNull().references(() => projects.id),

  /** Which Teams channel the standup summary is posted to */
  teamsChannelId: uuid('teams_channel_id').references(() => teamsChannelLinks.id),

  /**
   * Time to send standup DMs (24hr format HH:MM).
   * e.g. "09:00" = bot messages team at 9am
   * Interpreted in the org's timezone.
   */
  scheduledTime:  varchar('scheduled_time', { length: 5 }).notNull(),

  /**
   * Timezone for the scheduled time (IANA format).
   * e.g. "Asia/Kolkata", "America/New_York"
   * Defaults to the org creator's timezone.
   */
  timezone:       varchar('timezone', { length: 100 }).default('UTC').notNull(),

  /**
   * Which days of the week to run the standup.
   * Stored as JSON array of day names.
   * e.g. '["monday","tuesday","wednesday","thursday","friday"]'
   * Weekend standups are unusual but supported.
   */
  days:           varchar('days', { length: 200 }).default('["monday","tuesday","wednesday","thursday","friday"]').notNull(),

  /**
   * Whether this standup is currently active.
   * false = paused (e.g. during holidays or sprint break).
   */
  isActive:       boolean('is_active').default(true).notNull(),

  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdateFn(() => new Date()),
})


/**
 * standup_responses
 * Individual standup answers collected from each team member.
 * One row per person per day.
 *
 * The bot DMs each person, waits for their reply,
 * then stores it here before compiling the team summary.
 *
 * If a person doesn't respond within the window (e.g. 30 mins),
 * their row has null values and is marked as such in the summary.
 */
export const standupResponses = pgTable('standup_responses', {
  id:           uuid('id').defaultRandom().primaryKey(),

  /** Which standup session this response belongs to */
  sessionId:    uuid('session_id').notNull().references(() => standupSessions.id),

  /** Which user submitted this response */
  userId:       uuid('user_id').notNull().references(() => users.id),

  /**
   * The date of this standup (not datetime — one per day per user).
   * Stored as ISO date string e.g. "2026-05-29"
   */
  date:         varchar('date', { length: 10 }).notNull(),

  /**
   * Answer to: "What did you complete yesterday?"
   * null = user did not respond
   */
  didYesterday: varchar('did_yesterday', { length: 2000 }),

  /**
   * Answer to: "What are you working on today?"
   * null = user did not respond
   */
  doingToday:   varchar('doing_today', { length: 2000 }),

  /**
   * Answer to: "Any blockers or impediments?"
   * null = user did not respond or has no blockers
   */
  blockers:     varchar('blockers', { length: 2000 }),

  /**
   * When the user submitted their standup.
   * null = user has not responded yet (DM sent but no reply)
   */
  submittedAt:  timestamp('submitted_at', { withTimezone: true }),

  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})