import Link from 'next/link'
import { Effect } from 'effect'
import { AppLayer } from '@/lib/layers'
import { getSession } from '@/lib/services/auth/get-session'
import { UserMenu } from '@/components/user-menu'

async function AuthenticatedMenu() {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* getSession()
      return true
    }).pipe(
      Effect.provide(AppLayer),
      Effect.scoped,
      Effect.catchAll(() => Effect.succeed(false))
    )
  )

  if (!result) return null

  return <UserMenu />
}

export function Header() {
  return (
    <header className="border-b border-dashed border-white/10 bg-zinc-950/80 backdrop-blur-sm">
      <div className="mx-auto flex h-15 w-full items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="font-[family-name:var(--font-ashborn)] text-5xl text-white/90 hover:text-white"
        >
          Abraxa<span className="inline-block scale-x-[-1]">S</span>
        </Link>
        <AuthenticatedMenu />
      </div>
    </header>
  )
}
