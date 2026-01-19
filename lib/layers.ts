import { Layer } from 'effect'
import { Db } from './services/db/live-layer'
import { Auth } from './services/auth/live-layer'
import { S3 } from './services/s3/live-layer'
import { Telegram } from './services/telegram/live-layer'
import { Activity } from './services/activity/live-layer'
import { TelemetryLayer } from './services/telemetry/live-layer'

// Combined app layer
export const AppLayer = Layer.mergeAll(
  Auth.Live,
  Db.Live,
  S3.Live,
  Telegram.Live,
  Activity.Live,
  TelemetryLayer
)
