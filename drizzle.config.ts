import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { existsSync } from 'fs'

// Load .env.local if it exists, otherwise .env
const envPath = existsSync('.env.local') ? '.env.local' : '.env'
config({ path: envPath })

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL env variable not found')

export default defineConfig({
  schema: './lib/services/db/schema.ts',
  out: './lib/services/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: DATABASE_URL
  }
})
