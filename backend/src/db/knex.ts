import Knex from 'knex';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILENAME = process.env.DB_FILENAME || 'graphite.db';
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = Knex({
  client: 'better-sqlite3',
  connection: {
    filename: path.join(DATA_DIR, DB_FILENAME),
  },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn: { pragma: (sql: string) => void }, done: (err: Error | null, conn: unknown) => void) => {
      conn.pragma('journal_mode = WAL');
      conn.pragma('busy_timeout = 5000');
      done(null, conn);
    },
  },
  migrations: {
    directory: MIGRATIONS_DIR,
    loadExtensions: ['.js', '.ts'],
  },
});

async function normalizeRecordedMigrationNames(): Promise<void> {
  const hasMigrationsTable = await db.schema.hasTable('knex_migrations');
  if (!hasMigrationsTable) {
    return;
  }

  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR);
  const migrationFileByStem = new Map(
    migrationFiles.map((fileName) => [path.parse(fileName).name, fileName]),
  );

  const recordedMigrations = await db<{ id: number; name: string }>('knex_migrations')
    .select('id', 'name');

  for (const migration of recordedMigrations) {
    const currentFileName = migrationFileByStem.get(path.parse(migration.name).name);
    if (!currentFileName || currentFileName === migration.name) {
      continue;
    }

    await db('knex_migrations')
      .where({ id: migration.id })
      .update({ name: currentFileName });
  }
}

export async function initializeDatabase(): Promise<void> {
  await normalizeRecordedMigrationNames();
  await db.migrate.latest();
}

export default db;
