import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'photographers_raw_data' })
@Index({ name: 'photographers_raw_data_scope_submitted_idx', properties: ['tenantId', 'organizationId', 'submittedAt'] })
@Index({ name: 'photographers_raw_data_scope_customer_idx', properties: ['tenantId', 'organizationId', 'customerEntityId'] })
export class PhotographerRawData {
  [OptionalProps]?: 'submittedAt' | 'customerEntityId' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'first_name', type: 'text' })
  firstName!: string

  @Property({ name: 'last_name', type: 'text' })
  lastName!: string

  @Property({ type: 'text' })
  email!: string

  @Property({ name: 'portfolio_raw', type: 'text' })
  portfolioRaw!: string

  @Property({ name: 'submitted_at', type: Date, onCreate: () => new Date() })
  submittedAt: Date = new Date()

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  customerEntityId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
