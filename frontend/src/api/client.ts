// ─── Types ───────────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  filename: string;
  original_name: string;
  file_size: number;
  page_count: number | null;
  thumbnail_path: string | null;
  file_type: 'pdf' | 'image';
  mime_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnotationRecord {
  id: number;
  document_id: string;
  page_number: number;
  elements: unknown[];
  pageMetrics: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface UserInfo {
  id: string;
  email: string;
  displayName: string | null;
  role: 'admin' | 'user';
  mustChangePassword: boolean;
  createdAt: string;
}


// ─── Auth-aware fetch wrapper ────────────────────────────────────────────────

/** Listeners that are notified when a 401 is received from the server. */
const authErrorListeners: Array<() => void> = [];

export function onAuthError(listener: () => void): () => void {
  authErrorListeners.push(listener);
  return () => {
    const idx = authErrorListeners.indexOf(listener);
    if (idx >= 0) authErrorListeners.splice(idx, 1);
  };
}

function notifyAuthError() {
  for (const listener of authErrorListeners) {
    listener();
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
  });

  if (res.status === 401) {
    // Don't fire auth error for login/setup/status endpoints
    const isAuthEndpoint = url.includes('/api/auth/login') ||
      url.includes('/api/auth/setup') ||
      url.includes('/api/auth/me');
    if (!isAuthEndpoint) {
      notifyAuthError();
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Auth API ────────────────────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<{ user: UserInfo }> {
  return request<{ user: UserInfo }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await request<{ status: string }>('/api/auth/logout', {
    method: 'POST',
  });
}

export async function getMe(): Promise<{ user: UserInfo }> {
  return request<{ user: UserInfo }>('/api/auth/me');
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  newEmail?: string,
  newDisplayName?: string,
): Promise<{ user: UserInfo }> {
  return request<{ user: UserInfo }>('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword, newEmail, newDisplayName }),
  });
}

// ─── Admin API ───────────────────────────────────────────────────────────────

export async function listUsers(): Promise<UserInfo[]> {
  return request<UserInfo[]>('/api/auth/admin/users');
}

export async function createUser(
  email: string,
  password: string,
  displayName?: string,
  role?: 'admin' | 'user',
): Promise<{ user: UserInfo }> {
  return request<{ user: UserInfo }>('/api/auth/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName, role }),
  });
}

export async function updateUser(
  id: string,
  updates: { role?: 'admin' | 'user'; displayName?: string | null },
): Promise<{ user: UserInfo }> {
  return request<{ user: UserInfo }>(`/api/auth/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteUser(id: string): Promise<void> {
  return request<void>(`/api/auth/admin/users/${id}`, { method: 'DELETE' });
}

export async function resetUserPassword(
  id: string,
  password: string,
): Promise<void> {
  await request<{ status: string }>(`/api/auth/admin/users/${id}/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

// ─── Document API ────────────────────────────────────────────────────────────

export async function uploadDocument(file: File): Promise<Document> {
  const formData = new FormData();
  formData.append('file', file);
  return request<Document>('/api/documents', {
    method: 'POST',
    body: formData,
  });
}

export async function listDocuments(): Promise<Document[]> {
  return request<Document[]>('/api/documents');
}

export async function getDocument(id: string): Promise<Document> {
  return request<Document>(`/api/documents/${id}`);
}

export async function updateDocument(
  id: string,
  updates: Partial<Pick<Document, 'page_count' | 'original_name'>>,
): Promise<Document> {
  return request<Document>(`/api/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  return request<void>(`/api/documents/${id}`, { method: 'DELETE' });
}

export function getDocumentPdfUrl(id: string): string {
  return `/api/documents/${id}/pdf`;
}

export function getDocumentFileUrl(id: string): string {
  return `/api/documents/${id}/file`;
}

export function getDocumentThumbnailUrl(id: string): string {
  return `/api/documents/${id}/thumbnail`;
}

export async function uploadThumbnail(id: string, blob: Blob): Promise<Document> {
  const formData = new FormData();
  formData.append('thumbnail', blob, `${id}.jpg`);
  return request<Document>(`/api/documents/${id}/thumbnail`, {
    method: 'POST',
    body: formData,
  });
}

// ─── Annotation API ─────────────────────────────────────────────────────────

export async function getDocumentAnnotations(documentId: string): Promise<AnnotationRecord[]> {
  return request<AnnotationRecord[]>(`/api/documents/${documentId}/annotations`);
}

export async function savePageAnnotation(
  documentId: string,
  page: number,
  elements: unknown[],
  pageMetrics?: Record<string, unknown> | null,
): Promise<AnnotationRecord> {
  return request<AnnotationRecord>(`/api/documents/${documentId}/annotations/${page}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elements, pageMetrics }),
  });
}

export async function deletePageAnnotation(documentId: string, page: number): Promise<void> {
  return request<void>(`/api/documents/${documentId}/annotations/${page}`, { method: 'DELETE' });
}
