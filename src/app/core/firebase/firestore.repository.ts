import { inject } from '@angular/core';
import {
  CollectionReference, DocumentData, DocumentReference, QueryConstraint,
  collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { FIRESTORE } from './firebase.providers';

export abstract class FirestoreRepository<T extends { id: string }> {
  protected readonly firestore = inject(FIRESTORE);

  protected constructor(private readonly collectionName: string) {}

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
    await setDoc(target, { ...value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return target.id;
  }

  async replace(value: T): Promise<void> {
    const { id, ...data } = value;
    await setDoc(this.documentRef(id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  async patch(id: string, data: Partial<Omit<T, 'id'>>): Promise<void> {
    await updateDoc(this.documentRef(id), { ...data, updatedAt: serverTimestamp() });
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(this.documentRef(id));
  }
}
