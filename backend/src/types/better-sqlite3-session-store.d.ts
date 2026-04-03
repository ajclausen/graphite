declare module 'better-sqlite3-session-store' {
  import session from 'express-session';

  interface SqliteStoreOptions {
    client: unknown;
    expired?: {
      clear?: boolean;
      intervalMs?: number;
    };
  }

  function BetterSqlite3SessionStore(
    expressSession: typeof session,
  ): new (options: SqliteStoreOptions) => session.Store;

  export = BetterSqlite3SessionStore;
}
