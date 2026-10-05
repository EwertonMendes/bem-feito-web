import { AuditFields } from './common.model';

export interface GoogleDriveFolders {
  products: string;
  inputs: string;
  kits: string;
  additions: string;
}

export interface GoogleDriveIntegration extends AuditFields {
  id: 'google-drive';
  enabled: boolean;
  rootFolderId: string;
  rootFolderName: string;
  folders: GoogleDriveFolders;
}
