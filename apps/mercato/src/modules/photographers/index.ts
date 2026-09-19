import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'photographers',
  title: 'Photographers',
  version: '0.1.0',
  description: 'Original photographer registration submissions.',
}

export { features } from './acl'
