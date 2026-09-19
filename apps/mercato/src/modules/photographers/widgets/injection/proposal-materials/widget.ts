import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ProposalMaterialsWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'photographers.injection.proposal-materials',
    title: 'photographers.materials.title',
    requiredModules: ['customers', 'agent_orchestrator'],
    features: ['photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'customers.interactions.view', 'agent_orchestrator.proposals.view'],
  },
  Widget: ProposalMaterialsWidget,
}

export default widget
