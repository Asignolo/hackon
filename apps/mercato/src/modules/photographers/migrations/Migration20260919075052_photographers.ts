import { Migration } from '@mikro-orm/migrations';
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex';

export const queryIndexReindexEntityTypes = declareQueryIndexReindex(['photographers:photographer_raw_data']);

export class Migration20260919075052_photographers extends Migration {

  override name = 'Migration20260919075052';

  override up(): void | Promise<void> {
    this.addSql(`alter table "photographers_raw_data" rename column "portfolio_url" to "portfolio_raw";`);
    this.addSql(`update "encryption_maps" set "fields_json" = (
      select jsonb_agg(case when field->>'field' = 'portfolio_url'
        then jsonb_set(field, '{field}', '"portfolio_raw"'::jsonb) else field end order by position)
      from jsonb_array_elements("fields_json") with ordinality as rules(field, position)
    ), "updated_at" = now()
    where "entity_id" = 'photographers:photographer_raw_data'
      and jsonb_typeof("fields_json") = 'array'
      and "fields_json" @> '[{"field":"portfolio_url"}]'::jsonb;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "photographers_raw_data" rename column "portfolio_raw" to "portfolio_url";`);
    this.addSql(`update "encryption_maps" set "fields_json" = (
      select jsonb_agg(case when field->>'field' = 'portfolio_raw'
        then jsonb_set(field, '{field}', '"portfolio_url"'::jsonb) else field end order by position)
      from jsonb_array_elements("fields_json") with ordinality as rules(field, position)
    ), "updated_at" = now()
    where "entity_id" = 'photographers:photographer_raw_data'
      and jsonb_typeof("fields_json") = 'array'
      and "fields_json" @> '[{"field":"portfolio_raw"}]'::jsonb;`);
  }

}
