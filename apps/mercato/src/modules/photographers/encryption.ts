import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'photographers:photographer_evaluation_material',
    fields: [{ field: 'body' }],
  },
  {
    entityId: 'photographers:photographer_raw_data',
    fields: [
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'email' },
      { field: 'portfolio_raw' },
    ],
  },
]

export default defaultEncryptionMaps
