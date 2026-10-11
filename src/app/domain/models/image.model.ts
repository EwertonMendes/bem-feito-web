export type CatalogImageEntityKind = 'products' | 'inputs' | 'additions';

export interface CatalogImageRef {
  provider: 'google-drive';
  fileId: string;
  mimeType: 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
  modifiedTime: string;
}
