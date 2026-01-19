import { Suspense } from 'react'
import { Effect, Match } from 'effect'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { NextEffect } from '@/lib/next-effect'
import { AppLayer } from '@/lib/layers'
import { getSession } from '@/lib/services/auth/get-session'
import { getProjects } from '@/lib/core/project/get-projects'
import { CreateRitualDialog } from '@/components/rituals/create-ritual-dialog'
import { Card } from '@/components/ui/card'

export const dynamic = 'force-dynamic'

async function Content() {
  await cookies()

  return await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* getSession()
      const projects = yield* getProjects()

      return (
        <div className="min-h-screen p-8">
          <div className="mx-auto max-w-7xl">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-white/90">The Ritual Chamber</h1>
                <p className="mt-2 text-white/60">Your bound repositories await the summons</p>
              </div>
              <div className="flex items-center gap-4">
                <CreateRitualDialog />
                <form action="/api/auth/sign-out" method="POST">
                  <button
                    type="submit"
                    className="border border-dashed border-white/20 px-4 py-2 text-sm text-white/60 transition-all duration-200 hover:border-white/30 hover:text-white/90 font-mono"
                  >
                    Dispel Session
                  </button>
                </form>
              </div>
            </div>

            {/* Rituals Grid */}
            {projects.length === 0 ? (
              <div className="border border-dashed border-white/20 bg-zinc-950 p-12 text-center font-mono">
                <p className="mb-4 text-lg text-white/60">The void is empty</p>
                <p className="mb-8 text-sm text-white/40">No rituals have been summoned yet</p>
                <CreateRitualDialog
                  trigger={
                    <button className="border border-dashed border-red-500 bg-red-600 px-6 py-3 font-medium text-white transition-all duration-200 hover:bg-red-700 active:scale-95 font-mono">
                      Summon Your First Ritual
                    </button>
                  }
                />
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {projects.map(project => (
                  <Link key={project.id} href={`/rituals/${project.id}`}>
                    <Card className="group cursor-pointer border-dashed border-white/20 bg-zinc-950 p-6 transition-all duration-200 hover:border-red-500/30 hover:bg-zinc-900 font-mono">
                      <h3 className="mb-2 text-xl font-semibold text-white/90 transition-colors group-hover:text-red-400">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="mb-4 line-clamp-2 text-sm text-white/60">
                          {project.description}
                        </p>
                      )}
                      <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
                        <div className="text-xs text-white/40">
                          {project.repositoryUrl.replace('https://github.com/', '')}
                        </div>
                        <div className="text-xs text-white/40">
                          {new Date(project.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.matchEffect({
        onFailure: error =>
          Match.value(error._tag).pipe(
            Match.when('UnauthenticatedError', () => NextEffect.redirect('/login')),
            Match.orElse(() =>
              Effect.succeed(
                <div className="min-h-screen p-8">
                  <div className="mx-auto max-w-7xl">
                    <p className="text-white/60">Something went wrong.</p>
                    <p className="text-red-500">
                      Error:{' '}
                      {'message' in error && typeof error.message === 'string'
                        ? error.message
                        : 'Unknown error'}
                    </p>
                  </div>
                </div>
              )
            )
          ),
        onSuccess: Effect.succeed
      })
    )
  )
}

export default async function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-white/40 font-mono">Consulting the spirits...</div>
        </div>
      }
    >
      <Content />
    </Suspense>
  )
}
