# PRD: Invocation Flow Migration to Persistent Sprites

**Date:** 2026-01-22

---

## Problem Statement

### What problem are we solving?

Communication with opencode currently happens through the abraxxas UI via comments — an unnatural indirection. The natural workflow is direct dialogue in opencode's web interface.

By starting `opencode serve` on invocation sprites (like manifests do), users can:

- Dialogue directly with opencode in the browser
- Continue conversations after completion or failure
- Fix issues in "cursed" state without re-executing from scratch

This requires sprites to persist (no auto-destruction) and removes the need for the comments system entirely.

### Why now?

Manifests already use this pattern successfully. Invocations should follow the same model for workflow consistency.

### Who is affected?

- **Primary users:** Developers executing invocations who need to fix failures or continue work
- **Secondary users:** Anyone managing invocations who benefits from cleaner UI

---

## Proposed Solution

### Overview

Migrate invocations to use persistent sprites that survive completion/error. Remove comments system entirely. Add sprite access buttons (URL, password, sprite name) to task cards. Simplify UI to match manifest's minimal/esoteric aesthetic.

### Key Changes

1. **Sprites persist** after completion or error (no auto-destruction)
2. **Remove comments** — dialogue happens in opencode on the sprite
3. **Add sprite controls** to task cards: copy URL, copy password, copy sprite name, open external
4. **Store sprite credentials** in opencodeSessions (spriteUrl, spritePassword)
5. **Simplify detail modal** — show initial prompt only, minimal metadata
6. **Add destroy button** — user manually destroys sprite when done
7. **Display statistics** on cards (message count, tokens) with minimal styling

---

## End State

When this PRD is complete, the following will be true:

- [ ] Sprites persist after task completion (no auto-destruction on `completed` webhook)
- [ ] Sprites persist after task error (no auto-destruction on `error` webhook)
- [ ] `opencodeSessions` table stores `spriteUrl` and `spritePassword`
- [ ] Task cards show sprite action buttons (copy URL, copy password, copy name, open external)
- [ ] Task cards show destroy sprite button
- [ ] Destroy action calls `sprites.destroySprite()` and cleans up session
- [ ] Comments system removed from invocation flow (no AddCommentForm, no comment list)
- [ ] Comments no longer built into execution prompt
- [ ] Task detail modal shows only: title, initial prompt (title + description), branch link
- [ ] UI matches manifest's minimal aesthetic (dashed borders, sparse labels, monospace)
- [ ] Statistics displayed on cards (messageCount, tokens) with minimal styling
- [ ] Gnostic confirmation dialog for sprite destruction ("Banish this Invocation?")

---

## Acceptance Criteria

### Schema Changes

- [ ] `opencodeSessions` has `spriteUrl` text column
- [ ] `opencodeSessions` has `spritePassword` text column
- [ ] Migration adds columns to existing table

### Sprite Lifecycle

- [ ] `spawnSpriteForTask()` stores spriteUrl and spritePassword in session
- [ ] Webhook handler for `completed` does NOT destroy sprite
- [ ] Webhook handler for `error` does NOT destroy sprite
- [ ] Task status still transitions correctly (ritual → vanquished or cursed)

### Task Card UI

- [ ] Shows copy sprite name button (Terminal icon) when sprite exists
- [ ] Shows copy URL button (Link icon) when spriteUrl exists
- [ ] Shows copy password button (Lock icon) when spritePassword exists
- [ ] Shows open external button (ExternalLink icon) when spriteUrl exists
- [ ] Shows destroy button (Trash2 icon) when sprite exists
- [ ] Buttons match manifest card styling (h-7 px-2, ghost variant, white/40 hover states)
- [ ] No comments section on card
- [ ] Statistics displayed on card (message count, tokens) with minimal styling

### Destroy Sprite Action

- [ ] `destroySpriteAction(sessionId)` server action exists
- [ ] Verifies user owns the task/session
- [ ] Calls `sprites.destroySprite(spriteName)`
- [ ] Clears spriteUrl, spritePassword, spriteName from session
- [ ] Shows gnostic confirmation dialog before destruction

### Task Detail Modal (Minimal)

- [ ] Shows task title
- [ ] Shows initial prompt (task title + description concatenated)
- [ ] Shows branch link (if branchName exists)
- [ ] Shows error message (if error state)
- [ ] No comments section
- [ ] No type/model/state selects
- [ ] No session stats display
- [ ] Delete task button remains

### Prompt Building

- [ ] Remove comment concatenation from `buildPrompt()`
- [ ] Prompt is just: task title + description

---

## Technical Context

### Existing Patterns

- Manifest card buttons: `components/manifest/manifest-card.tsx:459-510`
- Manifest delete with gnostic dialog: `components/manifest/manifest-card.tsx:115-125`
- Sprite destruction: `lib/core/manifest/delete-manifest-action.ts`
- Sprite spawning with credentials: `lib/core/sprites/spawn-sprite.ts`

### Key Files

- `lib/services/db/schema.ts` — add spriteUrl, spritePassword to opencodeSessions
- `lib/core/task/execute-task-action.ts` — store credentials, remove comment building
- `lib/core/sprites/spawn-sprite.ts` — return spriteUrl/password for storage
- `app/api/webhooks/sprite/[taskId]/route.ts` — remove sprite destruction on complete/error
- `app/(dashboard)/rituals/[id]/board-client.tsx` — update DraggableCard with sprite buttons
- `components/invocations/task-detail-modal.tsx` — simplify to minimal view
- `components/invocations/add-comment-form.tsx` — delete file
- `components/invocations/comment-list.tsx` — delete file (if exists)

### Data Model Changes

```sql
ALTER TABLE "opencodeSessions" ADD COLUMN "spriteUrl" text;
ALTER TABLE "opencodeSessions" ADD COLUMN "spritePassword" text;
```

No data backfill needed — existing sessions have destroyed sprites anyway.

---

## Risks & Mitigations

| Risk                               | Likelihood | Impact | Mitigation                                                       |
| ---------------------------------- | ---------- | ------ | ---------------------------------------------------------------- |
| Orphaned sprites accumulate        | Medium     | Medium | UI prominently shows destroy button; consider future cleanup job |
| Users expect comments to work      | Low        | Low    | Clear UI — no comment input visible                              |
| Existing sessions lack credentials | Low        | Low    | Only affects already-destroyed sprites                           |

---

## Non-Goals (v1)

- **Auto-cleanup of old sprites** — manual destruction only for now
- **Sprite sharing between tasks** — still 1 sprite per task
- **Progress tracking UI** — stats recorded but not displayed
- **Comment migration** — existing comments remain in DB but not shown

---

## Open Questions

| Question                                                | Owner | Status |
| ------------------------------------------------------- | ----- | ------ |
| Should we show sprite status (running/stopped) on card? | —     | Open   |
| Keep delete task vs just destroy sprite, or both?       | —     | Open   |

---

## Appendix

### Terminology

| Term       | Meaning                    |
| ---------- | -------------------------- |
| Invocation | A task to be executed      |
| Sprite     | Remote VM running opencode |
| Cursed     | Failed execution state     |
| Vanquished | Completed execution state  |
| Banish     | Destroy/delete             |
