import type { EntityExtension } from '@open-mercato/shared/modules/entities'

export const extensions: EntityExtension[] = [{
  base: 'customers:customer_entity',
  extension: 'photographers:photographer_raw_data',
  join: { baseKey: 'id', extensionKey: 'customer_entity_id' },
  table: 'photographers_raw_data',
  cardinality: 'one-to-many',
}]
export default extensions
