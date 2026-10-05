import { Injectable, inject } from '@angular/core';
import { DriveAuthService } from './drive-auth.service';

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  trashed?: boolean;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export class DriveApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class DriveApiService {
  private readonly auth = inject(DriveAuthService);
  private readonly api = 'https://www.googleapis.com/drive/v3';
  private readonly uploadApi = 'https://www.googleapis.com/upload/drive/v3';

  async currentUser(): Promise<{ emailAddress: string; displayName?: string }> {
    const data = await this.json<{ user: { emailAddress: string; displayName?: string } }>(`${this.api}/about?fields=user(emailAddress,displayName)`);
    return data.user;
  }

  getFile(fileId: string): Promise<DriveFileMetadata> {
    const fields = 'id,name,mimeType,modifiedTime,size,trashed,parents,appProperties';
    return this.json<DriveFileMetadata>(`${this.api}/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`);
  }

  async findFolder(parentId: string, name: string): Promise<DriveFileMetadata | null> {
    const escape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    const query = [
      `'${escape(parentId)}' in parents`,
      `name = '${escape(name)}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
    ].join(' and ');
    const params = new URLSearchParams({ q: query, fields: 'files(id,name,mimeType,parents,appProperties)', pageSize: '10' });
    const result = await this.json<{ files: DriveFileMetadata[] }>(`${this.api}/files?${params.toString()}`);
    return result.files[0] ?? null;
  }

  async ensureFolder(parentId: string, name: string, kind: string): Promise<DriveFileMetadata> {
    const existing = await this.findFolder(parentId, name);
    if (existing) return existing;
    return this.json<DriveFileMetadata>(`${this.api}/files?fields=id,name,mimeType,parents,appProperties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
        appProperties: { app: 'bem-feito', kind },
      }),
    });
  }

  async createImage(parentId: string, name: string, blob: Blob, appProperties: Record<string, string>): Promise<DriveFileMetadata> {
    const metadata = await this.json<DriveFileMetadata>(`${this.api}/files?fields=id,name,mimeType,parents,appProperties`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'image/webp', parents: [parentId], appProperties }),
    });

    try {
      return await this.updateImage(metadata.id, blob);
    } catch (error) {
      await this.trash(metadata.id).catch(() => undefined);
      throw error;
    }
  }

  updateImage(fileId: string, blob: Blob): Promise<DriveFileMetadata> {
    const fields = 'id,name,mimeType,modifiedTime,size,trashed,parents,appProperties';
    return this.json<DriveFileMetadata>(
      `${this.uploadApi}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=${encodeURIComponent(fields)}&supportsAllDrives=true`,
      { method: 'PATCH', headers: { 'Content-Type': 'image/webp' }, body: blob },
    );
  }

  async download(fileId: string): Promise<Blob> {
    const response = await this.request(`${this.api}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
    return response.blob();
  }

  async trash(fileId: string): Promise<void> {
    await this.json<DriveFileMetadata>(`${this.api}/files/${encodeURIComponent(fileId)}?fields=id,trashed&supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(url, init);
    return response.json() as Promise<T>;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.auth.requireToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401) this.auth.invalidate();
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new DriveApiError(response.status, `Google Drive respondeu ${response.status}.${body ? ` ${body.slice(0, 300)}` : ''}`);
    }
    return response;
  }
}
