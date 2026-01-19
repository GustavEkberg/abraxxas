import type { Metadata } from 'next'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Toaster } from 'sonner'
import './globals.css'
import { Inter } from 'next/font/google'
import { FireIntensityProvider } from '@/lib/contexts/fire-intensity-context'
import { FireBackground } from '@/components/fire-background'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'TruckApp',
  description: 'Next.js app with Effect-TS integration'
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable}>
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
