import { inject, Injectable } from '@angular/core';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { AuthService } from '../auth/auth.service';
import { DataRevisionService } from '../firebase/data-revision.service';
import { FIRESTORE } from '../firebase/firebase.providers';
import { todayBusinessDate } from '../utils/date';
import { Payment, Sale } from '../../domain/models/sales.model';
import { ShippingCorrectionDraft, planShippingCorrection, shippingCorrectionSignature } from '../../domain/logic/shipping-correction';

@Injectable({ providedIn: 'root' })
export class ShippingCorrectionRepository {
  private readonly db = inject(FIRESTORE);
  private readonly auth = inject(AuthService);
  private readonly revisions = inject(DataRevisionService);

  async correct(saleId: string, draft: ShippingCorrectionDraft): Promise<{sale: Sale; payments: Payment[]; previousBalanceCents: number}> {
    const userId = this.auth.user()?.uid;
    if (!userId) throw new Error('Sessão inválida.');
    const reason = draft.reason.trim();
    if (reason.length < 4 || reason.length > 240) throw new Error('Informe o motivo da correção (4 a 240 caracteres).');
    return runTransaction(this.db, async tx => {
      const saleRef = doc(this.db, 'sales', saleId);
      const snapshot = await tx.get(saleRef);
      if (!snapshot.exists()) throw new Error('Venda não encontrada.');
      const current = { id: snapshot.id, ...snapshot.data() } as Sale;
      if (shippingCorrectionSignature(current) !== draft.expectedSignature)
        throw new Error('A venda mudou. Reabra a correção antes de continuar.');
      const plan = planShippingCorrection(current, draft.shippingFeeCents, draft.reclassifyTip);
      const paymentSnapshots = [];
      for (const paymentId of current.paymentIds) {
        const paymentSnapshot = await tx.get(doc(this.db,'payments',paymentId));
        if (!paymentSnapshot.exists()) throw new Error('Um recebimento vinculado está ausente.');
        paymentSnapshots.push(paymentSnapshot);
      }
      const active = paymentSnapshots.map(p => ({snapshot:p,payment:{id:p.id,...p.data()} as Payment}))
        .filter(p => p.payment.status === 'active');
      if (active.some(({payment}) => payment.saleId !== saleId ||
          payment.amountReceivedCents !== payment.appliedCents + payment.tipCents))
        throw new Error('Recebimento vinculado inconsistente.');
      if (active.reduce((sum,p) => sum+p.payment.appliedCents,0) !== current.receivedCents ||
          active.reduce((sum,p) => sum+p.payment.tipCents,0) !== current.tipCents)
        throw new Error('Recebimentos não conciliados com a venda.');
      let remainder = plan.reclassifiedCents;
      const payments: Payment[] = [];
      const beforePayments: Array<{id:string;appliedCents:number;tipCents:number}> = [];
      for (const {snapshot:paymentRef,payment} of active) {
        const applied = Math.min(remainder,payment.tipCents);
        if (!applied) continue;
        const next = {...payment,appliedCents:payment.appliedCents+applied,tipCents:payment.tipCents-applied};
        beforePayments.push({id:payment.id,appliedCents:payment.appliedCents,tipCents:payment.tipCents});
        payments.push(next);
        tx.update(paymentRef.ref,{appliedCents:next.appliedCents,tipCents:next.tipCents,
          updatedAt:serverTimestamp(),updatedBy:userId});
        remainder -= applied;
      }
      if (remainder !== 0) throw new Error('Gorjeta insuficiente para reclassificação.');
      const sale:Sale={...current,shippingFeeCents:draft.shippingFeeCents,
        totalCents:plan.totalCents,receivedCents:plan.receivedCents,
        tipCents:plan.tipCents,balanceCents:plan.balanceCents,paymentStatus:plan.paymentStatus};
      tx.update(saleRef,{shippingFeeCents:sale.shippingFeeCents,totalCents:sale.totalCents,
        receivedCents:sale.receivedCents,tipCents:sale.tipCents,balanceCents:sale.balanceCents,
        paymentStatus:sale.paymentStatus,updatedAt:serverTimestamp(),updatedBy:userId});
      tx.set(doc(collection(this.db,'saleCorrections')),{
        saleId,businessDate:todayBusinessDate(),kind:'shipping',reason,
        before:{shippingFeeCents:current.shippingFeeCents??0,totalCents:current.totalCents,
          receivedCents:current.receivedCents,tipCents:current.tipCents,balanceCents:current.balanceCents,
          payments:beforePayments},
        after:{shippingFeeCents:sale.shippingFeeCents,totalCents:sale.totalCents,
          receivedCents:sale.receivedCents,tipCents:sale.tipCents,balanceCents:sale.balanceCents,
          payments:payments.map(p=>({id:p.id,appliedCents:p.appliedCents,tipCents:p.tipCents}))},
        createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:userId,updatedBy:userId,
      });
      this.revisions.touchTransaction(tx,'sales',...(payments.length ? ['payments'] as const : []));
      return {sale,payments,previousBalanceCents:current.balanceCents};
    });
  }
}
