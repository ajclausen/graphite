import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('documents', (table) => {
    table.text('file_type').notNullable().defaultTo('pdf');
    table.text('mime_type').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('documents', (table) => {
    table.dropColumn('file_type');
    table.dropColumn('mime_type');
  });
}
