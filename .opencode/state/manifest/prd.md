# PRD: Manifest (PRD Creation & Task-Loop Service)

**Date:** 2026-01-20

---

## Problem Statement

### What problem are we solving?

Users need a way to create PRDs and execute them autonomously through a task-loop. Currently, PRD creation happens locally via the `/prd` command, but there's no way to:

1. Run PRD creation in a cloud sprite for shared/persistent access
2. Execute the resulting prd.json tasks via a task-loop
3. Track Manifest sprite connection details (URL, password) for OpenCode web access
4. Receive completion webhooks when the task-loop finishes

### Why now?

The task execution infrastructure exists (Sprites service, webhook handlers, session tracking). Manifest extends this to support the full PRD workflow: creation, task breakdown, and autonomous implementation.

### Who is affected?

- **Primary users:** Developers who want AI-assisted PRD creation and implementation
- **Secondary users:** The AI agent running in the sprite (needs `/prd`, `/prd-task`, `/complete-next-task` commands and `task-loop` binary)

---

## Proposed Solution

### Overview

A Manifest is a long-running sprite bound to a project that:

1. Clones the project repository
2. Provides a public OpenCode web interface (password-protected via basic auth)
3. Has custom commands/skills installed for PRD workflows
4. Runs a task-loop that implements PRD tasks until completion
5. Reports completion via webhook, then destroys itself

### User Experience

#### User Flow: Create a Manifest

1. User navigates to project page
2. User clicks "Create Manifest" and provides PRD name (e.g., "user-auth-feature")
3. System spawns sprite with:
   - Public URL with password auth
   - Repository cloned
   - Opencode auth.json uploaded (if user has configured it)
   - Opencode commands/skills installed from abraxas-opencode-setup
   - task-loop binary installed
4. System stores manifest record with sprite name, URL, password
5. UI shows Manifest card with:
   - Sprite name (copyable)
   - Sprite URL (copyable, opens OpenCode web in new tab)
   - Sprite password (copyable)
   - "Start Task Loop" button (disabled until prd.json exists)
   - "Stop Task Loop" button (visible when task-loop running)
6. User copies password, clicks URL to open OpenCode web, pastes password
7. User runs `/prd <feature-description>` to create PRD interactively
8. User runs `/prd-task <prd-name>` to convert PRD to prd.json
9. User clicks "Start Task Loop" in UI (or runs `task-loop <prd-name>` manually)
10. System sends exec command to sprite: `task-loop <prd-name>`
11. task-loop sends webhook with prd.json before starting work
12. User can click "Stop Task Loop" to kill the process
13. Task-loop webhook fires on completion/error with final prd.json
14. System destroys sprite, updates manifest status

#### User Flow: View Existing Manifest

1. User sees Manifest card on project page
2. Card shows status (active/completed/error), sprite details
3. If active: user can copy credentials, open OpenCode web
4. If completed: card shows completion timestamp, can be dismissed

### Design Considerations

- Manifest card follows existing occult theme (dashed borders, dark background)
- Copy buttons use icon-only style for compact display
- Status badges: "Summoning" (pending), "Active" (running), "Complete" (vanquished), "Failed" (cursed)

---

## End State

When this PRD is complete, the following will be true:

- [ ] `manifests` table stores manifest records per project
- [ ] Only one active manifest per project allowed
- [ ] Manifest creation spawns public sprite with password auth
- [ ] Sprite has opencode config (commands, skills, task-loop binary)
- [ ] Webhook endpoint handles task-loop completion
- [ ] Manifest card displays copyable sprite name, URL, password
- [ ] Clicking URL opens OpenCode web in new tab
- [ ] Completed manifest destroys sprite and updates status
- [ ] All acceptance criteria pass
- [ ] `pnpm tsc` passes with no errors
- [ ] `pnpm lint` passes with no errors

---

## Success Metrics

### Quantitative

| Metric                         | Current | Target | Measurement Method                    |
| ------------------------------ | ------- | ------ | ------------------------------------- |
| Manifest creation success rate | N/A     | >95%   | Webhook completion vs errors          |
| Sprite setup time              | N/A     | <60s   | Time from create to webhook "started" |

### Qualitative

- User can create PRD and run task-loop without local setup
- Connection flow (copy password, open URL) is intuitive

---

## Acceptance Criteria

### Database Schema

- [ ] `manifests` table with: id, projectId, prdName, status, spriteName, spriteUrl, spritePassword, webhookSecret, prdJson (text, stores prd.json - updated before task-loop starts and on completion), errorMessage, createdAt, updatedAt, completedAt
- [ ] `manifestStatusEnum`: pending, active, running, completed, error
- [ ] Foreign key to projects.id with cascade delete
- [ ] Only one manifest with status='active' allowed per project (application logic check on create)

### Server Actions (lib/core/manifest/)

- [ ] `create-manifest-action.ts` - Creates manifest, spawns sprite, returns credentials
- [ ] `get-manifests.ts` - Lists manifests for a project (RSC data loading)
- [ ] `get-active-manifest.ts` - Gets active manifest for project (if exists)
- [ ] `start-task-loop-action.ts` - Sends command to sprite to start task-loop for given prdName
- [ ] `stop-task-loop-action.ts` - Sends command to sprite to kill task-loop process

### Manifest Sprite Spawning (lib/core/manifest/)

- [ ] `spawn-manifest-sprite.ts` - Effect function to:
  - Generate sprite name: `manifest-{projectId-short}-{timestamp}`
  - Generate password: random 32-char alphanumeric
  - Generate webhook secret
  - Create sprite with `url_settings.auth = 'public'`
  - Clone repository to /home/sprite/repo
  - Upload opencode auth.json (if user has encryptedOpencodeAuth configured)
  - Install opencode commands from abraxas-opencode-setup repo to ~/.config/opencode/command/
  - Install opencode skills from abraxas-opencode-setup repo to ~/.config/opencode/skill/
  - Install task-loop binary to /usr/local/bin/task-loop
  - Log each setup step with timestamps for debugging
  - Send "started" webhook when setup complete
  - Return { spriteName, spriteUrl, spritePassword, webhookSecret }

### Sprites Service Extension

- [ ] `updateUrlSettings(name, auth)` method added to Sprites service
- [ ] Used to set sprite to public after creation

### API Routes

- [ ] `app/api/webhooks/manifest/[manifestId]/route.ts` - Handles manifest lifecycle webhooks
- [ ] HMAC signature verification
- [ ] Handle payload types: started, task_loop_started, completed, error
- [ ] On started: update manifest status to active (sprite ready)
- [ ] On task_loop_started: update manifest status to running, store prdJson from payload
- [ ] On completed: update manifest status, store final prdJson, destroy sprite
- [ ] On error: update manifest status with errorMessage, destroy sprite

### UI Components

- [ ] `components/manifest/manifest-card.tsx` - Displays manifest with:
  - Status badge (Summoning/Active/Running/Complete/Failed)
  - PRD name
  - Copyable sprite name field
  - Copyable sprite URL field
  - Copyable password field (masked until hover/click)
  - "Open OpenCode" button that opens URL in new tab
  - "Start Task Loop" button (calls start-task-loop-action)
  - "Stop Task Loop" button (calls stop-task-loop-action, visible when running)
  - Timestamps
- [ ] `components/manifest/create-manifest-dialog.tsx` - Form with:
  - PRD name input (kebab-case, validated)
  - Submit creates manifest and shows credentials
  - Loading state during sprite creation
  - Error display on failure

### Project Page Integration

- [ ] Manifest section on ritual board page (app/(dashboard)/rituals/[id]/page.tsx)
- [ ] Shows active manifest card if exists
- [ ] Shows "Create Manifest" button if no active manifest
- [ ] Shows completed/error manifests in collapsed history section

---

## Technical Context

### Existing Patterns

- `lib/core/sprites/spawn-sprite.ts` - Task sprite spawning pattern to follow
- `lib/core/sprites/callback-script.ts` - Script generation with webhook callbacks
- `lib/services/sprites/live-layer.ts` - Sprites service API methods
- `app/api/webhooks/sprite/[taskId]/route.ts` - Webhook handler pattern

### Key Files

- `lib/services/db/schema.ts` - Add manifests table
- `lib/services/sprites/live-layer.ts` - Add updateUrlSettings method
- `lib/core/manifest/` - New domain directory
- `components/manifest/` - New UI components

### System Dependencies

- **Sprites.dev API** - Cloud sprite management
- **abraxas-opencode-setup repo** - Commands, skills, task-loop binary
- **OpenCode web** - https://opencode.ai/web for browser-based agent access

### Data Model Changes

**New table: `manifests`**

```typescript
export const manifestStatusEnum = pgEnum('manifest_status', [
  'pending',
  'active',
  'running',
  'completed',
  'error'
])

export const manifests = pgTable('manifests', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text('projectId')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  prdName: text('prdName').notNull(),
  status: manifestStatusEnum('status').notNull().default('pending'),
  spriteName: text('spriteName'),
  spriteUrl: text('spriteUrl'),
  spritePassword: text('spritePassword'),
  webhookSecret: text('webhookSecret'),
  prdJson: text('prdJson'), // prd.json content - stored before task-loop starts, updated on completion
  errorMessage: text('errorMessage'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  completedAt: timestamp('completedAt')
})
```

---

## Risks & Mitigations

| Risk                                 | Likelihood | Impact | Mitigation                                           |
| ------------------------------------ | ---------- | ------ | ---------------------------------------------------- |
| Sprite setup fails mid-way           | Medium     | Medium | Cleanup sprite on any setup error; log each step     |
| abraxas-opencode-setup repo changes  | Low        | Medium | Pin to specific commit/tag when cloning              |
| User forgets password before copying | Medium     | Low    | Password visible in DB, could add "regenerate" later |
| Task-loop runs forever               | Low        | High   | Max iterations (25) built into task-loop.sh          |
| Sprite stays running after task-loop | Medium     | Medium | Webhook always destroys sprite on completed/error    |

---

## Alternatives Considered

### Alternative 1: Store password encrypted

- **Description:** Encrypt sprite password like GitHub tokens
- **Pros:** More secure storage
- **Cons:** Password needs to be displayed to user anyway; complexity not justified
- **Decision:** Rejected. Store plaintext since it's generated per-sprite and displayed in UI.

### Alternative 2: Use sprite auth instead of public+password

- **Description:** Keep sprite private, use Sprites.dev token auth
- **Pros:** More secure, no password management
- **Cons:** OpenCode web doesn't support bearer token auth for sprites
- **Decision:** Rejected. Public+password is required for OpenCode web access.

### Alternative 3: Auto-start task-loop after PRD creation

- **Description:** Automatically run task-loop when prd.json is created
- **Pros:** More automated
- **Cons:** User may want to review PRD first; loses interactive control
- **Decision:** Rejected. User should explicitly start task-loop via command.

---

## Non-Goals (v1)

Explicitly out of scope for this PRD:

- **Multiple active manifests per project** - One at a time simplifies UI and resource management
- **Manifest checkpoints/restore** - Sprites have checkpoints, but not exposing in v1
- **Real-time task progress** - Polling-based status is sufficient
- **Manifest sharing between users** - Single-user only
- **Password regeneration** - User must create new manifest if password lost

---

## Interface Specifications

### Manifest Webhook API

```
POST /api/webhooks/manifest/[manifestId]

Headers:
  X-Webhook-Signature: sha256=<hmac>

Request Body:
  {
    type: "started" | "task_loop_started" | "completed" | "error",
    manifestId: string,
    prdJson?: string,    // prd.json content - sent on task_loop_started and completed
    error?: string,
    summary?: string
  }

Response:
  200: { success: true }
  400: { error: string }
  401: { error: "Invalid signature" }
```

### Manifest Sprite Setup Script

The spawn-manifest-sprite function generates a script that:

1. Runs opencode install (if needed)
2. Clones repository to /home/sprite/repo
3. Creates and checks out branch `manifest/{prdName}`
4. Downloads abraxas-opencode-setup repo
5. Copies command/\*.md to ~/.config/opencode/command/
6. Copies skill/\*/ to ~/.config/opencode/skill/
7. Copies bin/task-loop.sh to /usr/local/bin/task-loop (chmod +x)
8. Uploads opencode auth.json (if user has one)
9. Sends "started" webhook
10. Logs each step with timestamps

---

## Documentation Requirements

- [ ] Update AGENTS.md with manifest domain structure
- [ ] Add manifest to WHERE TO LOOK table
- [ ] Document WEBHOOK_BASE_URL environment variable usage for manifest

---

## Open Questions

_All resolved._

---

## Appendix

### Glossary

- **Manifest** - A long-running sprite for PRD creation and task-loop execution
- **Task-loop** - Iterative execution of prd.json tasks until completion
- **PRD** - Product Requirements Document defining feature end state
- **prd.json** - Machine-readable task list derived from PRD

### References

- `lib/core/sprites/spawn-sprite.ts` - Existing sprite spawning pattern
- https://sprites.dev/api/sprites - Sprites API documentation
- https://opencode.ai/docs/web/ - OpenCode web documentation
- https://github.com/GustavEkberg/abraxas-opencode-setup - Commands/skills repo
