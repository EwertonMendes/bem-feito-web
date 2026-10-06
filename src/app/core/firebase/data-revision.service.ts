import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import {
  Transaction,
  WriteBatch,
  doc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { FIRESTORE } from './firebase.providers';

export type DataDomain = 'catalog' | 'references' | 'settings' | 'sales' | 'finance' | 'production' | 'inventory';

const DOMAINS: readonly DataDomain[] = [
  'catalog',
  'references',
  'settings',
  'sales',
  'finance',
  'production',
  'inventory',
];

interface RevisionStamp {
  source?: string;
  at?: { toMillis?: () => number };
}

@Injectable({ providedIn: 'root' })
export class DataRevisionService {
  private readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly source = crypto.randomUUID();
  private readonly versions = signal<Record<DataDomain, number>>({
    catalog: 0,
    references: 0,
    settings: 0,
    sales: 0,
    finance: 0,
    production: 0,
    inventory: 0,
  });
  private readonly changeVersions = signal<Record<DataDomain, number>>({
    catalog: 0,
    references: 0,
    settings: 0,
    sales: 0,
    finance: 0,
    production: 0,
    inventory: 0,
  });
  private readonly localVersions = signal<Record<DataDomain, number>>({
    catalog: 0,
    references: 0,
    settings: 0,
    sales: 0,
    finance: 0,
    production: 0,
    inventory: 0,
  });
  private readonly lastTokens = new Map<DataDomain, string>();

  constructor() {
    effect((onCleanup) => {
      const user = this.auth.user();
      if (!user) return;

      const unsubscribe = onSnapshot(
        doc(this.firestore, 'system', 'data-revisions'),
        (snapshot) => {
          if (!snapshot.exists()) return;
          const data = snapshot.data() as Partial<Record<DataDomain, RevisionStamp>>;

          for (const domain of DOMAINS) {
            const stamp = data[domain];
            const millis = stamp?.at?.toMillis?.();
            if (!stamp?.source || millis === undefined) continue;

            const token = `${stamp.source}:${millis}`;
            if (this.lastTokens.get(domain) === token) continue;
            this.lastTokens.set(domain, token);
            this.changeVersions.update((current) => ({ ...current, [domain]: current[domain] + 1 }));

            if (stamp.source === this.source) {
              this.localVersions.update((current) => ({ ...current, [domain]: current[domain] + 1 }));
              continue;
            }
            this.versions.update((current) => ({ ...current, [domain]: current[domain] + 1 }));
          }
        },
        () => {
          // A revision listener is an optimization. Reads still work if it is temporarily unavailable.
        },
      );

      onCleanup(unsubscribe);
    });
  }

  revision(domain: DataDomain): Signal<number> {
    return computed(() => this.versions()[domain]);
  }

  changeRevision(domain: DataDomain): Signal<number> {
    return computed(() => this.changeVersions()[domain]);
  }

  localRevision(domain: DataDomain): Signal<number> {
    return computed(() => this.localVersions()[domain]);
  }

  touchBatch(batch: WriteBatch, ...domains: DataDomain[]): void {
    if (!domains.length) return;
    batch.set(this.revisionRef(), this.patch(domains), { merge: true });
  }

  touchTransaction(transaction: Transaction, ...domains: DataDomain[]): void {
    if (!domains.length) return;
    transaction.set(this.revisionRef(), this.patch(domains), { merge: true });
  }

  private revisionRef() {
    return doc(this.firestore, 'system', 'data-revisions');
  }

  private patch(domains: readonly DataDomain[]): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const domain of new Set(domains)) {
      patch[domain] = { source: this.source, at: serverTimestamp() };
    }
    return patch;
  }
}
