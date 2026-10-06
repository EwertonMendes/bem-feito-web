import { inject } from '@angular/core';
import {
  CollectionReference,
  DocumentData,
  DocumentReference,
  QueryConstraint,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { DataDomain, DataRevisionService } from './data-revision.service';
import { FIREBASE_AUTH, FIRESTORE } from './firebase.providers';

export abstract class FirestoreRepository<T extends { id: string }> {
  protected readonly firestore = inject(FIRESTORE);
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly revisions = inject(DataRevisionService);

  protected constructor(
    private readonly collectionName: string,
    private readonly revisionDomain?: DataDomain,
  ) {}

  protected collectionRef(): CollectionReference<DocumentData> {
    return collection(this.firestore, this.collectionName);
  }

  protected documentRef(id: string): DocumentReference<DocumentData> {
    return doc(this.firestore, this.collectionName, id);
  }

  async list(constraints: QueryConstraint[] = []): Promise<T[]> {
    const snapshot = await getDocs(query(this.collectionRef(), ...constraints));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T);
  }

  async get(id: string): Promise<T | null> {
    const snapshot = await getDoc(this.documentRef(id));
    return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null;
  }

  async create(value: Omit<T, 'id'>, id?: string): Promise<string> {
    const target = id ? this.documentRef(id) : doc(this.collectionRef());
    const userId = this.actor();
    const batch = writeBatch(this.firestore);
    batch.set(target, {
      ...value,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: userId,
      updatedBy: userId,
    });
    this.touch(batch);
    await batch.commit();
    return target.id;
  }

  async replace(value: T): Promise<void> {
    const { id, ...data } = value;
    const { createdAt: _createdAt, createdBy: _createdBy, ...editable } = data as typeof data & {
      createdAt?: unknown;
      createdBy?: string;
    };
    const batch = writeBatch(this.firestore);
    batch.set(this.documentRef(id), {
      ...editable,
      updatedAt: serverTimestamp(),
      updatedBy: this.actor(),
    }, { merge: true });
    this.touch(batch);
    await batch.commit();
  }

  async patch(id: string, data: Partial<Omit<T, 'id'>>): Promise<void> {
    const { createdAt: _createdAt, createdBy: _createdBy, ...editable } = data as typeof data & {
      createdAt?: unknown;
      createdBy?: string;
    };
    const batch = writeBatch(this.firestore);
    batch.update(this.documentRef(id), {
      ...editable,
      updatedAt: serverTimestamp(),
      updatedBy: this.actor(),
    });
    this.touch(batch);
    await batch.commit();
  }

  async clearField(id: string, field: keyof Omit<T, 'id'>): Promise<void> {
    const batch = writeBatch(this.firestore);
    batch.update(this.documentRef(id), {
      [field]: deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: this.actor(),
    });
    this.touch(batch);
    await batch.commit();
  }

  async remove(id: string): Promise<void> {
    const batch = writeBatch(this.firestore);
    batch.delete(this.documentRef(id));
    this.touch(batch);
    await batch.commit();
  }

  private touch(batch: ReturnType<typeof writeBatch>): void {
    if (this.revisionDomain) this.revisions.touchBatch(batch, this.revisionDomain);
  }

  private actor(): string {
    const uid = this.auth.currentUser?.uid;
    if (!uid) throw new Error('Sessão inválida.');
    return uid;
  }
}
