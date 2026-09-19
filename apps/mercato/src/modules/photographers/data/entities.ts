import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

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

@Entity({ tableName: 'photographers_evaluation_materials' })
@Unique({ name: 'photographers_materials_scope_operation_unique', properties: ['tenantId', 'organizationId', 'operationId'] })
@Index({ name: 'photographers_materials_scope_evaluation_idx', properties: ['tenantId', 'organizationId', 'evaluationId'] })
export class PhotographerEvaluationMaterial {
  [OptionalProps]?: 'registrationId' | 'dealId' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'operation_id', type: 'uuid' })
  operationId!: string

  @Property({ name: 'evaluation_id', type: 'uuid' })
  evaluationId!: string

  @Property({ name: 'photographer_id', type: 'uuid' })
  photographerId!: string

  @Property({ name: 'person_id', type: 'uuid' })
  personId!: string

  @Property({ name: 'registration_id', type: 'uuid', nullable: true })
  registrationId?: string | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ type: 'text' })
  kind!: string

  @Property({ name: 'schema_version', type: 'integer' })
  schemaVersion!: number

  @Property({ name: 'byte_length', type: 'integer' })
  byteLength!: number

  @Property({ type: 'text' })
  checksum!: string

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
