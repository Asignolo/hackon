import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { apifyHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  container.register({ apifyHealthCheck: asValue(apifyHealthCheck) })
}
