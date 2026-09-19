import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { PhotographerRawData } from '../../data/entities'
import { rawDataCreateSchema, rawDataListSchema } from '../../data/validators'
import { requirePhotographerScope } from '../../lib/scope'

const entityId = 'photographers:photographer_raw_data'
const itemSchema = rawDataCreateSchema.extend({
  id: z.string().uuid(),
  submittedAt: z.string(),
  customerEntityId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['photographers.view'] },
    POST: { requireAuth: true, requireFeatures: ['photographers.create'] },
  },
  orm: { entity: PhotographerRawData, orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: entityId },
  list: {
    schema: rawDataListSchema,
    entityId,
    fields: ['id', 'first_name', 'last_name', 'email', 'portfolio_raw', 'submitted_at', 'customer_entity_id', 'created_at', 'updated_at'],
    defaultSort: { field: 'submitted_at', dir: 'desc' },
    tiebreakSortField: 'id',
    buildFilters: async (query, ctx) => {
      const scope = await requirePhotographerScope(ctx)
      return {
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        ...(query.id ? { id: query.id } : {}),
        ...(query.customerEntityId ? { customer_entity_id: query.customerEntityId } : {}),
      }
    },
    transformItem: (item: Record<string, unknown>) => ({
      id: item.id,
      firstName: item.first_name,
      lastName: item.last_name,
      email: item.email,
      portfolioRaw: item.portfolio_raw,
      submittedAt: item.submitted_at,
      customerEntityId: item.customer_entity_id ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  actions: {
    create: {
      commandId: 'photographers.raw_data.create',
      schema: rawDataCreateSchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: result.id }),
      status: 201,
    },
  },
})

export const openApi = createCrudOpenApiFactory({ defaultTag: 'Photographers' })({
  resourceName: 'Photographer submission',
  querySchema: rawDataListSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: rawDataCreateSchema },
})
