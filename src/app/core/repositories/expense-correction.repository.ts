import { inject, Injectable } from '@angular/core';
import { collection, deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { landedPurchaseCosts } from '../../domain/logic/acquisition';
import { trackingModeForInput } from '../../domain/logic/costing';
import { stockStatusForInput } from '../../domain/logic/stock-status';
import { InputItem } from '../../domain/models/catalog.model';
import { AcquisitionCharge, Expense, ExpenseDraft, fundingTypeOf, PurchaseBatchDraft, PurchaseItem } from '../../domain/models/finance.model';
import { StockMovement } from '../../domain/models/inventory.model';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { todayBusinessDate } from '../utils/date';
import { ExpenseCreateResult, StockChange } from './mutation-results';

type RevisionDraft = ExpenseDraft | PurchaseBatchDraft;
type PurchaseInput = Pick<PurchaseItem, 'inputId' | 'unitId' | 'quantity' | 'amountCents' | 'landedCostCents'>;

function itemsFor(expense: Expense): PurchaseInput[] {
  if (expense.items?.length) return expense.items;
  return expense.inputId && expense.quantity && expense.unitId
    ? [{ inputId: expense.inputId, unitId: expense.unitId, quantity: expense.quantity,
         amountCents: expense.amountCents, landedCostCents: expense.amountCents }] : [];
}

function normalizedPurchase(items: PurchaseItem[], charges: AcquisitionCharge[]): PurchaseInput[] {
  if (!items.length || items.length > 40) throw new Error('Informe os itens da compra.');
  const grouped = new Map<string, PurchaseItem>();
  for (const row of items) {
    if (!row.inputId || !row.unitId || !Number.isFinite(row.quantity) || row.quantity <= 0 ||
      !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0) throw new Error('Revise quantidade e valor dos itens.');
    const previous = grouped.get(row.inputId);
    if (previous && previous.unitId !== row.unitId) throw new Error('Unidades incompatíveis para um mesmo insumo.');
    grouped.set(row.inputId, { ...row, quantity: (previous?.quantity ?? 0) + row.quantity,
      amountCents: (previous?.amountCents ?? 0) + row.amountCents });
  }
  const values = [...grouped.values()];
  const costs = landedPurchaseCosts(values, charges);
  return values.map((value, index) => ({ ...value, landedCostCents: costs[index] }));
}

function safeRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, data]) => data !== undefined));
}

/** Corrections are atomic, auditable deltas. Never delete a financial or stock event. */
@Injectable({ providedIn: 'root' })
export class ExpenseCorrectionRepository {
  private readonly db = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  correct(id: string, draft: RevisionDraft, reason: string): Promise<ExpenseCreateResult> {
    return this.apply(id, draft, reason, false);
  }

  cancel(id: string, reason: string): Promise<ExpenseCreateResult> {
    return this.apply(id, null, reason, true);
  }

  private async apply(id: string, draft: RevisionDraft | null, reason: string, cancelling: boolean): Promise<ExpenseCreateResult> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    if (reason.trim().length < 4 || reason.trim().length > 240) throw new Error('Informe o motivo da correção (mínimo de 4 caracteres).');
    if (!cancelling && (!draft || !/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate))) throw new Error('Data inválida.');
    return runTransaction(this.db, async tx => {
      const expenseRef = doc(this.db, 'expenses', id);
      const original = await tx.get(expenseRef);
      if (!original.exists()) throw new Error('Lançamento não encontrado.');
      const current = { id: original.id, ...original.data() } as Expense;
      if (current.status === 'cancelled') throw new Error('O lançamento já foi cancelado.');
      const isPurchase = current.kind === 'input-purchase';
      if (!cancelling && draft) {
        if (isPurchase !== ('items' in draft) || (!isPurchase && 'kind' in draft && current.kind !== draft.kind))
          throw new Error('Não é permitido trocar o tipo de um lançamento. Cancele e registre outro.');
      }
      const purchaseDraft = !cancelling && isPurchase ? draft as PurchaseBatchDraft : null;
      const oldItems = isPurchase && current.stockApplied !== false ? itemsFor(current) : [];
      if (isPurchase && current.stockApplied !== false && !oldItems.length)
        throw new Error('Compra histórica sem composição de insumos. Confirme os itens antes de corrigir.');
      const charges = purchaseDraft?.charges ?? [];
      const newItems = purchaseDraft ? normalizedPurchase(purchaseDraft.items, charges) : [];
      const total = cancelling ? 0 : isPurchase
        ? newItems.reduce((sum, item) => sum + item.amountCents, 0) + charges.reduce((sum, item) => sum + item.amountCents, 0)
        : (draft as ExpenseDraft).amountCents;
      if (!cancelling && (!Number.isSafeInteger(total) || total <= 0))
        throw new Error('Informe um valor total válido.');
      const source = draft?.fundingType ?? (draft?.fundingSource === 'unverified' ? 'unverified' :
        draft?.fundingSource && draft.fundingSource !== 'business' ? 'third-party' : 'business');
      const paymentSource = draft?.fundingType
        ? (source === 'third-party' ? 'owner-unassigned' : source === 'unverified' ? 'unverified' : 'business')
        : draft?.fundingSource ?? current.fundingSource ?? 'business';
      if (!cancelling && source === 'third-party' && !draft?.paidBy?.trim() && !current.paidBy)
        throw new Error('Informe quem pagou com recursos próprios.');

      const next: Expense = cancelling ? { ...current, amountCents: 0, bankDebitCents: 0,
        cancelledAmountCents: current.amountCents, status: 'cancelled' } : {
          ...current, businessDate: draft!.businessDate, amountCents: total,
          paymentMethodId: draft!.paymentMethodId, fundingSource: paymentSource,
          fundingType: source, paidBy: source === 'third-party' ? (draft!.paidBy?.trim() || current.paidBy) : undefined,
          reimbursable: source === 'third-party' && !!draft!.reimbursable,
          bankDebitCents: source === 'business' ? total : 0,
          notes: draft!.notes?.trim(), link: draft!.link?.trim(),
          ...(!isPurchase ? { itemName: (draft as ExpenseDraft).itemName?.trim() || undefined } : {}),
          ...(isPurchase ? { items: newItems, charges, receiptStatus: current.receiptStatus,
            stockApplied: current.stockApplied } : { categoryId: (draft as ExpenseDraft).categoryId }),
          status: 'active',
        };
      const previous = new Map<string, PurchaseInput>();
      const following = new Map<string, PurchaseInput>();
      for (const row of oldItems) previous.set(row.inputId, row);
      // Pending orders do not affect physical stock until receipt.
      if (isPurchase && current.stockApplied !== false && !cancelling)
        for (const row of newItems) following.set(row.inputId, row);
      const impacted = [...new Set([...previous.keys(), ...following.keys()])];
      const snapshots = await Promise.all(impacted.map(inputId => tx.get(doc(this.db, 'inputs', inputId))));
      const changes: StockChange[] = [];
      const operations: { ref: typeof snapshots[number]['ref']; patch: Record<string, unknown>; movement?: Omit<StockMovement, 'id'> }[] = [];
      for (let i = 0; i < impacted.length; i++) {
        const snapshot = snapshots[i]!;
        if (!snapshot.exists()) throw new Error('Insumo da compra não encontrado.');
        const input = { id: snapshot.id, ...snapshot.data() } as InputItem;
        const old = previous.get(input.id), updated = following.get(input.id);
        if (updated && updated.unitId !== input.unitId) throw new Error('Unidade do insumo incompatível.');
        const deltaQty = (updated?.quantity ?? 0) - (old?.quantity ?? 0);
        const deltaCost = (updated?.landedCostCents ?? updated?.amountCents ?? 0)
          - (old?.landedCostCents ?? old?.amountCents ?? 0);
        const prevQty = Math.max(0, Number(input.costBasisQuantity ?? input.stock));
        const prevValue = Math.max(0, Number(input.costBasisValueCents ?? Math.round(prevQty * input.averageUnitCostCents)));
        const basisQty = prevQty + deltaQty, basisValue = prevValue + deltaCost;
        const mode = trackingModeForInput(input);
        const stock = mode === 'untracked' ? input.stock : input.stock + deltaQty;
        const reserved = input.reservedPhysicalStock ?? 0;
        if (basisQty < -0.000001 || basisValue < 0 || (basisQty <= 0 && basisValue > 0) ||
          stock < 0 || stock < reserved)
          throw new Error('Este insumo já foi consumido ou reservado. Não é possível desfazer a compra com segurança; confira o estoque antes.');
        const averageUnitCostCents = basisQty > 0 ? Math.round(basisValue / basisQty) : 0;
        operations.push({ ref: snapshot.ref, patch: {
          ...(mode === 'untracked' ? {} : { stock, stockStatus: stockStatusForInput({ ...input, stock }) }),
          costBasisQuantity: Math.max(0,basisQty), costBasisValueCents: basisValue, averageUnitCostCents,
          updatedAt: serverTimestamp(), updatedBy: userId },
          ...(deltaQty && mode !== 'untracked' ? { movement: {
            itemType: 'input', itemId: input.id, quantityDelta: deltaQty,
            unitCostCents: Math.round(Math.abs(deltaCost / deltaQty)),
            totalCostCents: Math.abs(deltaCost), sourceType: cancelling ? 'purchase-cancellation' : 'purchase-correction',
            sourceId: id, businessDate: todayBusinessDate(),
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            createdBy: userId, updatedBy: userId,
          } } : {}),
        });
        changes.push({ itemType: 'input', itemId: input.id, stock, averageUnitCostCents });
      }
      for (const operation of operations) {
        tx.update(operation.ref, operation.patch);
        if (operation.movement) {
          const moveRef = doc(collection(this.db, 'stockMovements'));
          tx.set(moveRef, operation.movement);
        }
      }
      const { id: _id, createdAt: _createdAt, createdBy: _createdBy, ...editable } = next;
      tx.update(expenseRef, { ...safeRecord(editable),
        ...(!cancelling && source !== 'third-party' && current.paidBy ? { paidBy: deleteField() } : {}),
        updatedAt: serverTimestamp(), updatedBy: userId });
      const revisionRef = doc(collection(this.db, 'expenseCorrections'));
      tx.set(revisionRef, {
        expenseId: id, kind: cancelling ? 'cancellation' : 'correction', reason: reason.trim(),
        businessDate: todayBusinessDate(),
        before: safeRecord(current), after: safeRecord(next),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        createdBy: userId, updatedBy: userId,
      });
      this.revisions.touchTransaction(tx, 'expenses', ...(impacted.length ? ['inventory'] as const : []));
      return { expense: next, stockChanges: changes };
    });
  }
}
