import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('documents', (table) => {
    table.text('id').primary();
    table.text('filename').notNullable();
    table.text('original_name').notNullable();
    table.text('file_path').notNullable();
    table.integer('file_size').notNullable();
    table.integer('page_count').nullable();
    table.text('thumbnail_path').nullable();
    table.text('user_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('documents');
}
