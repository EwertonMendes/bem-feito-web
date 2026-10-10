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
import { allocateKitStock } from '../../../../domain/logic/kit-stock';
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

interface KitAvailability {
  available: boolean;
  message: string;
  details: string[];
  productIds: string[];
}

@Component({
  selector: 'bf-sale-editor',
  imports: [FormField, BfConfirmDialog, BfDialog, BfIcon, CatalogImage, BfSelect, BfNumberInput],
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

  readonly kitAvailabilityById = computed(() =>
    new Map(
      this.catalog.activeKits().map((kit) => [kit.id, this.planKit(kit)] as const)
    )
  );

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

  async open(initialProductId?: string, _initialKitId?: string): Promise<void> {
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

  kitAvailability(kit: Kit): KitAvailability {
    return this.kitAvailabilityById().get(kit.id) ?? this.planKit(kit);
  }

  addKit(_kit: Kit): void {
    this.toast.error('Kits desativados. Adicione os produtos individualmente e aplique o desconto manual.');
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
    void this.confirmClearOrder();
  }

  requestClose(): void {
    void this.confirmClose();
  }

  onDialogCancel(event: Event): void {
    event.preventDefault();
    void this.confirmClose();
  }

  syncDetailsOpen(event: Event): void {
    const target = event.currentTarget;
    if (target instanceof HTMLDetailsElement) {
      this.detailsExpanded.set(target.open);
    }
  }

  kitSlots(line: KitCartLine): KitSlot[] {
    const kit = this.catalog.kits().find((item) => item.id === line.sourceId);
    return kit ? this.buildKitSlots(kit, line.key) : [];
  }

  changeKitSelection(line: KitCartLine, index: number, productId: string): void {
    const ids = [...line.componentProductIds];
    ids[index] = productId;

    if (!this.selectionFitsStock(ids, line.key)) {
      this.toast.error('Não há estoque suficiente para usar essa combinação no kit.');
      return;
    }

    this.cart.update((items) =>
      items.map((item) =>
        item.key === line.key && item.kind === 'kit'
          ? { ...item, componentProductIds: ids }
          : item
      )
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

    if (confirmed) this.resetDraft();
  }

  private async confirmClose(): Promise<void> {
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

    if (confirmed) this.dialog().close();
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

  private buildKitSlots(kit: Kit, excludeLineKey?: string): KitSlot[] {
    const slots: KitSlot[] = [];
    const reserved = this.reservedProductQuantities(excludeLineKey);
    let index = 0;

    for (const component of [...kit.components].sort((a, b) => a.order - b.order)) {
      const candidates = this.matchingProducts(component).filter(
        (product) => product.stock - (reserved.get(product.id) ?? 0) > 0
      );

      const formatName = this.references.formats()
        .find((item) => item.id === component.formatId)?.name ?? 'Item';

      for (let slot = 0; slot < component.quantity; slot++) {
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

  /**
   * Bipartite-capacity matching: O(slots × candidate edges), avoiding exponential
   * backtracking when kits contain dozens or hundreds of units.
   */
  private planKit(kit: Kit): KitAvailability {
    if (this.fulfillmentStatus() === 'in-production') {
      const productIds: string[] = [];
      for (const requirement of [...kit.components].sort((a, b) => a.order - b.order)) {
        const product = this.matchingProducts(requirement)[0];
        if (!product) return { available: false, message: 'Cadastre uma variação deste sabonete', details: [], productIds: [] };
        productIds.push(...Array(requirement.quantity).fill(product.id));
      }
      return { available: true, message: 'Sob encomenda', details: [], productIds };
    }
    const reserved = this.reservedProductQuantities();
    const capacities = new Map(this.catalog.activeProducts().map(product => [
      product.id, Math.max(0, product.stock - (reserved.get(product.id) ?? 0)),
    ]));
    const productIds = allocateKitStock(kit, this.catalog.activeProducts(), 1, reserved);
    if (productIds) return { available: true, message: 'Disponível', details: [], productIds };
    const shortages = [...kit.components].map(component => {
      const count = this.matchingProducts(component).reduce((sum, product) =>
        sum + (capacities.get(product.id) ?? 0), 0);
      return count < component.quantity
        ? (component.quantity - count) + '× ' + this.kitRequirementLabel(component) : '';
    }).filter(Boolean);
    const details = shortages.length ? shortages : ['Estoque insuficiente para combinar os itens do kit.'];
    return { available: false, message: details.slice(0,2).join(' · '), details, productIds: [] };
  }

  /** An allocation group is a commercial requirement (format/collection/fragrance). */
  kitAllocationGroups(line: KitCartLine): Array<{
    index: number; label: string; target: number; allocated: number;
    allocations: Array<{ productId: string; name: string; quantity: number }>;
    candidates: Product[];
  }> {
    const kit = this.catalog.kits().find(item => item.id === line.sourceId);
    if (!kit) return [];
    let cursor = 0;
    return [...kit.components].sort((a, b) => a.order - b.order).map((component, index) => {
      const tally = new Map<string, number>();
      for (const productId of line.componentProductIds.slice(cursor, cursor + component.quantity)) {
        if (productId) tally.set(productId, (tally.get(productId) ?? 0) + 1);
      }
      cursor += component.quantity;
      return {
        index, label: this.kitRequirementLabel(component), target: component.quantity,
        allocated: [...tally.values()].reduce((sum, count) => sum + count, 0),
        allocations: [...tally].map(([productId, quantity]) => ({
          productId, quantity, name: this.catalog.products().find(item => item.id === productId)?.displayName ?? 'Produto',
        })),
        candidates: this.matchingProducts(component).filter(product => !tally.has(product.id)),
      };
    });
  }

  private allocationRange(kit: Kit, index: number): { start: number; length: number } | null {
    const components = [...kit.components].sort((a, b) => a.order - b.order);
    const selected = components[index];
    if (!selected) return null;
    return { start: components.slice(0, index).reduce((sum, item) => sum + item.quantity, 0), length: selected.quantity };
  }

  changeKitGroupQuantity(line: KitCartLine, index: number, productId: string, quantity: number): void {
    const kit = this.catalog.kits().find(item => item.id === line.sourceId);
    if (!kit || !Number.isSafeInteger(quantity) || quantity < 0) return;
    const range = this.allocationRange(kit, index);
    if (!range) return;
    const ids = [...line.componentProductIds];
    const previous = ids.slice(range.start, range.start + range.length);
    const others = previous.filter(id => id && id !== productId);
    if (quantity + others.length > range.length) {
      this.toast.error('O total ultrapassa as unidades previstas para este grupo.');
      return;
    }
    const replacement = [
      ...Array<string>(quantity).fill(productId),
      ...others,
      ...Array<string>(range.length - quantity - others.length).fill(''),
    ];
    ids.splice(range.start, range.length, ...replacement);
    const reserved = this.reservedProductQuantities(line.key);
    const counts = new Map<string, number>();
    ids.forEach(id => { if (id) counts.set(id, (counts.get(id) ?? 0) + 1); });
    for (const [id, count] of counts) {
      if (this.fulfillmentStatus() === 'in-production') continue;
      const candidate = this.catalog.products().find(item => item.id === id);
      const stock = (candidate?.stock ?? 0) - (candidate?.reservedPhysicalStock ?? Math.min(candidate?.stock ?? 0, candidate?.committedStock ?? 0));
      if (count > stock - (reserved.get(id) ?? 0)) {
        this.toast.error('Estoque insuficiente para essa distribuição.');
        return;
      }
    }
    this.cart.update(items => items.map(item => item.key === line.key && item.kind === 'kit'
      ? { ...item, componentProductIds: ids } : item));
  }

  addKitGroupProduct(line: KitCartLine, index: number, productId: string): void {
    if (productId) this.changeKitGroupQuantity(line, index, productId, 1);
  }

  private matchingProducts(component: Kit['components'][number]): Product[] {
    return this.catalog.activeProducts().filter((product) =>
      product.formatId === component.formatId &&
      (!component.collectionId || product.collectionId === component.collectionId) &&
      (!component.fragranceId || product.fragranceId === component.fragranceId)
    );
  }

  private kitRequirementLabel(component: Kit['components'][number]): string {
    const format = this.references.formats().find((item) => item.id === component.formatId)?.name ?? 'Item';
    const fragrance = component.fragranceId
      ? this.references.fragrances().find((item) => item.id === component.fragranceId)?.name
      : undefined;
    const collection = component.collectionId
      ? this.references.collections().find((item) => item.id === component.collectionId)?.name
      : undefined;

    return [format, fragrance ?? collection].filter(Boolean).join(' · ');
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
      } else if (line.kind === 'kit') {
        line.componentProductIds.forEach((productId) => reserve(productId, 1));
      }
    }

    return reserved;
  }

  private availableProductStock(productId: string): number {
    const product = this.catalog.products().find((item) => item.id === productId);
    if (!product) return 0;
    return Math.max(0, product.stock - (product.reservedPhysicalStock ?? Math.min(product.stock, product.committedStock ?? 0)) - (this.reservedProductQuantities().get(productId) ?? 0));
  }

  private selectionFitsStock(productIds: string[], excludeLineKey: string): boolean {
    if (this.fulfillmentStatus() === 'in-production') return true;
    const reserved = this.reservedProductQuantities(excludeLineKey);
    const selected = new Map<string, number>();

    for (const productId of productIds) {
      selected.set(productId, (selected.get(productId) ?? 0) + 1);
    }

    return [...selected].every(([productId, quantity]) => {
      const product = this.catalog.products().find((item) => item.id === productId);
      if (!product) return false;
      return quantity <= Math.max(0, product.stock - (reserved.get(productId) ?? 0));
    });
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
