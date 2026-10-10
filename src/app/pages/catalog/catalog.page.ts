import { ActivatedRoute } from '@angular/router';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CatalogImageEntityKind } from '../../domain/models/image.model';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { ModalActions } from '../../core/services/modal-actions.service';
import { availableKitCount } from '../../domain/logic/kit-stock';
import { BfButton } from '../../shared/ui/button/button';
import { formatCurrency } from '../../core/utils/money';
import { CatalogEditor } from '../../features/catalog/components/catalog-editor/catalog-editor';
import { CatalogImage } from '../../shared/media/catalog-image/catalog-image';
import { BfIcon } from '../../shared/ui/icon/icon';
import { BfEmptyState } from '../../shared/ui/empty-state/empty-state';
import { BfPageRefresh } from '../../shared/feedback/page-refresh/page-refresh';

@Component({
  selector: 'bf-catalog-page',
  imports: [BfButton, BfIcon, CatalogImage, CatalogEditor, BfEmptyState, BfPageRefresh],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.page.html',
  styleUrl: './catalog.page.scss',
})
export class CatalogPage {
  readonly store = inject(CatalogStore);
  readonly modals = inject(ModalActions);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  readonly currency = formatCurrency;
  readonly skeletonItems = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly tab = signal<CatalogImageEntityKind>('products');
  readonly search = signal('');

  readonly kitStock = computed(() => new Map(this.store.kits().map(kit => [kit.id, availableKitCount(kit, this.store.activeProducts())])));
  kitAvailable(id: string): number { return this.kitStock().get(id) ?? 0; }
  readonly filteredProducts = computed(() => this.filter(this.store.products(), (item) => item.displayName + ' ' + item.code));
  readonly filteredInputs = computed(() => this.filter(this.store.inputs(), (item) => item.name + ' ' + item.code));
  readonly filteredKits = computed(() => this.filter(this.store.kits(), (item) => item.name));
  readonly filteredAdditions = computed(() => this.filter(this.store.additions(), (item) => item.name + ' ' + item.category));

  constructor() {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab === 'inputs' || tab === 'kits' || tab === 'additions' || tab === 'products') this.tab.set(tab);
    this.destroyRef.onDestroy(this.store.activate());
    void this.store.load();
  }

  private filter<T>(items: T[], text: (item: T) => string): T[] {
    const term = this.search().trim().toLocaleLowerCase('pt-BR');
    return term ? items.filter((item) => text(item).toLocaleLowerCase('pt-BR').includes(term)) : items;
  }
}
