import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.text('id').primary();
    table.text('email').notNullable().unique();
    table.text('password_hash').notNullable();
    table.text('display_name').nullable();
    table.text('role').notNullable().defaultTo('user');
    table.boolean('must_change_password').notNullable().defaultTo(false);
    table.integer('failed_login_attempts').notNullable().defaultTo(0);
    table.text('locked_until').nullable();
    table.text('password_changed_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('email');
  });

  await knex.schema.createTable('password_reset_tokens', (table) => {
    table.text('id').primary();
    table.text('user_id').notNullable()
      .references('id').inTable('users')
      .onDelete('CASCADE');
    table.text('token_hash').notNullable();
    table.text('expires_at').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_reset_tokens');
  await knex.schema.dropTableIfExists('users');
}
