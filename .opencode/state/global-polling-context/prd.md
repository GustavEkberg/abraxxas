# PRD: Global Polling Context

**Date:** 2026-01-23

---

## Problem Statement

### What problem are we solving?

Polling logic for task and manifest status updates is currently scattered across the codebase, primarily in `board-client.tsx`. This creates several issues:

1. **Code fragmentation**: Polling logic lives in a single large component file (850+ lines), making it difficult to maintain, extend, or reuse across other views
2. **Redundant network requests**: Multiple components may independently trigger fetches, leading to unnecessary server load and bandwidth consumption
3. **Stale data / race conditions**: Data can get out of sync between components when updates arrive through different paths (polling vs webhooks vs user actions)
4. **Tight coupling**: Polling intervals, retry logic, and data fetching are intertwined with UI rendering logic

### Why now?

As the application grows with more task and manifest interactions, the current approach becomes increasingly brittle. Centralizing polling logic will:
- Reduce cognitive load when debugging data freshness issues
- Enable consistent polling behavior across future views/components
- Provide a single place to optimize network usage and implement advanced patterns (deduplication, batching)

### Who is affected?

- **Primary users:** End users viewing the ritual board who need timely task/manifest status updates
- **Secondary users:** Developers maintaining and extending the polling behavior

---

## Proposed Solution

### Overview

Create a `PollingContext` (or `DataSyncContext`) that centralizes all polling logic for task status, manifest status, and auth state. This context will own:
- Polling intervals and timing
- API calls to dedicated lightweight polling endpoints
- Error handling with exponential backoff
- Data state that components can consume

Components will subscribe to this context and receive all polled data, filtering locally for what they need. The context complements existing webhook-based updates (`revalidatePath`) rather than replacing them.

### User Experience

No visible change to end users. The ritual board will continue to show near-real-time updates for:
- Task execution state changes (pending → in_progress → completed/failed)
- Manifest status transitions (pending → active → running → completed/failed)
- Task statistics (message counts, token usage)

Users will experience more consistent data freshness across the application.

---

## End State

When this PRD is complete, the following will be true:

- [ ] A `PollingContext` exists that manages all polling logic in one place
- [ ] Dedicated lightweight polling API endpoints exist for tasks, manifests, and auth status
- [ ] `board-client.tsx` no longer contains polling logic (uses context instead)
- [ ] Polling automatically starts/stops based on active tasks/manifests
- [ ] Exponential backoff handles network failures gracefully
- [ ] Polling complements webhooks (both can update state; polling fills gaps)
- [ ] `FireIntensityContext` receives running task/manifest data from `PollingContext`
- [ ] Tests cover polling context behavior (start/stop, error handling, data flow)
- [ ] No regression in data freshness or UI responsiveness

---

## Success Metrics

### Quantitative

| Metric | Current | Target | Measurement Method |
|--------|---------|--------|-------------------|
| Polling logic lines in board-client.tsx | ~50 lines | 0 lines | Code inspection |
| Files containing setInterval for data polling | 1 | 1 (context only) | Grep search |
| Network requests during idle (no running tasks) | 0 | 0 | Network tab monitoring |
| Time to reflect status change in UI | ~3-10s | ~2-5s | Manual testing |

### Qualitative

- Developers can easily understand where polling happens by looking at one file
- Adding new polled data types requires changes only to the context and endpoint
- Debugging data freshness issues is straightforward

---

## Acceptance Criteria

### Feature: PollingContext Provider

- [ ] Context provides `tasks`, `manifests`, `authStatus` state
- [ ] Context provides `isPolling`, `lastUpdated`, `error` metadata
- [ ] Context exposes `startPolling()`, `stopPolling()`, `refreshNow()` methods
- [ ] Polling automatically starts when running tasks/manifests exist
- [ ] Polling automatically stops when no running tasks/manifests exist
- [ ] Context is provided at app layout level (alongside existing contexts)

### Feature: Polling API Endpoints

- [ ] `GET /api/polling/status` returns lightweight task/manifest status payload
- [ ] Endpoint accepts `ritualId` parameter to scope the response
- [ ] Response includes only fields needed for status display (no heavy payloads)
- [ ] Endpoint returns auth status (authenticated, session expiry)
- [ ] Response time < 100ms for typical ritual (10 tasks, 5 manifests)

### Feature: Error Handling

- [ ] On network error, polling interval increases (exponential backoff)
- [ ] Backoff sequence: 2s → 4s → 8s → 16s → 30s (max)
- [ ] On successful response, interval resets to base (2s for manifests, 5s for tasks)
- [ ] Error state is exposed to components (for optional UI feedback)
- [ ] Polling resumes automatically when network recovers

### Feature: Integration with Existing Systems

- [ ] `FireIntensityContext` consumes running task/manifest data from `PollingContext`
- [ ] Webhook updates (`revalidatePath`) and polling updates coexist without conflict
- [ ] `board-client.tsx` uses `usePolling()` hook instead of inline polling logic
- [ ] Local storage persistence for running task IDs moves to or integrates with context

---

## Technical Context

### Existing Patterns

- `FireIntensityContext` (`lib/contexts/fire-intensity-context.tsx`): Example of a global context managing derived state from running tasks/manifests
- Server actions with revalidatePath: Current mutation pattern that triggers data refresh
- `router.refresh()` polling: Current approach in `board-client.tsx:538-560`

### Key Files

- `app/(dashboard)/rituals/[id]/board-client.tsx` - Current polling implementation to be refactored
- `lib/contexts/fire-intensity-context.tsx` - Will consume data from new PollingContext
- `app/layout.tsx` - Where PollingContext provider will be added
- `app/api/webhooks/manifest/[manifestId]/route.ts` - Webhook pattern to complement

### System Dependencies

- Next.js App Router (for API routes and context providers)
- Effect-TS (for service layer and error handling)
- Existing database queries for tasks/manifests

### Data Model Changes

No database schema changes required. New API endpoint returns a view of existing data:

```typescript
interface PollingResponse {
  tasks: Array<{
    id: string
    executionState: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
    messageCount: number
    totalTokens: number
    updatedAt: string
  }>
  manifests: Array<{
    id: string
    status: 'draft' | 'pending' | 'active' | 'running' | 'completed' | 'failed' | 'cancelled'
    tasksTotal: number
    tasksCompleted: number
    updatedAt: string
  }>
  auth: {
    isAuthenticated: boolean
    sessionExpiresAt: string | null
  }
  timestamp: string
}
```

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Race condition between polling and webhooks | Medium | Medium | Use timestamps to ignore stale updates; last-write-wins with timestamp comparison |
| Increased complexity in data flow | Medium | Low | Clear documentation; single source of truth for polling state |
| Performance regression from new endpoint | Low | Medium | Benchmark endpoint; ensure lightweight queries with proper indexes |
| Breaking existing functionality during migration | Medium | High | Incremental migration; keep old polling until new context is proven |

---

## Alternatives Considered

### Alternative 1: Keep polling in components, add shared hook

- **Description:** Create a `usePolling()` hook that encapsulates interval logic, but keep state local to components
- **Pros:** Less refactoring; components remain self-contained
- **Cons:** Doesn't solve redundant requests or stale data across components; still scattered logic
- **Decision:** Rejected. Doesn't address the core problem of centralized state management

### Alternative 2: Server-Sent Events (SSE) for real-time updates

- **Description:** Replace polling with SSE connections for push-based updates
- **Pros:** Lower latency; reduced unnecessary requests
- **Cons:** More complex infrastructure; connection management; not needed yet
- **Decision:** Deferred to future iteration. Current polling approach is sufficient; design context to be transport-agnostic for potential future migration

### Alternative 3: Use React Query / TanStack Query

- **Description:** Adopt a data fetching library that handles caching, polling, and deduplication
- **Pros:** Battle-tested; rich feature set; devtools
- **Cons:** Additional dependency; learning curve; may be overkill for current needs
- **Decision:** Rejected for now. Custom context is simpler and sufficient; can migrate to React Query later if complexity grows

---

## Non-Goals (v1)

Explicitly out of scope for this PRD:

- **WebSocket/SSE transport** - Polling is sufficient for now; design for future migration but don't implement
- **Cross-tab synchronization** - Each tab polls independently; SharedWorker optimization deferred
- **Offline support** - No caching/persistence of polled data beyond current session
- **Granular subscriptions** - All components receive all data; selective subscriptions deferred
- **Polling for other data types** - Focus on tasks, manifests, auth; other data (e.g., system notifications) deferred

---

## Interface Specifications

### API

```
GET /api/polling/status?ritualId={ritualId}

Response: {
  tasks: Array<TaskStatus>
  manifests: Array<ManifestStatus>
  auth: AuthStatus
  timestamp: string  // ISO 8601
}

Errors:
  401 - Unauthorized (session expired)
  404 - Ritual not found
  500 - Server error
```

### React Context API

```typescript
interface PollingContextValue {
  // Data
  tasks: TaskStatus[]
  manifests: ManifestStatus[]
  authStatus: AuthStatus | null
  
  // Metadata
  isPolling: boolean
  lastUpdated: Date | null
  error: Error | null
  
  // Actions
  startPolling: (ritualId: string) => void
  stopPolling: () => void
  refreshNow: () => Promise<void>
}

// Hook
function usePolling(): PollingContextValue
```

---

## Documentation Requirements

- [ ] Update component documentation to reference PollingContext
- [ ] Add inline code comments explaining polling strategy and error handling
- [ ] Document API endpoint in existing API documentation (if any)

---

## Open Questions

| Question | Owner | Due Date | Status |
|----------|-------|----------|--------|
| Should polling pause when browser tab is not visible? | TBD | Before implementation | Open |
| Should we expose polling interval as configurable (dev vs prod)? | TBD | Before implementation | Open |
| How to handle ritual switching (stop old polling, start new)? | TBD | During implementation | Open |

---

## Appendix

### Glossary

- **Polling**: Periodically fetching data from the server at fixed intervals
- **Exponential backoff**: Progressively increasing wait time between retries after failures
- **revalidatePath**: Next.js function to invalidate cached data and trigger re-render

### References

- Current polling implementation: `app/(dashboard)/rituals/[id]/board-client.tsx:538-560`
- FireIntensityContext: `lib/contexts/fire-intensity-context.tsx`
- Webhook handlers: `app/api/webhooks/manifest/[manifestId]/route.ts`
