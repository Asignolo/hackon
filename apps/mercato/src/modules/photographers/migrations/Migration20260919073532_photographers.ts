import { Migration } from '@mikro-orm/migrations';

export class Migration20260919073532_photographers extends Migration {

  override name = 'Migration20260919073532';

  override up(): void | Promise<void> {
    this.addSql(`create table "photographers_raw_data" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "first_name" text not null, "last_name" text not null, "email" text not null, "portfolio_url" text not null, "submitted_at" timestamptz not null, "customer_entity_id" uuid null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "photographers_raw_data_scope_customer_idx" on "photographers_raw_data" ("tenant_id", "organization_id", "customer_entity_id");`);
    this.addSql(`create index "photographers_raw_data_scope_submitted_idx" on "photographers_raw_data" ("tenant_id", "organization_id", "submitted_at");`);
  }

}
