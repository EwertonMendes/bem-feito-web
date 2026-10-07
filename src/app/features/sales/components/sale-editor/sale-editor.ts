import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
import { BfSelect, BfSelectOption } from '../../../../shared/ui/select/select';
import { paymentMethodIcon } from '../../../../shared/ui/select/payment-method-icon';

interface SaleFormModel {
  businessDate: string;
  customerName: string;
  dueDate: string;
  discount: number;
  notes: string;
}

interface ProductCartLine {
  key: string;
  kind: 'product';
  sourceId: string;
  quantity: number;
}

interface KitCartLine {
  key: string;
  kind: 'kit';
  sourceId: string;
  quantity: 1;
  componentProductIds: string[];
}

interface AdditionCartLine {
  key: string;
  kind: 'addition';
  sourceId: string;
  quantity: number;
}

type CartLine = ProductCartLine | KitCartLine | AdditionCartLine;
type CatalogKind = CartLine['kind'];
type MobileView = 'catalog' | 'order';

interface PaymentUi {
  id: string;
  methodId: string;
  amount: number;
}

interface KitSlot {
  index: number;
  label: string;
  candidates: Product[];
}

@Component({
  selector: 'bf-sale-editor',
  imports: [FormField, BfDialog, BfIcon, CatalogImage, BfSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sale-editor.html',
  styleUrl: './sale-editor.scss',
})
export class SaleEditor {
  readonly store = inject(SalesStore);
  readonly catalog = inject(CatalogStore);
  readonly references = inject(CatalogReferenceStore);
  readonly settings = inject(SettingsStore);

  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly dialog = viewChild.required<BfDialog>('saleDialog');

  readonly currency = formatCurrency;
  readonly catalogTab = signal<'products' | 'kits' | 'additions'>('products');
  readonly catalogSearch = signal('');
  readonly catalogCategory = signal('');
  readonly cart = signal<CartLine[]>([]);
  readonly payments = signal<PaymentUi[]>([]);
  readonly mobileView = signal<MobileView>('catalog');
  readonly detailsExpanded = signal(true);
  readonly submitting = signal(false);
  readonly model = signal<SaleFormModel>(this.defaultModel());
  readonly saleForm = form(this.model, (p) => {
    required(p.businessDate);
    min(p.discount, 0);
  });

  readonly filteredProducts = computed(() => {
    const term = this.normalizedSearch();
    const category = this.catalogCategory();
    return this.catalog.activeProducts().filter((product) =>
      (!term || (product.displayName + ' ' + product.code).toLocaleLowerCase('pt-BR').includes(term)) &&
      (!category || product.collectionId === category)
    );
  });

  readonly filteredKits = computed(() => {
    const term = this.normalizedSearch();
    return this.catalog.activeKits().filter((kit) =>
      !term || kit.name.toLocaleLowerCase('pt-BR').includes(term)
    );
  });

  readonly filteredAdditions = computed(() => {
    const term = this.normalizedSearch();
    const category = this.catalogCategory();
    return this.catalog.activeAdditions().filter((addition) =>
      (!term || (addition.name + ' ' + addition.category).toLocaleLowerCase('pt-BR').includes(term)) &&
      (!category || addition.category === category)
    );
  });

  readonly categoryOptions = computed<BfSelectOption[]>(() => {
    const all = { value: '', label: 'Todas as categorias' };

    if (this.catalogTab() === 'products') {
      return [
        all,
        ...this.references.collections()
          .filter((item) => item.active)
          .map((item) => ({ value: item.id, label: item.name })),
      ];
    }

    if (this.catalogTab() === 'additions') {
      return [
        all,
        ...[...new Set(this.catalog.activeAdditions().map((item) => item.category).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'pt-BR'))
          .map((category) => ({ value: category, label: category })),
      ];
    }

    return [all];
  });

  readonly paymentMethodOptions = computed<BfSelectOption[]>(() =>
    this.settings.paymentMethods()
      .filter((method) => method.active)
      .map((method) => ({
        value: method.id,
        label: method.name,
        icon: paymentMethodIcon(method.name),
      })),
  );

  readonly subtotalCents = computed(() =>
    this.cart().reduce((sum, line) => sum + this.lineTotal(line), 0)
  );

  readonly discountCents = computed(() =>
    Math.max(0, toCents(this.model().discount))
  );

  readonly totalCents = computed(() =>
    Math.max(0, this.subtotalCents() - this.discountCents())
  );

  readonly paymentCents = computed(() =>
    this.payments().reduce((sum, payment) => sum + toCents(payment.amount), 0)
  );

  readonly remainingCents = computed(() =>
    Math.max(0, this.totalCents() - this.paymentCents())
  );

  readonly expectedTipCents = computed(() =>
    Math.max(0, this.paymentCents() - this.totalCents())
  );

  readonly cartItemCount = computed(() =>
    this.cart().reduce((sum, line) => sum + line.quantity, 0)
  );

  readonly cartItemLabel = computed(() => {
    const count = this.cartItemCount();
    return count + ' ' + (count === 1 ? 'item' : 'itens');
  });

  readonly hasDraftChanges = computed(() => {
    const model = this.model();
    return (
      this.cart().length > 0 ||
      this.payments().some((payment) => payment.amount > 0) ||
      Boolean(model.customerName.trim()) ||
      Boolean(model.dueDate) ||
      model.discount > 0 ||
      Boolean(model.notes.trim())
    );
  });

  constructor() {
    this.destroyRef.onDestroy(this.references.activate());
    this.destroyRef.onDestroy(this.settings.activate());
  }

  async open(): Promise<void> {
    await Promise.all([
      this.catalog.load(),
      this.references.load(),
      this.settings.load(),
    ]);

    this.resetDraft();
    this.dialog().open();
  }

  selectCatalogTab(tab: 'products' | 'kits' | 'additions'): void {
    this.catalogTab.set(tab);
    this.catalogCategory.set('');
  }

  collectionName(collectionId: string): string {
    return this.references.collections().find((item) => item.id === collectionId)?.name ?? 'Produto';
  }

  quantityInCart(kind: CatalogKind, sourceId: string): number {
    return this.cart()
      .filter((line) => line.kind === kind && line.sourceId === sourceId)
      .reduce((sum, line) => sum + line.quantity, 0);
  }

  decrementCatalogItem(kind: CatalogKind, sourceId: string): void {
    const line = this.cart().find((item) => item.kind === kind && item.sourceId === sourceId);
    if (line) this.changeQuantity(line, -1);
  }

  addProduct(product: Product): void {
    if (product.stock <= 0) {
      this.toast.error(product.displayName + ' está sem estoque.');
      return;
    }

    this.cart.update((items) => {
      const existing = items.find(
        (item) => item.kind === 'product' && item.sourceId === product.id
      ) as ProductCartLine | undefined;

      if (existing && existing.quantity >= product.stock) {
        this.toast.error('Todo o estoque disponível de ' + product.displayName + ' já está no pedido.');
        return items;
      }

      if (existing) {
        return items.map((item) =>
          item.key === existing.key
            ? { ...existing, quantity: existing.quantity + 1 }
            : item
        );
      }

      return [
        ...items,
        {
          key: crypto.randomUUID(),
          kind: 'product',
          sourceId: product.id,
          quantity: 1,
        },
      ];
    });
  }

  addAddition(addition: Addition): void {
    this.cart.update((items) => {
      const existing = items.find(
        (item) => item.kind === 'addition' && item.sourceId === addition.id
      ) as AdditionCartLine | undefined;

      if (existing) {
        return items.map((item) =>
          item.key === existing.key
            ? { ...existing, quantity: existing.quantity + 1 }
            : item
        );
      }

      return [
        ...items,
        {
          key: crypto.randomUUID(),
          kind: 'addition',
          sourceId: addition.id,
          quantity: 1,
        },
      ];
    });
  }

  addKit(kit: Kit): void {
    const slots = this.buildKitSlots(kit);

    if (slots.some((slot) => !slot.candidates.length)) {
      this.toast.error('Não há estoque disponível para completar o kit ' + kit.name + '.');
      return;
    }

    this.cart.update((items) => [
      ...items,
      {
        key: crypto.randomUUID(),
        kind: 'kit',
        sourceId: kit.id,
        quantity: 1,
        componentProductIds: slots.map((slot) => slot.candidates[0]?.id ?? ''),
      },
    ]);
  }

  changeQuantity(line: CartLine, delta: number): void {
    if (line.kind === 'kit') {
      if (delta < 0) {
        this.removeLine(line.key);
      } else {
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

    if (line.kind === 'product') {
      const product = this.catalog.products().find((item) => item.id === line.sourceId);
      if (product && next > product.stock) {
        this.toast.error('Todo o estoque disponível de ' + product.displayName + ' já está no pedido.');
        return;
      }
    }

    this.cart.update((items) =>
      items.map((item) =>
        item.key === line.key ? { ...line, quantity: next } : item
      )
    );
  }

  removeLine(key: string): void {
    this.cart.update((items) => items.filter((item) => item.key !== key));
  }

  clearOrder(): void {
    if (
      this.hasDraftChanges() &&
      !window.confirm('Limpar esta venda? Itens, pagamentos e dados preenchidos serão descartados.')
    ) {
      return;
    }

    this.resetDraft();
  }

  requestClose(): void {
    if (!this.confirmDiscardIfNeeded()) return;
    this.dialog().close();
  }

  onDialogCancel(event: Event): void {
    if (!this.confirmDiscardIfNeeded()) {
      event.preventDefault();
    }
  }

  syncDetailsOpen(event: Event): void {
    const target = event.currentTarget;
    if (target instanceof HTMLDetailsElement) {
      this.detailsExpanded.set(target.open);
    }
  }

  kitSlots(line: KitCartLine): KitSlot[] {
    const kit = this.catalog.kits().find((item) => item.id === line.sourceId);
    return kit ? this.buildKitSlots(kit) : [];
  }

  changeKitSelection(line: KitCartLine, index: number, productId: string): void {
    this.cart.update((items) =>
      items.map((item) => {
        if (item.key !== line.key || item.kind !== 'kit') return item;
        const ids = [...item.componentProductIds];
        ids[index] = productId;
        return { ...item, componentProductIds: ids };
      })
    );
  }

  productSelectOptions(products: Product[]): BfSelectOption[] {
    return products.map((product) => ({
      value: product.id,
      label: product.displayName,
      description: 'Estoque ' + product.stock,
    }));
  }

  addPayment(): void {
    const method = this.settings.paymentMethods().find((item) => item.active);
    if (!method) {
      this.toast.error('Nenhuma forma de pagamento ativa foi encontrada.');
      return;
    }

    this.payments.update((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        methodId: method.id,
        amount: 0,
      },
    ]);
  }

  patchPayment(index: number, patch: Partial<PaymentUi>): void {
    this.payments.update((items) =>
      items.map((item, i) => i === index ? { ...item, ...patch } : item)
    );
  }

  removePayment(index: number): void {
    this.payments.update((items) => items.filter((_, i) => i !== index));
  }

  fillRemaining(index: number): void {
    const previous = this.payments().reduce(
      (sum, item, i) => i === index ? sum : sum + toCents(item.amount),
      0
    );

    this.patchPayment(index, {
      amount: Math.max(0, this.totalCents() - previous) / 100,
    });
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;

    if (this.saleForm().invalid()) {
      this.toast.error('Revise os campos da venda antes de continuar.');
      this.focusFirstInvalidField();
      return;
    }

    if (!this.cart().length) {
      this.toast.error('Adicione pelo menos um item à venda.');
      this.mobileView.set('catalog');
      return;
    }

    if (this.remainingCents() > 0 && !this.model().customerName.trim()) {
      this.toast.error('Informe o cliente quando houver saldo a receber.');
      this.mobileView.set('order');
      queueMicrotask(() => {
        this.host.nativeElement
          .querySelector<HTMLInputElement>('#sale-customer-name')
          ?.focus();
      });
      return;
    }

    const draft: SaleDraft = {
      businessDate: this.model().businessDate,
      customerName: this.model().customerName.trim() || undefined,
      dueDate: this.model().dueDate || undefined,
      discountCents: this.discountCents(),
      notes: this.model().notes.trim() || undefined,
      lines: this.cart().map((line) => this.toDraftLine(line)),
      payments: this.payments()
        .filter((item) => item.methodId && item.amount > 0)
        .map((item): PaymentDraft => ({
          methodId: item.methodId,
          amountReceivedCents: toCents(item.amount),
        })),
    };

    this.submitting.set(true);

    try {
      const result = await this.store.create(draft);
      if (!result) return;

      this.catalog.applyStockChanges(result.stockChanges);
      this.dialog().close();
    } finally {
      this.submitting.set(false);
    }
  }

  lineName(line: CartLine): string {
    if (line.kind === 'product') {
      return this.catalog.products().find((item) => item.id === line.sourceId)?.displayName ?? 'Produto';
    }

    if (line.kind === 'kit') {
      return this.catalog.kits().find((item) => item.id === line.sourceId)?.name ?? 'Kit';
    }

    return this.catalog.additions().find((item) => item.id === line.sourceId)?.name ?? 'Adicional';
  }

  lineImage(line: CartLine): CatalogImageRef | undefined {
    if (line.kind === 'product') {
      return this.catalog.products().find((item) => item.id === line.sourceId)?.image;
    }

    if (line.kind === 'kit') {
      return this.catalog.kits().find((item) => item.id === line.sourceId)?.image;
    }

    return this.catalog.additions().find((item) => item.id === line.sourceId)?.image;
  }

  lineUnitPrice(line: CartLine): number {
    if (line.kind === 'product') {
      return this.catalog.products().find((item) => item.id === line.sourceId)?.salePriceCents ?? 0;
    }

    if (line.kind === 'kit') {
      return this.catalog.kits().find((item) => item.id === line.sourceId)?.priceCents ?? 0;
    }

    return this.catalog.additions().find((item) => item.id === line.sourceId)?.priceCents ?? 0;
  }

  private defaultModel(): SaleFormModel {
    return {
      businessDate: todayBusinessDate(),
      customerName: '',
      dueDate: '',
      discount: 0,
      notes: '',
    };
  }

  private resetDraft(): void {
    const method = this.settings.paymentMethods().find((item) => item.active);

    this.cart.set([]);
    this.model.set(this.defaultModel());
    this.payments.set(
      method
        ? [{
            id: crypto.randomUUID(),
            methodId: method.id,
            amount: 0,
          }]
        : []
    );
    this.catalogTab.set('products');
    this.catalogSearch.set('');
    this.catalogCategory.set('');
    this.mobileView.set('catalog');
    this.detailsExpanded.set(true);
    this.submitting.set(false);
  }

  private confirmDiscardIfNeeded(): boolean {
    return (
      !this.hasDraftChanges() ||
      window.confirm('Descartar esta venda? As alterações ainda não foram salvas.')
    );
  }

  private focusFirstInvalidField(): void {
    queueMicrotask(() => {
      this.host.nativeElement
        .querySelector<HTMLElement>(
          '.sale-dialog input:invalid, .sale-dialog textarea:invalid, .sale-dialog [aria-invalid="true"]'
        )
        ?.focus();
    });
  }

  private normalizedSearch(): string {
    return this.catalogSearch().trim().toLocaleLowerCase('pt-BR');
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

        const formatName = this.references.formats()
          .find((item) => item.id === component.formatId)?.name ?? 'Item';

        slots.push({
          index,
          label: formatName + ' ' + (slot + 1),
          candidates,
        });

        index++;
      }
    }

    return slots;
  }

  private toDraftLine(line: CartLine): SaleDraftLine {
    if (line.kind === 'product') {
      return {
        kind: 'product',
        sourceId: line.sourceId,
        quantity: line.quantity,
      };
    }

    if (line.kind === 'kit') {
      return {
        kind: 'kit',
        sourceId: line.sourceId,
        quantity: 1,
        componentProductIds: line.componentProductIds,
      };
    }

    return {
      kind: 'addition',
      sourceId: line.sourceId,
      quantity: line.quantity,
    };
  }
}
