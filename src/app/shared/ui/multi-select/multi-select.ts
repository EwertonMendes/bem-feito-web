import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { BfCheckbox } from '../checkbox/checkbox';
import { BfIcon } from '../icon/icon';
import { BfSelectOption } from '../select/select';

let nextId = 0;

/** Inline, accessible multiselect: the same controls for fragrance and format. */
@Component({
  selector: 'bf-multi-select',
  imports: [BfCheckbox, BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './multi-select.html',
  styleUrl: './multi-select.scss',
})
export class BfMultiSelect {
  readonly options = input<readonly BfSelectOption[]>([]);
  readonly value = model<string[]>([]);
  readonly label = input.required<string>();
  readonly placeholder = input('Selecione uma ou mais opções');
  readonly expanded = signal(false);
  readonly search = signal('');
  readonly controlId = 'bf-multi-' + (++nextId);
  readonly selectedNames = computed(() => {
    const ids = new Set(this.value());
    return this.options().filter(option => ids.has(option.value)).map(option => option.label);
  });
  readonly filtered = computed(() => {
    const term = normalize(this.search());
    return this.options().filter(option => !term || normalize(option.label).includes(term));
  });
  readonly selectable = computed(() => this.filtered().filter(option => !option.disabled));
  readonly allVisibleSelected = computed(() => this.selectable().length > 0 && this.selectable().every(option => this.value().includes(option.value)));

  toggle(value: string, selected: boolean): void {
    this.value.update(previous => selected
      ? [...new Set([...previous, value])]
      : previous.filter(id => id !== value));
  }

  selectVisible(): void {
    const ids = this.selectable().map(item => item.value);
    this.value.update(previous => [...new Set([...previous, ...ids])]);
  }

  clear(): void {
    this.value.set([]);
  }
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}
