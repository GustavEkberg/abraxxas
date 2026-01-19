# PRD: Effect Vitest Test Examples

**Date:** 2026-01-18

---

## Problem Statement

### What problem are we solving?

The starter repo has comprehensive Effect testing documentation (`specs/EFFECT_TESTING.md`) but no actual test examples. When developers use this repo to build real features, they have no working reference to follow. The spec describes patterns abstractly; developers need concrete, runnable examples demonstrating each pattern in the context of this codebase's architecture.

### Why now?

- `@effect/vitest` is not installed despite vitest being configured
- No unit tests exist (only e2e)
- The testing spec is complete but untested
- Developers cloning this repo will need test patterns immediately

### Who is affected?

- **Primary users:** Developers using this starter repo for new projects
- **Secondary users:** Future contributors learning the codebase patterns

---

## Proposed Solution

### Overview

Add `@effect/vitest` dependency and create example tests in `lib/core/post/`. All patterns from `specs/EFFECT_TESTING.md` will be demonstrated through the posts domain - a realistic context showing how to test actual business logic with mocked services.

---

## End State

When this PRD is complete, the following will be true:

- [ ] `@effect/vitest` is installed as a dev dependency
- [ ] Vitest config updated for Effect testing
- [ ] Example tests exist demonstrating all documented patterns
- [ ] Tests are colocated with source files (`*.test.ts`)
- [ ] All example tests pass (`pnpm test:run`)
- [ ] Tests serve as reference documentation for each pattern
- [ ] `specs/TESTING_STRATEGY.md` documents coverage targets and testing philosophy
- [ ] `AGENTS.md` updated with testing section and references

---

## Success Metrics

### Quantitative

| Metric           | Current | Target | Measurement Method                             |
| ---------------- | ------- | ------ | ---------------------------------------------- |
| Test files       | 0       | 1-2    | Count of `*.test.ts` files in `lib/core/post/` |
| Pattern coverage | 0%      | 100%   | Patterns from spec demonstrated                |
| Strategy spec    | 0       | 1      | `specs/TESTING_STRATEGY.md` exists             |

### Qualitative

- Developer can find a working example for any pattern in the spec
- Tests are self-documenting with clear comments explaining patterns
- AGENTS.md accurately reflects testing infrastructure
- Testing strategy is clear: what to test, coverage expectations, mock patterns

---

## Acceptance Criteria

### Setup

- [ ] `@effect/vitest` added to devDependencies
- [ ] Vitest config compatible with `@effect/vitest` imports

### Pattern: Basic `it.effect`

- [ ] Test demonstrating basic Effect test with `it.effect`
- [ ] Test demonstrating `it.live` for real time/IO
- [ ] Test demonstrating `it.scoped` for resource cleanup
- [ ] Test demonstrating `it.scopedLive`

### Pattern: TestClock

- [ ] Test demonstrating forking + TestClock.adjust
- [ ] Test demonstrating timeout testing
- [ ] Test demonstrating retry with exponential backoff
- [ ] Comment explaining why fork is required (blocks without it)

### Pattern: Layer Sharing

- [ ] Test demonstrating `layer()` for shared mock services
- [ ] Test demonstrating nested `it.layer()`
- [ ] Example sharing mock Auth + Db across post tests

### Pattern: Mock Services

- [ ] Mock Auth service returning test session/user
- [ ] Mock Db service with in-memory post storage
- [ ] Example capturing Db calls for assertions
- [ ] Clear factory pattern for creating test implementations

### Pattern: Property Testing

- [ ] Test demonstrating `it.prop` with post input Schema
- [ ] Test demonstrating `it.effect.prop` for async validation
- [ ] Test demonstrating `Arbitrary.make()` from post Schema
- [ ] Example testing filter/sort invariants (e.g., sorted results stay sorted)

### Pattern: Error Testing

- [ ] Test demonstrating `Effect.either` for UnauthenticatedError
- [ ] Test demonstrating `Effect.exit` with Cause inspection
- [ ] Test demonstrating `Effect.catchTag` for NotFoundError recovery
- [ ] Examples using domain errors (UnauthenticatedError, NotFoundError)

### Pattern: Database Testing (Reference Only)

- [ ] Comment in test file pointing to `specs/EFFECT_TESTING.md` testcontainers section
- [ ] Note that integration tests require additional setup

### Documentation: specs/TESTING_STRATEGY.md

- [ ] Testing philosophy (what to test, what not to test)
- [ ] Coverage targets and expectations
- [ ] Test organization (colocated `*.test.ts` files)
- [ ] When to use unit vs integration vs e2e tests
- [ ] Mock strategy for Effect services
- [ ] Reference to `specs/EFFECT_TESTING.md` for implementation patterns

### Documentation: AGENTS.md Updates

- [ ] Remove "No tests yet" note from NOTES section
- [ ] Add testing info to WHERE TO LOOK table
- [ ] Add `specs/TESTING_STRATEGY.md` to SPECS table
- [ ] Add test commands to relevant section

---

## Technical Context

### Existing Patterns

- `specs/EFFECT_TESTING.md` - Complete testing documentation to implement
- `lib/core/post/` - Domain logic to test (get-posts, create, delete)
- `lib/core/errors/index.ts` - Error types for error testing examples
- `lib/services/*/live-layer.ts` - Services to mock in tests

### Key Files

- `vitest.config.ts` - Needs `@effect/vitest` compatibility
- `package.json` - Needs `@effect/vitest` dependency
- `lib/core/post/get-posts.ts` - Query logic with filters/sorting
- `lib/core/post/create-post-action.ts` - Server action for creation
- `lib/core/post/delete-post-action.ts` - Server action for deletion
- `AGENTS.md` - Needs testing section updates (line 205: "No tests yet")
- `specs/EFFECT_TESTING.md` - Existing patterns spec (implementation reference)
- `specs/TESTING_STRATEGY.md` - New file for coverage/philosophy (to create)

### Package Requirements

- `@effect/vitest` - Effect-aware test runner integration

### Test File Location

```
lib/core/post/
├── get-posts.ts
├── create-post-action.ts
├── delete-post-action.ts
└── post.test.ts          # All test patterns demonstrated here
```

---

## Risks & Mitigations

| Risk                       | Likelihood | Impact | Mitigation                                 |
| -------------------------- | ---------- | ------ | ------------------------------------------ |
| Mocks diverge from reality | Med        | Low    | Keep mocks minimal, test behavior not impl |
| Examples become outdated   | Med        | Med    | Keep examples minimal, reference spec      |
| Posts domain changes       | Low        | Low    | Tests verify patterns, not specific logic  |

---

## Alternatives Considered

### Alternative 1: Separate `test/` directory

- **Pros:** Clear separation of test code
- **Cons:** Harder to find tests for specific files
- **Decision:** Rejected. Colocated tests match user preference and aid discoverability.

### Alternative 2: Minimal examples only

- **Pros:** Less code to maintain
- **Cons:** Developers still need to figure out advanced patterns
- **Decision:** Rejected. Comprehensive examples maximize reference value.

### Alternative 3: Spread examples across services and schemas

- **Pros:** Tests colocated with each module type
- **Cons:** Fragmented examples, harder to see full picture
- **Decision:** Rejected. Consolidating in posts domain shows realistic end-to-end testing context.

---

## Non-Goals (v1)

Explicitly out of scope for this PRD:

- Real business logic tests - these are pattern examples only
- 100% code coverage - focus is on demonstrating patterns
- E2E test integration - already exists separately in `e2e/`
- CI integration - deployment handles this via Vercel

---

## Documentation Requirements

- [ ] Comments in test files explaining each pattern
- [ ] Reference to `specs/EFFECT_TESTING.md` in test files
- [ ] `specs/TESTING_STRATEGY.md` created with coverage/philosophy guidelines
- [ ] `AGENTS.md` updated to reflect testing infrastructure

---

## Open Questions

None - scope is well-defined.

---

## Appendix

### Test Patterns Summary

All patterns demonstrated in `lib/core/post/post.test.ts`:

| Pattern               | Spec Section               | Posts Context                                 |
| --------------------- | -------------------------- | --------------------------------------------- |
| it.effect/live/scoped | Test Variants              | Basic getPosts tests, resource cleanup        |
| TestClock             | TestClock Patterns         | Retry/timeout scenarios                       |
| layer()               | Sharing Layers             | Shared mock Auth + Db layer across tests      |
| Mock services         | Testing with Mock Services | Mock Auth (session), mock Db (queries)        |
| Property testing      | Property-Based Testing     | Post schema validation, filter invariants     |
| Error testing         | Testing Error Cases        | UnauthenticatedError, NotFoundError scenarios |
