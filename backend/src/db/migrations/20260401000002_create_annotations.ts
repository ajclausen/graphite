import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('annotations', (table) => {
    table.increments('id').primary();
    table.text('document_id').notNullable()
      .references('id').inTable('documents')
      .onDelete('CASCADE');
    table.integer('page_number').notNullable();
    table.text('elements_json').notNullable();
    table.text('page_metrics_json').nullable();
    table.text('user_id').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.unique(['document_id', 'page_number']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('annotations');
}
