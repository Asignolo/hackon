import { Migration } from '@mikro-orm/migrations';

export class Migration20260919114825_photographers extends Migration {

  override name = 'Migration20260919114825';

  override up(): void | Promise<void> {
    this.addSql(`create table "photographers_evaluation_materials" ("id" uuid not null, "tenant_id" uuid not null, "organization_id" uuid not null, "operation_id" uuid not null, "evaluation_id" uuid not null, "photographer_id" uuid not null, "person_id" uuid not null, "registration_id" uuid null, "deal_id" uuid null, "kind" text not null, "schema_version" int not null, "byte_length" int not null, "checksum" text not null, "body" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "photographers_materials_scope_evaluation_idx" on "photographers_evaluation_materials" ("tenant_id", "organization_id", "evaluation_id");`);
    this.addSql(`alter table "photographers_evaluation_materials" add constraint "photographers_materials_scope_operation_unique" unique ("tenant_id", "organization_id", "operation_id");`);
  }

}
