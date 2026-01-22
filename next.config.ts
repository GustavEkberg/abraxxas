import type { NextConfig } from 'next'
// import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  reactCompiler: true

  // PostHog reverse proxy disabled
  // async rewrites() {
  //   return [
  //     {
  //       source: '/ph/static/:path*',
  //       destination: 'https://eu-assets.i.posthog.com/static/:path*'
  //     },
  //     {
  //       source: '/ph/:path*',
  //       destination: 'https://eu.i.posthog.com/:path*'
  //     }
  //   ]
  // }
}

export default nextConfig
// export default withSentryConfig(nextConfig)
