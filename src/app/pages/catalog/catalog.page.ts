import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CatalogImageEntityKind } from '../../domain/models/image.model';
import { CatalogStore } from '../../features/catalog/catalog.store';
import { formatCurrency } from '../../core/utils/money';
import { CatalogEditor } from '../../features/catalog/components/catalog-editor/catalog-editor';
import { CatalogImage } from '../../shared/media/catalog-image/catalog-image';
import { BfIcon } from '../../shared/ui/icon/icon';

@Component({
  selector: 'bf-catalog-page',
  imports: [BfIcon, CatalogImage, CatalogEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.page.html',
  styleUrl: './catalog.page.scss',
})
export class CatalogPage {
  readonly store = inject(CatalogStore);
  readonly currency = formatCurrency;
  readonly skeletonItems = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly tab = signal<CatalogImageEntityKind>('products');
  readonly search = signal('');

  readonly filteredProducts = computed(() => this.filter(this.store.products(), (item) => item.displayName + ' ' + item.code));
  readonly filteredInputs = computed(() => this.filter(this.store.inputs(), (item) => item.name + ' ' + item.code));
  readonly filteredKits = computed(() => this.filter(this.store.kits(), (item) => item.name));
  readonly filteredAdditions = computed(() => this.filter(this.store.additions(), (item) => item.name + ' ' + item.category));

  constructor() {
    void this.store.load();
  }

  private filter<T>(items: T[], text: (item: T) => string): T[] {
    const term = this.search().trim().toLocaleLowerCase('pt-BR');
    return term ? items.filter((item) => text(item).toLocaleLowerCase('pt-BR').includes(term)) : items;
  }
}
