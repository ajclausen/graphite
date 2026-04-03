import Knex from 'knex';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || './data';
const DB_FILENAME = process.env.DB_FILENAME || 'graphite.db';

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
    directory: path.join(__dirname, 'migrations'),
  },
});

export async function initializeDatabase(): Promise<void> {
  await db.migrate.latest();
}

export default db;
