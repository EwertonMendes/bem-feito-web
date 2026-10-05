export type UserRole = 'owner' | 'operator' | 'viewer';

export interface AuditFields {
  createdAt?: unknown;
  updatedAt?: unknown;
  createdBy?: string;
  updatedBy?: string;
}

export interface UserProfile extends AuditFields {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  active: boolean;
}
