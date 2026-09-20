import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'customers.person.detail:details': { widgetId: 'photographers.injection.person-assessment', priority: 50 },
  'detail:customers.person:header': { widgetId: 'photographers.injection.person-assessment', priority: 50 },
  'backend:layout:top': { widgetId: 'photographers.injection.proposal-materials', priority: 50 },
}

export default injectionTable
