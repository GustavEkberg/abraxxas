# Services Architecture

This document defines the patterns for creating services in this codebase. All services must follow these conventions for consistency.

## File Structure

```
lib/services/
├── [service-name]/
│   ├── live-layer.ts    # Service definition and layer
│   ├── errors.ts        # Service-specific errors (optional)
│   └── [helpers].ts     # Additional utilities (optional)
```

- **No barrel files** - Import directly from `live-layer.ts`
- **One service per directory** - Keep services focused and single-purpose

## Service Definition Pattern

Use `Effect.Service` with static `layer` and `Live` properties for v4-compatible layer composition:

```typescript
import { Effect, Layer, Config, Context } from 'effect'
import { ServiceNameError } from './errors'

// Internal configuration (if needed)
class ServiceConfig extends Context.Tag('@app/ServiceConfig')<
  ServiceConfig,
  {
    readonly apiKey: string
  }
>() {}

const ServiceConfigLive = Layer.effect(
  ServiceConfig,
  Effect.gen(function* () {
    const apiKey = yield* Config.string('SERVICE_API_KEY').pipe(
      Effect.mapError(() => new ServiceConfigError({ message: 'SERVICE_API_KEY not found' }))
    )
    return { apiKey }
  })
)

// Service definition
// v4 migration: Change Effect.Service to ServiceMap.Service
export class ServiceName extends Effect.Service<ServiceName>()('@app/ServiceName', {
  effect: Effect.gen(function* () {
    const config = yield* ServiceConfig

    const methodOne = (arg: string) =>
      Effect.gen(function* () {
        // Implementation
        return result
      }).pipe(Effect.withSpan('ServiceName.methodOne'))

    const methodTwo = () =>
      Effect.gen(function* () {
        // Implementation
      }).pipe(Effect.withSpan('ServiceName.methodTwo'))

    return { methodOne, methodTwo } as const
  })
}) {
  // Base layer (may have unsatisfied dependencies)
  static layer = this.Default

  // Composed layer with all dependencies satisfied
  static Live = this.layer.pipe(Layer.provide(ServiceConfigLive))
}

// Re-export for convenience
export const ServiceLive = ServiceName.Live
```

### Why Static `layer` and `Live` Properties?

This pattern is **v4-compatible**. In Effect v4, `ServiceMap.Service` does NOT have a `dependencies` option. Dependencies must be composed externally via `Layer.provide`.

| Property       | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `static layer` | Base layer with potentially unsatisfied dependencies |
| `static Live`  | Fully composed layer with all dependencies satisfied |

This makes the migration to v4 straightforward:

```typescript
// v3 (current)
export class Service extends Effect.Service<Service>()("@app/Service", {
  effect: Effect.gen(function* () { ... }),
}) {
  static layer = this.Default
  static Live = this.layer.pipe(Layer.provide(ConfigLive))
}

// v4 (future) - minimal changes needed
export class Service extends ServiceMap.Service<Service, {
  readonly method: () => Effect.Effect<void>
}>("@app/Service") {
  static layer = Layer.effect(this)(Effect.gen(function* () { ... }))
  static Live = this.layer.pipe(Layer.provide(ConfigLive))
}
```

## Naming Conventions

| Element               | Convention               | Example                   |
| --------------------- | ------------------------ | ------------------------- |
| Service class         | PascalCase, noun         | `Auth`, `Email`, `Db`     |
| Service tag           | `@app/ServiceName`       | `@app/Auth`               |
| Static layer          | `layer`                  | `Auth.layer`              |
| Static composed layer | `Live`                   | `Auth.Live`               |
| Layer re-export       | `ServiceLive`            | `AuthLive`, `EmailLive`   |
| Methods               | camelCase, verb-first    | `sendEmail`, `getSession` |
| Spans                 | `ServiceName.methodName` | `Auth.signIn`             |

## Error Definition Pattern

Define errors in a separate `errors.ts` file using `Schema.TaggedError`:

```typescript
import * as Schema from 'effect/Schema'

// Schema.TaggedError provides automatic type guards via Schema.is()
export class ServiceApiError extends Schema.TaggedError<ServiceApiError>()('ServiceApiError', {
  error: Schema.Unknown
}) {
  get message(): string {
    return `API error: ${String(this.error)}`
  }
}

export class ServiceConfigError extends Schema.TaggedError<ServiceConfigError>()(
  'ServiceConfigError',
  { message: Schema.String }
) {}

// Type guards are automatically derived
export const isServiceApiError = Schema.is(ServiceApiError)
export const isServiceConfigError = Schema.is(ServiceConfigError)
```

**Why Schema.TaggedError over Data.TaggedError:**

- `Schema.is()` creates type guards automatically
- Better integration with Schema validation
- Enables serialization/deserialization of errors
- See `specs/EFFECT_BEST_PRACTICES.md` for detailed patterns

**Error naming:**

- Prefix with service name: `AuthApiError`, `EmailConfigError`
- Common suffixes: `ApiError`, `ConfigError`, `ValidationError`

**Domain errors** belong in each `lib/core/[domain]/errors.ts` file, colocated with domain logic.

## Configuration Pattern

Always use Effect's `Config` module - never use `process.env` directly with throws:

```typescript
// Correct
const url = yield * Config.string('DATABASE_URL')
const apiKey = yield * Config.redacted('API_KEY') // For secrets

// Wrong - never do this
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL not found')
```

For optional environment variables:

```typescript
const optional =
  yield *
  Config.string('OPTIONAL_VAR').pipe(
    Effect.option,
    Effect.map(opt => (opt._tag === 'Some' ? opt.value : undefined))
  )
```

## Observability Pattern

All service methods must include tracing:

```typescript
const methodName = (arg: string) =>
  Effect.gen(function* () {
    // Add attributes to the span
    yield* Effect.annotateCurrentSpan({
      'service.arg': arg
    })

    const result = yield* doSomething()

    // Add result attributes
    yield* Effect.annotateCurrentSpan({
      'service.resultId': result.id
    })

    return result
  }).pipe(
    Effect.withSpan('ServiceName.methodName'),
    Effect.tapError(error => Effect.logError('Operation failed', { arg, error }))
  )
```

## Layer Composition

Services are composed in `lib/layers.ts`:

```typescript
import { Layer } from 'effect'
import { Auth, AuthLive } from './services/auth/live-layer'
import { Db, DbLive } from './services/db/live-layer'
import { Email } from './services/email/live-layer'

// Combined app layer - use .Live which has all dependencies satisfied
export const AppLayer = Layer.mergeAll(AuthLive, DbLive, TelegramLive, ActivityLive, TelemetryLayer)

// Re-export services for convenient imports
export { Auth, Db, Email, Telegram, Activity }
```

### Layer Composition Functions

| Function             | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `Layer.provide`      | Satisfies dependencies, removes them from requirements |
| `Layer.provideMerge` | Satisfies dependencies AND keeps them in output        |
| `Layer.merge`        | Combines two independent layers                        |
| `Layer.mergeAll`     | Combines multiple independent layers                   |

## Using Services

```typescript
import { Effect } from 'effect'
import { Auth, AuthLive } from '@/lib/services/auth/live-layer'

const program = Effect.gen(function* () {
  const auth = yield* Auth
  const session = yield* auth.getSessionFromCookies()
  return session
})

// Run with layer
Effect.runPromise(program.pipe(Effect.provide(AuthLive)))
```

## Effect v4 Migration Guide

When upgrading to Effect v4, services will migrate from `Effect.Service` to `ServiceMap.Service`:

```typescript
// v3 (current)
export class Auth extends Effect.Service<Auth>()('@app/Auth', {
  effect: Effect.gen(function* () {
    const config = yield* AuthConfig
    // ...
    return { signIn, signOut } as const
  })
}) {
  static layer = this.Default
  static Live = this.layer.pipe(Layer.provide(AuthConfigLive))
}

// v4 (future)
export class Auth extends ServiceMap.Service<
  Auth,
  {
    readonly signIn: (email: string, password: string) => Effect.Effect<Session, AuthError>
    readonly signOut: () => Effect.Effect<void>
  }
>('@app/Auth') {
  static layer = Layer.effect(this)(
    Effect.gen(function* () {
      const config = yield* AuthConfig
      // ...
      return { signIn, signOut }
    })
  )
  static Live = this.layer.pipe(Layer.provide(AuthConfigLive))
}
```

**Key v4 changes:**

- `Effect.Service` → `ServiceMap.Service`
- Service interface is declared in the type parameter, not inferred
- `this.Default` → `Layer.effect(this)(effect)`
- No `dependencies` option - always use `Layer.provide`

## Checklist for New Services

- [ ] Create directory: `lib/services/[name]/`
- [ ] Create `live-layer.ts` with `Effect.Service` pattern
- [ ] Add static `layer` property (base layer)
- [ ] Add static `Live` property (composed with dependencies)
- [ ] Create `errors.ts` with `Data.TaggedError` errors (if needed)
- [ ] Use `Config.*` for all environment variables
- [ ] Add `Effect.withSpan()` to all methods
- [ ] Add `Effect.annotateCurrentSpan()` for relevant attributes
- [ ] Add `Effect.tapError()` for error logging
- [ ] Export `ServiceLive` for convenience
- [ ] Add to `lib/layers.ts` AppLayer
- [ ] Return `as const` from service effect for type inference
