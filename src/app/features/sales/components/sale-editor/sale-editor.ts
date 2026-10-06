import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { Addition, Kit, Product } from '../../../../domain/models/catalog.model';
import { CatalogImageRef } from '../../../../domain/models/image.model';
import { PaymentDraft, SaleDraft, SaleDraftLine } from '../../../../domain/models/sales.model';
import { ToastService } from '../../../../core/services/toast.service';
import { todayBusinessDate } from '../../../../core/utils/date';
import { formatCurrency, toCents } from '../../../../core/utils/money';
import { CatalogReferenceStore } from '../../../catalog/catalog-reference.store';
import { CatalogStore } from '../../../catalog/catalog.store';
import { SettingsStore } from '../../../settings/settings.store';
import { SalesStore } from '../../sales.store';
import { CatalogImage } from '../../../../shared/media/catalog-image/catalog-image';
import { BfDialog } from '../../../../shared/ui/dialog/dialog';
import { BfIcon } from '../../../../shared/ui/icon/icon';

interface SaleFormModel { businessDate: string; customerName: string; dueDate: string; discount: number; notes: string; }
interface ProductCartLine { key: string; kind: 'product'; sourceId: string; quantity: number; }
interface KitCartLine { key: string; kind: 'kit'; sourceId: string; quantity: 1; componentProductIds: string[]; }
interface AdditionCartLine { key: string; kind: 'addition'; sourceId: string; quantity: number; }
type CartLine = ProductCartLine | KitCartLine | AdditionCartLine;
interface PaymentUi { id: string; methodId: string; amount: number; }
interface KitSlot { index: number; label: string; candidates: Product[]; }

@Component({
  selector: 'bf-sale-editor',
  imports: [FormField, BfDialog, BfIcon, CatalogImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sale-editor.html',
  styleUrl: './sale-editor.scss',
})
export class SaleEditor {
  readonly store = inject(SalesStore);
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly settings = inject(SettingsStore);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<BfDialog>('saleDialog');

  readonly currency = formatCurrency;
  readonly catalogTab = signal<'products' | 'kits' | 'additions'>('products');
  readonly cart = signal<CartLine[]>([]);
  readonly payments = signal<PaymentUi[]>([]);
  readonly model = signal<SaleFormModel>({ businessDate: todayBusinessDate(), customerName: '', dueDate: '', discount: 0, notes: '' });
  readonly saleForm = form(this.model, (p) => { required(p.businessDate); min(p.discount, 0); });

  readonly subtotalCents = computed(() => this.cart().reduce((sum, line) => sum + this.lineTotal(line), 0));
  readonly totalCents = computed(() => Math.max(0, this.subtotalCents() - toCents(this.model().discount)));
  readonly paymentCents = computed(() => this.payments().reduce((sum, payment) => sum + toCents(payment.amount), 0));
  readonly remainingCents = computed(() => Math.max(0, this.totalCents() - this.paymentCents()));
  readonly expectedTipCents = computed(() => Math.max(0, this.paymentCents() - this.totalCents()));
  readonly cartPhysicalItems = computed(() => this.cart().reduce((sum, line) => line.kind === 'product' ? sum + line.quantity : line.kind === 'kit' ? sum + line.componentProductIds.length : sum, 0));

  async open(): Promise<void> {
    await Promise.all([this.catalog.load(), this.references.load(), this.settings.load()]);
    this.cart.set([]);
    this.model.set({ businessDate: todayBusinessDate(), customerName: '', dueDate: '', discount: 0, notes: '' });
    const method = this.settings.paymentMethods().find((item) => item.active);
    this.payments.set(method ? [{ id: crypto.randomUUID(), methodId: method.id, amount: 0 }] : []);
    this.catalogTab.set('products');
    this.dialog().open();
  }

  addProduct(product: Product): void {
    if (product.stock <= 0) {
      this.toast.error(`${product.displayName} está sem estoque.`);
      return;
    }
    this.cart.update((items) => {
      const existing = items.find((item) => item.kind === 'product' && item.sourceId === product.id) as ProductCartLine | undefined;
      if (existing) return items.map((item) => item.key === existing.key ? { ...existing, quantity: existing.quantity + 1 } : item);
      return [...items, { key: crypto.randomUUID(), kind: 'product', sourceId: product.id, quantity: 1 }];
    });
  }

  addAddition(addition: Addition): void {
    this.cart.update((items) => {
      const existing = items.find((item) => item.kind === 'addition' && item.sourceId === addition.id) as AdditionCartLine | undefined;
      if (existing) return items.map((item) => item.key === existing.key ? { ...existing, quantity: existing.quantity + 1 } : item);
      return [...items, { key: crypto.randomUUID(), kind: 'addition', sourceId: addition.id, quantity: 1 }];
    });
  }

  addKit(kit: Kit): void {
    const slots = this.buildKitSlots(kit);
    if (slots.some((slot) => !slot.candidates.length)) {
      this.toast.error(`Não há estoque disponível para completar o kit ${kit.name}.`);
      return;
    }
    this.cart.update((items) => [...items, { key: crypto.randomUUID(), kind: 'kit', sourceId: kit.id, quantity: 1, componentProductIds: slots.map((slot) => slot.candidates[0]?.id ?? '') }]);
  }

  changeQuantity(line: CartLine, delta: number): void {
    if (line.kind === 'kit') {
      if (delta < 0) this.removeLine(line.key);
      else {
        const kit = this.catalog.kits().find((item) => item.id === line.sourceId);
        if (kit) this.addKit(kit);
      }
      return;
    }
    const next = line.quantity + delta;
    if (next <= 0) {
      this.removeLine(line.key);
      return;
    }
    this.cart.update((items) => items.map((item) => item.key === line.key ? { ...line, quantity: next } : item));
  }

  removeLine(key: string): void {
    this.cart.update((items) => items.filter((item) => item.key !== key));
  }

  kitSlots(line: KitCartLine): KitSlot[] {
    const kit = this.catalog.kits().find((item) => item.id === line.sourceId);
    return kit ? this.buildKitSlots(kit) : [];
  }

  changeKitSelection(line: KitCartLine, index: number, productId: string): void {
    this.cart.update((items) => items.map((item) => {
      if (item.key !== line.key || item.kind !== 'kit') return item;
      const ids = [...item.componentProductIds];
      ids[index] = productId;
      return { ...item, componentProductIds: ids };
    }));
  }

  addPayment(): void {
    const method = this.settings.paymentMethods().find((item) => item.active);
    if (method) this.payments.update((items) => [...items, { id: crypto.randomUUID(), methodId: method.id, amount: 0 }]);
  }

  patchPayment(index: number, patch: Partial<PaymentUi>): void {
    this.payments.update((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  removePayment(index: number): void {
    this.payments.update((items) => items.filter((_, i) => i !== index));
  }

  fillRemaining(index: number): void {
    const previous = this.payments().reduce((sum, item, i) => i === index ? sum : sum + toCents(item.amount), 0);
    this.patchPayment(index, { amount: Math.max(0, this.totalCents() - previous) / 100 });
  }

  async submit(): Promise<void> {
    if (this.saleForm().invalid()) return;
    if (!this.cart().length) {
      this.toast.error('Adicione pelo menos um item à venda.');
      return;
    }
    if (this.remainingCents() > 0 && !this.model().customerName.trim()) {
      this.toast.error('Informe o cliente quando houver saldo a receber.');
      return;
    }

    const draft: SaleDraft = {
      businessDate: this.model().businessDate,
      customerName: this.model().customerName.trim() || undefined,
      dueDate: this.model().dueDate || undefined,
      discountCents: toCents(this.model().discount),
      notes: this.model().notes.trim() || undefined,
      lines: this.cart().map((line) => this.toDraftLine(line)),
      payments: this.payments()
        .filter((item) => item.methodId && item.amount > 0)
        .map((item): PaymentDraft => ({ methodId: item.methodId, amountReceivedCents: toCents(item.amount) })),
    };

    const ok = await this.store.create(draft);
    if (!ok) return;
    await this.catalog.load(true);
    this.dialog().close();
  }

  lineName(line: CartLine): string {
    if (line.kind === 'product') return this.catalog.products().find((item) => item.id === line.sourceId)?.displayName ?? 'Produto';
    if (line.kind === 'kit') return this.catalog.kits().find((item) => item.id === line.sourceId)?.name ?? 'Kit';
    return this.catalog.additions().find((item) => item.id === line.sourceId)?.name ?? 'Adicional';
  }

  lineImage(line: CartLine): CatalogImageRef | undefined {
    if (line.kind === 'product') return this.catalog.products().find((item) => item.id === line.sourceId)?.image;
    if (line.kind === 'kit') return this.catalog.kits().find((item) => item.id === line.sourceId)?.image;
    return this.catalog.additions().find((item) => item.id === line.sourceId)?.image;
  }

  lineUnitPrice(line: CartLine): number {
    if (line.kind === 'product') return this.catalog.products().find((item) => item.id === line.sourceId)?.salePriceCents ?? 0;
    if (line.kind === 'kit') return this.catalog.kits().find((item) => item.id === line.sourceId)?.priceCents ?? 0;
    return this.catalog.additions().find((item) => item.id === line.sourceId)?.priceCents ?? 0;
  }

  private lineTotal(line: CartLine): number {
    return this.lineUnitPrice(line) * line.quantity;
  }

  private buildKitSlots(kit: Kit): KitSlot[] {
    const slots: KitSlot[] = [];
    let index = 0;
    for (const component of [...kit.components].sort((a, b) => a.order - b.order)) {
      for (let slot = 0; slot < component.quantity; slot++) {
        const candidates = this.catalog.activeProducts().filter((product) =>
          product.stock > 0 &&
          product.formatId === component.formatId &&
          (!component.collectionId || product.collectionId === component.collectionId) &&
          (!component.fragranceId || product.fragranceId === component.fragranceId)
        );
        const format = this.references.formats().find((item) => item.id === component.formatId)?.name ?? 'Item';
        slots.push({ index, label: `${format} ${slot + 1}`, candidates });
        index++;
      }
    }
    return slots;
  }

  private toDraftLine(line: CartLine): SaleDraftLine {
    if (line.kind === 'product') return { kind: 'product', sourceId: line.sourceId, quantity: line.quantity };
    if (line.kind === 'kit') return { kind: 'kit', sourceId: line.sourceId, quantity: 1, componentProductIds: line.componentProductIds };
    return { kind: 'addition', sourceId: line.sourceId, quantity: line.quantity };
  }
}
