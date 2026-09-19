import { createModuleEvents } from '@open-mercato/shared/modules/events'

export const eventsConfig = createModuleEvents({
  moduleId: 'photographers',
  events: [{ id: 'photographers.raw_data.created', label: 'Photographer submission received', entity: 'raw_data', category: 'crud' }] as const,
})
export default eventsConfig
