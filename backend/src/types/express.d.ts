/* eslint-disable @typescript-eslint/no-empty-interface */

import 'express-session';
import 'express-serve-static-core';
import type { UserRow } from '../auth/types';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    createdAt: number;
    passwordChangedAt: string | null;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
  }
}
