import { pgTable, text, timestamp, boolean, pgEnum } from 'drizzle-orm/pg-core'
import { defineRelations } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

////////////////////////////////////////////////////////////////////////
// ENUMS
////////////////////////////////////////////////////////////////////////
export const taskStatusEnum = pgEnum('task_status', [
  'abyss',
  'altar',
  'ritual',
  'cursed',
  'trial',
  'vanquished'
])

export const taskExecutionStateEnum = pgEnum('task_execution_state', [
  'idle',
  'in_progress',
  'awaiting_review',
  'completed',
  'error'
])

export const taskTypeEnum = pgEnum('task_type', ['bug', 'feature', 'plan', 'other'])

export const taskModelEnum = pgEnum('task_model', [
  'grok-1',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5'
])

export const sessionStatusEnum = pgEnum('session_status', [
  'pending',
  'in_progress',
  'completed',
  'error'
])

export const executionModeEnum = pgEnum('execution_mode', ['local', 'sprite'])

export const manifestStatusEnum = pgEnum('manifest_status', [
  'pending',
  'active',
  'running',
  'completed',
  'error'
])

export const spriteStatusEnum = pgEnum('sprite_status', ['pending', 'active', 'running', 'error'])

////////////////////////////////////////////////////////////////////////
// AUTH - Better-auth expects singular model names
////////////////////////////////////////////////////////////////////////
export const user = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),

  // Better Auth
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),

  role: text('role', {
    enum: ['USER', 'ADMIN']
  })
    .notNull()
    .default('USER'),

  // Encrypted opencode auth.json for sprite execution
  encryptedOpencodeAuth: text('encryptedOpencodeAuth'),
  // Track Anthropic OAuth expiry (epoch ms) for UI warnings
  anthropicOauthExpiresAt: timestamp('anthropicOauthExpiresAt'),

  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})
export type User = typeof user.$inferSelect
export type InsertUser = typeof user.$inferInsert

////////////////////////////////////////////////////////////////////////
// PROJECTS
////////////////////////////////////////////////////////////////////////
export const projects = pgTable('projects', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  repositoryUrl: text('repositoryUrl').notNull(),
  encryptedGithubToken: text('encryptedGithubToken').notNull(),
  agentsMdContent: text('agentsMdContent'),
  /** Optional bash script to run after sprite setup (pnpm install, docker compose, .env.local) */
  localSetupScript: text('localSetupScript'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

export type Project = typeof projects.$inferSelect
export type InsertProject = typeof projects.$inferInsert

////////////////////////////////////////////////////////////////////////
// TASKS
////////////////////////////////////////////////////////////////////////
export const tasks = pgTable('tasks', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  type: taskTypeEnum('type').notNull(),
  model: taskModelEnum('model').notNull(),
  status: taskStatusEnum('status').notNull().default('abyss'),
  executionState: taskExecutionStateEnum('executionState').notNull().default('idle'),
  branchName: text('branchName'),
  completedAt: timestamp('completedAt'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

export type Task = typeof tasks.$inferSelect
export type InsertTask = typeof tasks.$inferInsert

////////////////////////////////////////////////////////////////////////
// COMMENTS
////////////////////////////////////////////////////////////////////////
export const comments = pgTable('comments', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  taskId: text('taskId')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
  isAgentComment: boolean('isAgentComment').notNull().default(false),
  agentName: text('agentName'),
  content: text('content').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

export type Comment = typeof comments.$inferSelect
export type InsertComment = typeof comments.$inferInsert

////////////////////////////////////////////////////////////////////////
// OPENCODE SESSIONS
////////////////////////////////////////////////////////////////////////
export const opencodeSessions = pgTable('opencodeSessions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  taskId: text('taskId')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  sessionId: text('sessionId').notNull(),
  status: sessionStatusEnum('status').notNull().default('pending'),
  executionMode: executionModeEnum('executionMode').notNull(),
  spriteName: text('spriteName'),
  spriteUrl: text('spriteUrl'),
  webhookSecret: text('webhookSecret'),
  branchName: text('branchName'),
  pullRequestUrl: text('pullRequestUrl'),
  errorMessage: text('errorMessage'),
  logs: text('logs'),
  messageCount: text('messageCount'),
  inputTokens: text('inputTokens'),
  outputTokens: text('outputTokens'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  completedAt: timestamp('completedAt')
})

export type OpencodeSession = typeof opencodeSessions.$inferSelect
export type InsertOpencodeSession = typeof opencodeSessions.$inferInsert

////////////////////////////////////////////////////////////////////////
// MANIFESTS
////////////////////////////////////////////////////////////////////////
export const manifests = pgTable('manifests', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prdName: text('prdName'),
  status: manifestStatusEnum('status').notNull().default('pending'),
  spriteName: text('spriteName'),
  spriteUrl: text('spriteUrl'),
  webhookSecret: text('webhookSecret'),
  errorMessage: text('errorMessage'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  completedAt: timestamp('completedAt')
})

export type Manifest = typeof manifests.$inferSelect
export type InsertManifest = typeof manifests.$inferInsert

////////////////////////////////////////////////////////////////////////
// SPRITES - Active sprites for manifests and invocations
////////////////////////////////////////////////////////////////////////
export const spriteTypeEnum = pgEnum('sprite_type', ['manifest', 'invocation'])

export const sprites = pgTable('sprites', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  /** Branch name for both manifests and invocations */
  branchName: text('branchName').notNull(),
  type: spriteTypeEnum('type').notNull(),
  status: spriteStatusEnum('status').notNull().default('pending'),
  spriteName: text('spriteName'),
  spriteUrl: text('spriteUrl'),
  webhookSecret: text('webhookSecret'),
  errorMessage: text('errorMessage'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

export type Sprite = typeof sprites.$inferSelect
export type InsertSprite = typeof sprites.$inferInsert

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

////////////////////////////////////////////////////////////////////////
// RELATIONS - Drizzle v1.0 RQB v2 API
////////////////////////////////////////////////////////////////////////
export const relations = defineRelations(
  {
    user,
    session,
    account,
    verification,
    projects,
    tasks,
    comments,
    opencodeSessions,
    manifests,
    sprites
  },
  r => ({
    user: {
      projects: r.many.projects({
        from: r.user.id,
        to: r.projects.userId
      })
    },
    projects: {
      user: r.one.user({
        from: r.projects.userId,
        to: r.user.id,
        optional: false
      }),
      tasks: r.many.tasks({
        from: r.projects.id,
        to: r.tasks.projectId
      }),
      manifests: r.many.manifests({
        from: r.projects.id,
        to: r.manifests.projectId
      }),
      sprites: r.many.sprites({
        from: r.projects.id,
        to: r.sprites.projectId
      })
    },
    tasks: {
      project: r.one.projects({
        from: r.tasks.projectId,
        to: r.projects.id,
        optional: false
      }),
      comments: r.many.comments({
        from: r.tasks.id,
        to: r.comments.taskId
      }),
      opencodeSessions: r.many.opencodeSessions({
        from: r.tasks.id,
        to: r.opencodeSessions.taskId
      })
    },
    comments: {
      task: r.one.tasks({
        from: r.comments.taskId,
        to: r.tasks.id,
        optional: false
      }),
      user: r.one.user({
        from: r.comments.userId,
        to: r.user.id,
        optional: true
      })
    },
    opencodeSessions: {
      task: r.one.tasks({
        from: r.opencodeSessions.taskId,
        to: r.tasks.id,
        optional: false
      })
    },
    manifests: {
      project: r.one.projects({
        from: r.manifests.projectId,
        to: r.projects.id,
        optional: false
      })
    },
    sprites: {
      project: r.one.projects({
        from: r.sprites.projectId,
        to: r.projects.id,
        optional: false
      })
    }
  })
)
