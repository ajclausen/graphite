/** User row from the database */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  role: 'admin' | 'user';
  must_change_password: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Safe user info returned to clients (no password hash) */
export interface UserInfo {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
  createdAt: string;
}

export function toUserInfo(row: UserRow): UserInfo {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
    createdAt: row.created_at,
  };
}
