import { Injectable } from '@angular/core';
import { GoogleDriveIntegration } from '../../domain/models/integration.model';
import { FirestoreRepository } from '../firebase/firestore.repository';

@Injectable({ providedIn: 'root' })
export class DriveIntegrationRepository extends FirestoreRepository<GoogleDriveIntegration> {
  constructor() {
    super('integrations');
  }

  getConfig(): Promise<GoogleDriveIntegration | null> {
    return this.get('google-drive');
  }

  async saveConfig(config: GoogleDriveIntegration): Promise<void> {
    const existing = await this.getConfig();
    if (existing) {
      await this.replace(config);
      return;
    }
    const { id: _id, ...data } = config;
    await this.create(data, 'google-drive');
  }
}
