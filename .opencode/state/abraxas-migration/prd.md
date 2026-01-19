# PRD: Abraxas Migration

**Date:** 2026-01-19

---

## Problem Statement

### What problem are we solving?

The Abraxas project management application exists in `old_repo/` with functional features but incompatible architecture. The new repo (`abraxxas`) has proper infrastructure (Effect-TS services, server actions, better-auth OTP, Drizzle ORM with Neon) but lacks the Abraxas domain features.

**Current state:**

- `old_repo/`: Working UI, API routes for CRUD, Sprites.dev execution, but uses legacy patterns (API routes for CRUD, inconsistent Effect usage, plain-text GitHub tokens)
- `abraxxas/`: Proper infrastructure but only example "post" domain, no project management features

### Why now?

The new repo infrastructure is production-ready. Continuing development in old_repo means accumulating technical debt that becomes harder to migrate later. Consolidating now enables:

- Proper Effect-TS patterns throughout
- Server actions instead of API routes
- Encrypted credential storage
- Better testability

### Who is affected?

- **Primary users:** Solo developer managing AI-assisted coding tasks across multiple repositories
- **Secondary users:** The AI agents (OpenCode via Sprites.dev) that execute the invocations

---

## Proposed Solution

### Overview

Migrate all Abraxas domain functionality from `old_repo/` to `abraxxas/`, adapting to the new architecture patterns while preserving all aesthetics and functionality. This includes: Rituals (projects), Invocations (tasks), Comments, OpenCode sessions, Sprites.dev execution, and the ASCII fire background effect.

### User Experience

The user experience remains identical to the old_repo:

1. **Ritual Chamber** (Dashboard) - Grid of project cards with dark occult theme
2. **Ritual Board** (Kanban) - Six mystical columns with drag-and-drop invocations
3. **Invocation Cards** - Draggable task cards showing execution state
4. **Task Detail Modal** - Full task view with comments thread
5. **ASCII Fire Background** - Dynamic fire intensity based on running tasks

#### User Flow: Execute an Invocation

1. User drags invocation card from "The Altar" to "The Ritual" column
2. System spawns Sprite, clones repository, starts OpenCode execution
3. Fire intensity increases as tasks run
4. Webhooks update progress, post agent comments
5. On completion: task moves to "The Trial", agent posts summary
6. On error: task moves to "Cursed", agent posts error details

### Design Considerations

- **Dark occult theme** preserved exactly (zinc backgrounds, red accents, white/40 text)
- **Monospace font** (IBM Plex Mono) throughout
- **Dashed borders** on cards and columns
- **ASCII fire effect** at bottom of screen with intensity scaling
- **No accessibility changes** - maintain exact aesthetic

---

## End State

When this PRD is complete, the following will be true:

- [ ] All `old_repo/` functionality works in `abraxxas/`
- [ ] Database schema includes: projects, tasks, comments, opencode_sessions
- [ ] Server actions replace API routes for CRUD operations
- [ ] API route exists only for Sprite webhook callbacks
- [ ] GitHub tokens encrypted in database
- [ ] Fire intensity context provides dynamic background effect
- [ ] Drag-and-drop triggers Sprites.dev execution
- [ ] Webhook handler processes sprite callbacks
- [ ] All existing tests pass
- [ ] `pnpm tsc` passes with no errors
- [ ] `pnpm lint` passes with no errors

---

## Success Metrics

### Quantitative

| Metric            | Current | Target | Measurement Method          |
| ----------------- | ------- | ------ | --------------------------- |
| Feature parity    | 0%      | 100%   | Manual testing of all flows |
| TypeScript errors | N/A     | 0      | `pnpm tsc`                  |
| Lint errors       | N/A     | 0      | `pnpm lint`                 |

### Qualitative

- UI/UX identical to old_repo (no visual regression)
- Cleaner codebase following Effect-TS patterns
- Better separation of concerns (services, actions, components)

---

## Acceptance Criteria

### Database Schema

- [ ] `projects` table: id, userId, name, description, repositoryUrl, encryptedGithubToken, agentsMdContent, timestamps
- [ ] `tasks` table: id, projectId, title, description, type, model, status, executionState, branchName, timestamps
- [ ] `comments` table: id, taskId, userId, isAgentComment, agentName, content, timestamps
- [ ] `opencodeSessions` table: id, taskId, sessionId, status, executionMode, spriteName, webhookSecret, branchName, prUrl, errorMessage, logs, messageCount, inputTokens, outputTokens, timestamps
- [ ] pgEnum for task_status: abyss, altar, ritual, cursed, trial, vanquished
- [ ] pgEnum for task_execution_state: idle, in_progress, awaiting_review, completed, error
- [ ] pgEnum for task_type: bug, feature, plan, other
- [ ] pgEnum for task_model: grok-1, claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5
- [ ] pgEnum for session_status: pending, in_progress, completed, error
- [ ] pgEnum for execution_mode: local, sprite
- [ ] Drizzle relations configured

### Effect-TS Services

- [ ] `Sprites` service: createSprite, destroySprite, execCommand, listSprites
- [ ] `SpritesConfig` via Effect Config: SPRITES_TOKEN, WEBHOOK_BASE_URL, SPRITE_TIMEOUT_MS
- [ ] All services use `Effect.Service` pattern with `layer` and `Live` static properties
- [ ] Proper error types: SpritesApiError, SpritesNotFoundError, SpritesConfigError, SpriteExecutionError

### Server Actions (lib/core/project/)

- [ ] `create-project-action.ts` - Create new ritual
- [ ] `update-project-action.ts` - Update ritual settings
- [ ] `delete-project-action.ts` - Delete ritual
- [ ] `get-projects.ts` - List user's rituals (RSC data loading)
- [ ] `get-project.ts` - Get single ritual (RSC data loading)

### Server Actions (lib/core/task/)

- [ ] `create-task-action.ts` - Create new invocation
- [ ] `update-task-action.ts` - Update invocation (status, type, model, executionState)
- [ ] `delete-task-action.ts` - Delete invocation
- [ ] `execute-task-action.ts` - Trigger Sprites.dev execution
- [ ] `get-tasks.ts` - List tasks for a project (RSC data loading)
- [ ] `get-task.ts` - Get single task (RSC data loading)

### Server Actions (lib/core/comment/)

- [ ] `create-comment-action.ts` - Add user comment
- [ ] `create-agent-comment.ts` - Add agent comment (internal function)
- [ ] `get-comments.ts` - List comments for a task (RSC data loading)

### Server Actions (lib/core/session/)

- [ ] `create-session.ts` - Create opencode session record
- [ ] `update-session.ts` - Update session status/stats
- [ ] `get-latest-session.ts` - Get most recent session for task

### API Routes

- [ ] `app/api/webhooks/sprite/[taskId]/route.ts` - Sprite callback handler
- [ ] HMAC signature verification
- [ ] Handle payload types: started, progress, completed, error, question

### Pages (app/(dashboard)/)

- [ ] `page.tsx` - Ritual Chamber (projects list)
- [ ] `rituals/[id]/page.tsx` - Ritual Board (kanban)
- [ ] Both use Suspense + Content pattern per PAGE_PATTERNS spec
- [ ] Both have `export const dynamic = 'force-dynamic'`

### Components

- [ ] `components/rituals/create-ritual-dialog.tsx` - Create project dialog
- [ ] `components/invocations/create-invocation-dialog.tsx` - Create task dialog
- [ ] `components/invocations/task-detail-modal.tsx` - Task detail view
- [ ] `components/invocations/comment.tsx` - Comment display
- [ ] `components/invocations/add-comment-form.tsx` - Comment input
- [ ] `components/ascii-fire.tsx` - Fire animation
- [ ] `components/fire-background.tsx` - Fire wrapper

### Context & State

- [ ] `lib/contexts/fire-intensity-context.tsx` - Fire intensity provider
- [ ] Fire intensity calculation based on running tasks + message counts + time elapsed

### Styling

- [ ] `app/globals.css` - Occult theme variables preserved
- [ ] IBM Plex Mono font configured
- [ ] Dark mode only (no light mode)

### Security

- [ ] GitHub tokens encrypted before storage
- [ ] Encryption key from environment variable
- [ ] Webhook signature verification with timing-safe comparison

---

## Technical Context

### Existing Patterns

- `lib/services/db/live-layer.ts` - Db service pattern to follow
- `lib/services/auth/live-layer.ts` - Auth service with Config usage
- `lib/core/` - Domain logic structure (create new `project/`, `task/`, `comment/`, `session/` subdirectories)
- `specs/DATA_ACCESS_PATTERNS.md` - Server action patterns
- `specs/PAGE_PATTERNS.md` - Suspense + Content pattern for pages

### Key Files

- `lib/layers.ts` - Add Sprites service to AppLayer
- `lib/services/db/schema.ts` - Add new tables
- `app/layout.tsx` - Add FireIntensityProvider
- `components/ui/` - Existing shadcn components to reuse

### System Dependencies

- **Sprites.dev API** - External service for cloud execution
- **PostgreSQL/Neon** - Database
- **@dnd-kit/core** - Drag-and-drop (add to package.json)
- **date-fns** - Timestamp formatting (add to package.json)
- **lucide-react** - Icons (already installed)

### Data Model Changes

**New tables:**

- `projects` - User's rituals (repositories)
- `tasks` - Invocations on the board
- `comments` - Task comment thread
- `opencode_sessions` - Execution session tracking

**Schema migration:**

- Remove example `post` table
- Add all new tables with enums

---

## Risks & Mitigations

| Risk                        | Likelihood | Impact | Mitigation                                    |
| --------------------------- | ---------- | ------ | --------------------------------------------- |
| Sprites.dev API changes     | Low        | High   | Abstract behind service interface             |
| Token encryption complexity | Medium     | Medium | Use established crypto patterns (AES-256-GCM) |
| Drag-and-drop performance   | Low        | Medium | Use @dnd-kit with PointerSensor constraints   |
| Fire animation performance  | Low        | Low    | Already optimized in old_repo                 |

---

## Alternatives Considered

### Alternative 1: Keep API Routes

- **Description:** Migrate old_repo API routes as-is
- **Pros:** Faster migration, less refactoring
- **Cons:** Doesn't follow new repo patterns, harder to maintain
- **Decision:** Rejected. Server actions provide better type safety and follow project conventions.

### Alternative 2: Remove Sprites.dev, Local Only

- **Description:** Drop cloud execution, use local OpenCode only
- **Pros:** Simpler architecture, no external dependency
- **Cons:** Loses cloud execution capability, limits use cases
- **Decision:** Rejected. Sprites.dev is core to the product vision.

---

## Non-Goals (v1)

Explicitly out of scope for this PRD:

- **Ralph Loop mode** - Autonomous task execution not implemented in old_repo yet
- **GitHub PR creation** - Agent handles this, not the app
- **Multi-user/team support** - Single user only
- **Real-time WebSocket updates** - Polling-based status is sufficient
- **Mobile responsiveness** - Desktop-first
- **Light mode theme** - Dark only

---

## Interface Specifications

### Sprite Webhook API

```
POST /api/webhooks/sprite/[taskId]

Headers:
  X-Webhook-Signature: sha256=<hmac>

Request Body:
  {
    type: "started" | "progress" | "completed" | "error" | "question",
    sessionId: string,
    taskId: string,
    summary?: string,
    error?: string,
    question?: string,
    stats?: { messageCount: number, inputTokens: number, outputTokens: number },
    progress?: { message: string, messageCount?: number, inputTokens?: number, outputTokens?: number }
  }

Response:
  200: { success: true }
  400: { error: string }
  401: { error: "Invalid signature" }
```

### Server Action Patterns

All server actions follow the pattern in `specs/DATA_ACCESS_PATTERNS.md`:

- Use `NextEffect.runPromise`
- Return typed error objects or void with revalidation
- Include span annotations for observability

---

## Documentation Requirements

- [ ] Update `AGENTS.md` with new domain structure
- [ ] Add Sprites service to service hierarchy docs
- [ ] Document environment variables needed

---

## Open Questions

| Question                          | Owner | Due Date | Status |
| --------------------------------- | ----- | -------- | ------ |
| Encryption key rotation strategy? | -     | -        | Open   |
| Sprites.dev rate limits?          | -     | -        | Open   |

---

## Appendix

### Glossary

- **Ritual** - A project/repository bound to Abraxas
- **Invocation** - A task/card on the kanban board
- **Sprite** - A cloud VM from Sprites.dev for code execution
- **The Abyss** - Backlog column
- **The Altar** - Ready for execution column
- **The Ritual** - Active execution column
- **Cursed** - Blocked/error column
- **The Trial** - Awaiting review column
- **Vanquished** - Completed column

### References

- `old_repo/docs/DEVELOPMENT_PLAN.md` - Original development plan
- `specs/DATA_ACCESS_PATTERNS.md` - Server action patterns
- `specs/PAGE_PATTERNS.md` - Page component patterns
- `specs/EFFECT_BEST_PRACTICES.md` - Effect-TS guidelines
