import type { Metadata } from 'next'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Toaster } from 'sonner'
import './globals.css'
import { IBM_Plex_Mono } from 'next/font/google'
import { FireIntensityProvider } from '@/lib/contexts/fire-intensity-context'
import { FireBackground } from '@/components/fire-background'

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700']
})

export const metadata: Metadata = {
  title: 'Abraxas - Task Execution from the Cosmic Void',
  description: 'Summon unholy coding demons to execute your development tasks'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={ibmPlexMono.variable}>
      <body className="antialiased">
        <FireIntensityProvider>
          <NuqsAdapter>{children}</NuqsAdapter>
          <Toaster />
          <FireBackground />
        </FireIntensityProvider>
      </body>
    </html>
  )
}
