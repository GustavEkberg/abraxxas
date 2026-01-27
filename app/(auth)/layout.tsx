import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'ἈΒΡΑΞΑΣ',
  description: 'Summon the powers that came before us to create what will come after'
}

export default async function Layout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="min-h-dvh flex items-center justify-center md:max-w-lg md:mx-auto">
      <div className="flex flex-col justify-center items-center gap-8 w-full mx-8">{children}</div>
    </div>
  )
}
