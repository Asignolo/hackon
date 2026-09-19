import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'backend:layout:top': { widgetId: 'photographers.injection.proposal-materials', priority: 50 },
}

export default injectionTable
