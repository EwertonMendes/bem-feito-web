import { inject, Injectable } from '@angular/core';
import { collection, doc, documentId, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, startAfter } from 'firebase/firestore';
import { BusinessDateCursor, PageResult } from './pagination';
import { CashBalanceCheck, CashMovement, CashMovementDraft, CashMovementKind } from '../../domain/models/finance.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';

export const CASH_MOVEMENT_TYPES: Readonly<Record<CashMovementKind, { label: string; direction: 'in' | 'out' }>> = {
  contribution: { label: 'Aporte de capital', direction: 'in' },
  loan: { label: 'Empréstimo recebido', direction: 'in' },
  reimbursement: { label: 'Reembolso a terceiros', direction: 'out' },
  withdrawal: { label: 'Retirada', direction: 'out' },
  'other-in': { label: 'Outra entrada', direction: 'in' },
  'other-out': { label: 'Outra saída', direction: 'out' },
};

function validatedDescription(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) throw new Error('Informe ' + field + ' (até 120 caracteres).');
  return trimmed;
}

@Injectable({ providedIn: 'root' })
export class CashManagementRepository {
  private readonly db = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  async movementPage(pageSize=100,cursor?:BusinessDateCursor|null):Promise<PageResult<CashMovement>> {
    const snapshot=await getDocs(query(collection(this.db,'cashMovements'),
      orderBy('businessDate','desc'),orderBy(documentId(),'desc'),
      ...(cursor?[startAfter(cursor.businessDate,cursor.id)]:[]),limit(pageSize+1)));
    const items=snapshot.docs.slice(0,pageSize).map(item=>({id:item.id,...item.data()} as CashMovement));
    const last=items.at(-1),hasMore=snapshot.size>pageSize;
    return {items,hasMore,nextCursor:hasMore&&last?{businessDate:last.businessDate,id:last.id}:null};
  }

  async movements(): Promise<CashMovement[]> {
    const snapshot = await getDocs(query(collection(this.db, 'cashMovements'),
      orderBy('businessDate', 'desc'), limit(60)));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as CashMovement);
  }

  async balanceChecks(): Promise<CashBalanceCheck[]> {
    const snapshot = await getDocs(query(collection(this.db, 'cashBalanceChecks'),
      orderBy('businessDate', 'desc'), orderBy('createdAt', 'desc'), limit(30)));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data() }) as CashBalanceCheck);
  }

  /** One authoritative latest bank balance for every consumer. A legacy import is a fallback only. */
  async latestBalanceCheck(): Promise<CashBalanceCheck | null> {
    const latest = await getDocs(query(collection(this.db, 'cashBalanceChecks'),
      orderBy('businessDate', 'desc'), orderBy('createdAt', 'desc'), limit(1)));
    const current = latest.docs[0];
    if (current) return { id: current.id, ...current.data() } as CashBalanceCheck;
    return this.legacyBalance();
  }

  async legacyBalance(): Promise<CashBalanceCheck | null> {
    const snapshot = await getDoc(doc(this.db, 'system', 'bank-snapshot'));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return { id: snapshot.id, accountName: 'Conta principal (referência histórica)',
      businessDate: String(data['businessDate'] ?? ''),
      balanceCents: Number(data['balanceCents'] ?? 0),
      note: 'Saldo importado antes do controle de contas. Não é movimentação financeira.' };
  }

  async createMovement(draft: CashMovementDraft): Promise<CashMovement> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate)) throw new Error('Informe uma data válida.');
    if (!Number.isSafeInteger(draft.amountCents) || draft.amountCents <= 0) throw new Error('Informe um valor maior que zero.');
    const kind = CASH_MOVEMENT_TYPES[draft.kind];
    if (!kind) throw new Error('Tipo de movimentação inválido.');
    const accountName = validatedDescription(draft.accountName, 'a conta de destino ou origem');
    const partyName = draft.partyName?.trim() || undefined;
    if (['contribution','loan','reimbursement'].includes(draft.kind) && (!partyName || partyName.length > 120))
      throw new Error('Informe quem forneceu ou recebeu o dinheiro.');
    const notes = draft.notes?.trim() || undefined;
    if (notes && notes.length > 500) throw new Error('Observação muito longa.');
    const movement: Omit<CashMovement, 'id'> = {
      businessDate: draft.businessDate, kind: draft.kind, accountName, amountCents: draft.amountCents,
      impactCents: kind.direction === 'in' ? draft.amountCents : -draft.amountCents,
      ...(partyName ? { partyName } : {}), ...(notes ? { notes } : {}),
      status: 'active', reimbursable: draft.kind === 'loan',
    };
    return runTransaction(this.db, async tx => {
      const ref = doc(collection(this.db, 'cashMovements'));
      tx.set(ref, { ...movement, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: userId, updatedBy: userId });
      this.revisions.touchTransaction(tx, 'finance');
      return { id: ref.id, ...movement };
    });
  }

  async reverseMovement(id: string, reason: string): Promise<CashMovement> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    const text = reason.trim();
    if (text.length < 4 || text.length > 240) throw new Error('Informe o motivo do estorno.');
    return runTransaction(this.db, async tx => {
      const ref = doc(this.db, 'cashMovements', id);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists()) throw new Error('Movimentação não encontrada.');
      const current = { id: snapshot.id, ...snapshot.data() } as CashMovement;
      if (current.status !== 'active') throw new Error('Esta movimentação já foi estornada.');
      tx.update(ref, {
        impactCents: 0, status: 'reversed', reversalReason: text,
        reversedAt: serverTimestamp(), reversedBy: userId,
        updatedAt: serverTimestamp(), updatedBy: userId,
      });
      this.revisions.touchTransaction(tx, 'finance');
      return { ...current, impactCents: 0, status: 'reversed', reversalReason: text };
    });
  }

  async confirmBalance(input: { businessDate: string; accountName: string; balanceCents: number; note?: string }): Promise<CashBalanceCheck> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) throw new Error('Informe uma data válida.');
    if (!Number.isSafeInteger(input.balanceCents) || input.balanceCents < 0) throw new Error('Informe um saldo válido.');
    const accountName = validatedDescription(input.accountName, 'a conta');
    const note = input.note?.trim() || undefined;
    if (note && note.length > 500) throw new Error('Observação muito longa.');
    return runTransaction(this.db, async tx => {
      const ref = doc(collection(this.db, 'cashBalanceChecks'));
      tx.set(ref, { businessDate: input.businessDate, accountName,
        balanceCents: input.balanceCents, ...(note ? { note } : {}),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: userId, updatedBy: userId });
      this.revisions.touchTransaction(tx, 'finance');
      return { id: ref.id, businessDate: input.businessDate, accountName, balanceCents: input.balanceCents, note };
    });
  }
}
