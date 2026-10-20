import { BfLoadingButton } from '../../../../shared/ui/button/loading-button';
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
import { Addition, Product } from '../../../../domain/models/catalog.model';
import { PRODUCT_CATEGORIES, productCategoryId } from '../../../../domain/logic/product-category';
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
import { BfConfirmDialog } from '../../../../shared/ui/confirm-dialog/confirm-dialog';
import { BfDialog } from '../../../../shared/ui/dialog/dialog';
import { BfIcon } from '../../../../shared/ui/icon/icon';
import { BfSelect, BfSelectOption } from '../../../../shared/ui/select/select';
import { paymentMethodIcon } from '../../../../shared/ui/select/payment-method-icon';
import { BfNumberInput } from '../../../../shared/ui/number-input/number-input';

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
  manualUnitPriceCents?: number;
}

interface AdditionCartLine {
  key: string;
  kind: 'addition';
  sourceId: string;
  quantity: number;
}

type CartLine = ProductCartLine | AdditionCartLine;
type CatalogKind = CartLine['kind'];
type MobileView = 'catalog' | 'order';

interface PaymentUi {
  id: string;
  methodId: string;
  amount: number;
}

@Component({
  selector: 'bf-sale-editor',
  imports: [BfLoadingButton, FormField, BfConfirmDialog, BfDialog, BfIcon, CatalogImage, BfSelect, BfNumberInput],
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
  private readonly confirmDialog = viewChild.required<BfConfirmDialog>('confirmDialog');

  readonly currency = formatCurrency;
  readonly catalogTab = signal<'products' | 'additions'>('products');
  readonly catalogSearch = signal('');
  readonly catalogCategory = signal('');
  readonly cart = signal<CartLine[]>([]);
  readonly payments = signal<PaymentUi[]>([]);
  readonly mobileView = signal<MobileView>('catalog');
  readonly detailsExpanded = signal(true);
  readonly submitting = signal(false);
  readonly fulfillmentStatus = signal<'delivered' | 'in-production' | 'ready'>('delivered');
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
      (!category || productCategoryId(product) === category)
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
        ...PRODUCT_CATEGORIES.map((item) => ({ value: item.id, label: item.label })),
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

  async open(initialProductId?: string): Promise<void> {
    await Promise.all([
      this.catalog.load(),
      this.references.load(),
      this.settings.load(),
    ]);

    this.resetDraft();
    if (initialProductId) {
      const product = this.catalog.activeProducts().find(item => item.id === initialProductId);
      if (product && this.canAddProduct(product)) this.addProduct(product);
    }
    this.dialog().open();
  }

  selectCatalogTab(tab: 'products' | 'additions'): void {
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

  canAddProduct(product: Product): boolean {
    return product.active && (this.fulfillmentStatus() === 'in-production' || this.availableProductStock(product.id) > 0);
  }

  addProduct(product: Product): void {
    if (!this.canAddProduct(product)) {
      this.toast.error('Todo o estoque disponível de ' + product.displayName + ' já está comprometido neste pedido.');
      return;
    }

    this.cart.update((items) => {
      const existing = items.find(
        (item) => item.kind === 'product' && item.sourceId === product.id
      ) as ProductCartLine | undefined;

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

  changeQuantity(line: CartLine, delta: number): void {
    const next = line.quantity + delta;

    if (next <= 0) {
      this.removeLine(line.key);
      return;
    }

    if (line.kind === 'product' && delta > 0 && this.fulfillmentStatus() !== 'in-production') {
      const product = this.catalog.products().find((item) => item.id === line.sourceId);
      if (product && this.availableProductStock(product.id) < delta) {
        this.toast.error('Todo o estoque disponível de ' + product.displayName + ' já está comprometido neste pedido.');
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
    if (this.submitting()) return;
    void this.confirmClearOrder();
  }

  requestClose(): void {
    if (this.submitting()) return;
    void this.confirmClose();
  }

  onDialogCancel(event: Event): void {
    event.preventDefault();
    if (this.submitting()) return;
    void this.confirmClose();
  }

  syncDetailsOpen(event: Event): void {
    const target = event.currentTarget;
    if (target instanceof HTMLDetailsElement) {
      this.detailsExpanded.set(target.open);
    }
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

    if ((this.remainingCents() > 0 || this.fulfillmentStatus() !== 'delivered') && !this.model().customerName.trim()) {
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
      fulfillmentStatus: this.fulfillmentStatus(),
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
      this.dialog().closeAfterSuccess();
    } finally {
      this.submitting.set(false);
    }
  }

  lineName(line: CartLine): string {
    if (line.kind === 'product') {
      return this.catalog.products().find((item) => item.id === line.sourceId)?.displayName ?? 'Produto';
    }


    return this.catalog.additions().find((item) => item.id === line.sourceId)?.name ?? 'Adicional';
  }

  setLinePrice(line: CartLine, price: number): void {
    if (line.kind !== 'product' || !Number.isFinite(price) || price < 0) return;
    const cents = toCents(price);
    if (!Number.isSafeInteger(cents)) return;
    this.cart.update(items => items.map(item => item.key === line.key ? { ...item, manualUnitPriceCents: cents } : item));
  }

  restoreLinePrice(line: CartLine): void {
    if (line.kind !== 'product') return;
    this.cart.update(items => items.map(item => {
      if (item.key !== line.key || item.kind !== 'product') return item;
      const { manualUnitPriceCents: _ignored, ...original } = item;
      return original;
    }));
  }

  lineImage(line: CartLine): CatalogImageRef | undefined {
    if (line.kind === 'product') {
      return this.catalog.products().find((item) => item.id === line.sourceId)?.image;
    }


    return this.catalog.additions().find((item) => item.id === line.sourceId)?.image;
  }

  lineUnitPrice(line: CartLine): number {
    if (line.kind === 'product') {
      return line.manualUnitPriceCents ?? this.catalog.products().find((item) => item.id === line.sourceId)?.salePriceCents ?? 0;
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
    this.fulfillmentStatus.set('delivered');
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

  private async confirmClearOrder(): Promise<void> {
    if (this.submitting()) return;
    if (!this.hasDraftChanges()) {
      this.resetDraft();
      return;
    }

    const confirmed = await this.confirmDialog().open({
      title: 'Limpar pedido?',
      message: 'Os itens, pagamentos e dados preenchidos nesta venda serão descartados.',
      confirmLabel: 'Limpar pedido',
      cancelLabel: 'Continuar venda',
      tone: 'danger',
      icon: 'trash',
    });

    if (confirmed && !this.submitting()) this.resetDraft();
  }

  private async confirmClose(): Promise<void> {
    if (this.submitting()) return;
    if (!this.hasDraftChanges()) {
      this.dialog().close();
      return;
    }

    const confirmed = await this.confirmDialog().open({
      title: 'Descartar esta venda?',
      message: 'As alterações desta venda ainda não foram salvas. Se sair agora, elas serão perdidas.',
      confirmLabel: 'Descartar venda',
      cancelLabel: 'Continuar venda',
      tone: 'danger',
      icon: 'alert',
    });

    if (confirmed && !this.submitting()) this.dialog().close();
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

  private reservedProductQuantities(excludeLineKey?: string): Map<string, number> {
    const reserved = new Map<string, number>();

    const reserve = (productId: string, quantity: number): void => {
      reserved.set(productId, (reserved.get(productId) ?? 0) + quantity);
    };

    for (const line of this.cart()) {
      if (line.key === excludeLineKey) continue;

      if (line.kind === 'product') {
        reserve(line.sourceId, line.quantity);
      }
    }

    return reserved;
  }

  private availableProductStock(productId: string): number {
    const product = this.catalog.products().find((item) => item.id === productId);
    if (!product) return 0;
    return Math.max(0, product.stock - (product.reservedPhysicalStock ?? Math.min(product.stock, product.committedStock ?? 0)) - (this.reservedProductQuantities().get(productId) ?? 0));
  }

  private toDraftLine(line: CartLine): SaleDraftLine {
    if (line.kind === 'product') {
      return {
        kind: 'product',
        sourceId: line.sourceId,
        quantity: line.quantity,
        ...(line.manualUnitPriceCents !== undefined ? {manualUnitPriceCents: line.manualUnitPriceCents} : {}),
      };
    }


    return {
      kind: 'addition',
      sourceId: line.sourceId,
      quantity: line.quantity,
    };
  }
}
