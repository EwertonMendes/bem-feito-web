import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, output, signal, viewChild } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';

export type BfNumberInputKind = 'currency' | 'decimal' | 'integer';

@Component({
  selector: 'bf-number-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './number-input.html',
  styleUrl: './number-input.scss',
})
export class BfNumberInput implements FormValueControl<number> {
  private readonly native = viewChild.required<ElementRef<HTMLInputElement>>('native');

  readonly value = model(0);
  readonly kind = input<BfNumberInputKind>('decimal');
  readonly decimals = input<number | null>(null);
  readonly min = input<number | null>(null);
  readonly max = input<number | null>(null);
  readonly suffix = input('');
  readonly placeholder = input('');
  readonly ariaLabel = input('Valor');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();

  readonly editing = signal(false);
  readonly draft = signal('');

  readonly displayValue = computed(() =>
    this.editing() ? this.draft() : this.format(this.value())
  );

  readonly inputMode = computed(() => this.kind() === 'integer' ? 'numeric' : 'decimal');

  focus(options?: FocusOptions): void {
    this.native().nativeElement.focus(options);
  }

  onFocus(): void {
    this.editing.set(true);
    this.draft.set(this.formatEditable(this.value()));
    queueMicrotask(() => this.native().nativeElement.select());
  }

  onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.draft.set(raw);
    const parsed = this.parse(raw);
    if (parsed !== null) this.value.set(this.normalize(parsed, false));
  }

  onBlur(): void {
    const parsed = this.parse(this.draft());
    if (parsed !== null) this.value.set(this.normalize(parsed, true));
    this.editing.set(false);
    this.draft.set('');
    this.touch.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.native().nativeElement.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.editing.set(false);
      this.draft.set('');
      this.native().nativeElement.blur();
    }
  }

  private fractionDigits(): number {
    if (this.kind() === 'currency') return 2;
    if (this.kind() === 'integer') return 0;
    return Math.max(0, Math.min(6, this.decimals() ?? 3));
  }

  private format(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    const digits = this.fractionDigits();
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: this.kind() === 'currency' ? 2 : 0,
      maximumFractionDigits: digits,
    }).format(safe);
  }

  private formatEditable(value: number): string {
    const safe = Number.isFinite(value) ? value : 0;
    const digits = this.fractionDigits();
    const rounded = this.round(safe, digits);
    if (this.kind() === 'currency') return rounded.toFixed(2).replace('.', ',');
    return String(rounded).replace('.', ',');
  }

  private parse(raw: string): number | null {
    const cleaned = raw.trim().replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === ',' || cleaned === '.') return null;

    const comma = cleaned.lastIndexOf(',');
    const dot = cleaned.lastIndexOf('.');
    const decimalIndex = Math.max(comma, dot);

    let normalized = cleaned;
    if (decimalIndex >= 0) {
      const integerPart = cleaned.slice(0, decimalIndex).replace(/[.,]/g, '');
      const decimalPart = cleaned.slice(decimalIndex + 1).replace(/[.,]/g, '');
      normalized = integerPart + (decimalPart ? '.' + decimalPart : '');
    } else {
      normalized = cleaned.replace(/[.,]/g, '');
    }

    const sign = cleaned.startsWith('-') ? -1 : 1;
    normalized = normalized.replace(/-/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed * sign : null;
  }

  private normalize(value: number, clamp: boolean): number {
    const digits = this.fractionDigits();
    let next = this.kind() === 'integer' ? Math.round(value) : this.round(value, digits);
    if (clamp) {
      const min = this.min();
      const max = this.max();
      if (min !== null && Number.isFinite(min)) next = Math.max(min, next);
      if (max !== null && Number.isFinite(max)) next = Math.min(max, next);
    }
    return next;
  }

  private round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }
}
