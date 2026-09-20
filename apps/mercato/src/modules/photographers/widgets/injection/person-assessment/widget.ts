import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PersonAssessmentWidget from './widget.client'

const widget: InjectionWidgetModule = {
  metadata: {
    id: 'photographers.injection.person-assessment',
    title: 'photographers.assessment.title',
    requiredModules: ['customers', 'workflows'],
    features: ['photographers.view', 'photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'customers.pipelines.view', 'customers.interactions.view', 'workflows.instances.view'],
  },
  Widget: PersonAssessmentWidget,
}

export default widget
