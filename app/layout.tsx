import type { Metadata } from 'next';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Toaster } from 'sonner';
import './globals.css';
import { IBM_Plex_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import { FireIntensityProvider } from '@/lib/contexts/fire-intensity-context';
import { FireBackground } from '@/components/fire-background';
import { AlertProvider } from '@/components/ui/gnostic-alert';
import { AnimatedTitle } from '@/components/animated-title';

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700']
});

const ashborn = localFont({
  src: '../public/Ashborn.otf',
  variable: '--font-ashborn'
});

export const metadata: Metadata = {
  title: 'ἀβραξάς',
  description: 'Summon the powers that came before us'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${ibmPlexMono.variable} ${ashborn.variable}`}>
      <body className="antialiased">
        <FireIntensityProvider>
          <AlertProvider>
            <NuqsAdapter>{children}</NuqsAdapter>
            <Toaster />
            <FireBackground />
            <AnimatedTitle />
          </AlertProvider>
        </FireIntensityProvider>
      </body>
    </html>
  );
}
