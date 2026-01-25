import { Effect } from 'effect'
import { notFound } from 'next/navigation'
import { eq, and } from 'drizzle-orm'
import { NextEffect } from '@/lib/next-effect'
import { AppLayer } from '@/lib/layers'
import { Db } from '@/lib/services/db/live-layer'
import { getSession } from '@/lib/services/auth/get-session'
import * as schema from '@/lib/services/db/schema'
import { ManifestPageClient } from './manifest-client'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function ManifestPage({ params }: PageProps) {
  // The ID is now the branch name (URL encoded)
  const { id } = await params
  const branchName = decodeURIComponent(id)

  const result = await NextEffect.runPromise(
    Effect.gen(function* () {
      yield* getSession()
      const db = yield* Db

      // Fetch the sprite by branch name
      const sprites = yield* db
        .select()
        .from(schema.sprites)
        .where(and(eq(schema.sprites.branchName, branchName), eq(schema.sprites.type, 'manifest')))
        .limit(1)

      if (sprites.length === 0) {
        return { _tag: 'NotFound' as const }
      }

      const sprite = sprites[0]

      // Fetch the project for context
      const projects = yield* db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, sprite.projectId))
        .limit(1)

      const project = projects[0]

      return {
        _tag: 'Success' as const,
        data: { sprite, project }
      }
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.catchAll(error => {
        if ('_tag' in error && error._tag === 'UnauthenticatedError') {
          return NextEffect.redirect('/login')
        }
        return Effect.succeed({ _tag: 'Error' as const, message: String(error) })
      })
    )
  )

  if (result._tag === 'NotFound') {
    notFound()
  }

  if (result._tag === 'Error') {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-red-400">Error: {result.message}</p>
      </div>
    )
  }

  const { sprite, project } = result.data

  return <ManifestPageClient sprite={sprite} project={project} />
}
