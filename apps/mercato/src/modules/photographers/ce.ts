import type { CustomEntitySpec, CustomFieldDefinition } from '@open-mercato/shared/modules/entities'
import { E } from '@open-mercato/core/generated-shims/entities.ids.generated'

function field(key: string, kind: CustomFieldDefinition['kind'], encrypted = true): CustomFieldDefinition {
  return { key: `photographers_${key}`, kind, label: `photographers.fields.${key}`, encrypted, formEditable: false, listVisible: false, indexed: false, filterable: false }
}

export const entities: CustomEntitySpec[] = [
  {
    id: E.customers.customer_person_profile,
    fields: [
      field('category', 'text'),
      field('gallery_system', 'text'),
      field('facts_json', 'multiline'),
      field('traces_json', 'multiline'),
      field('last_evaluation_id', 'text', false),
    ],
  },
  {
    id: E.customers.customer_deal,
    fields: [
      field('score', 'integer'),
      field('flags_json', 'multiline'),
      field('score_breakdown_json', 'multiline'),
      field('rules_version', 'text', false),
      field('evaluation_id', 'text', false),
      field('draft_ref', 'text', false),
      field('contact_approved_at', 'datetime'),
    ],
  },
]

export default entities
