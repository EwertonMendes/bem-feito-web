import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { BfIcon, BfIconName } from '../icon/icon';

export interface BfSelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: BfIconName;
  imageSrc?: string;
  imageAlt?: string;
  disabled?: boolean;
}

let selectSequence = 0;

@Component({
  selector: 'bf-select',
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './select.html',
  styleUrl: './select.scss',
})
export class BfSelect implements FormValueControl<string> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  private viewportListenersBound = false;

  readonly value = model('');
  readonly options = input<readonly BfSelectOption[]>([]);
  readonly placeholder = input('Selecione');
  readonly ariaLabel = input('Selecionar opção');
  readonly disabled = input(false);
  readonly required = input(false);
  readonly invalid = input(false);
  readonly compact = input(false);
  readonly descriptive = input(false);
  readonly touch = output<void>();

  readonly open = signal(false);
  readonly activeIndex = signal(-1);
  readonly selectedOption = computed(() => this.options().find((option) => option.value === this.value()));
  readonly selectId = `bf-select-${++selectSequence}`;
  readonly listboxId = `${this.selectId}-listbox`;

  constructor() {
    this.destroyRef.onDestroy(() => this.unbindViewportListeners());
  }

  focus(options?: FocusOptions): void {
    this.trigger().nativeElement.focus(options);
  }

  toggle(): void {
    if (this.open()) this.close();
    else this.openMenu();
  }

  openMenu(): void {
    if (this.disabled() || this.open()) return;
    const options = this.options();
    const selectedIndex = options.findIndex((option) => option.value === this.value() && !option.disabled);
    this.activeIndex.set(selectedIndex >= 0 ? selectedIndex : this.firstEnabledIndex());
    this.open.set(true);

    const menu = this.menu().nativeElement;
    if (!menu.matches(':popover-open')) menu.showPopover();
    this.bindViewportListeners();
    requestAnimationFrame(() => this.positionMenu());
  }

  close(restoreFocus = false): void {
    if (!this.open()) return;
    this.open.set(false);
    const menu = this.menu().nativeElement;
    if (menu.matches(':popover-open')) menu.hidePopover();
    this.unbindViewportListeners();
    if (restoreFocus) queueMicrotask(() => this.focus({ preventScroll: true }));
  }

  select(option: BfSelectOption, index: number): void {
    if (option.disabled || this.disabled()) return;
    this.value.set(option.value);
    this.activeIndex.set(index);
    this.close(true);
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (this.disabled()) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!this.open()) this.openMenu();
      else this.moveActive(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!this.open()) this.openMenu();
      else this.moveActive(-1);
      return;
    }

    if (event.key === 'Home' && this.open()) {
      event.preventDefault();
      this.activeIndex.set(this.firstEnabledIndex());
      this.scrollActiveIntoView();
      return;
    }

    if (event.key === 'End' && this.open()) {
      event.preventDefault();
      this.activeIndex.set(this.lastEnabledIndex());
      this.scrollActiveIntoView();
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && this.open()) {
      event.preventDefault();
      const index = this.activeIndex();
      const option = this.options()[index];
      if (option) this.select(option, index);
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && !this.open()) {
      event.preventDefault();
      this.openMenu();
      return;
    }

    if (event.key === 'Escape' && this.open()) {
      event.preventDefault();
      this.close(true);
      return;
    }

    if (event.key === 'Tab' && this.open()) this.close();
  }

  onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) return;
    this.touch.emit();
    this.close();
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.open()) return;
    const target = event.target;
    if (target instanceof Node && !this.host.nativeElement.contains(target)) this.close();
  }

  private moveActive(delta: 1 | -1): void {
    const options = this.options();
    if (!options.length) return;

    let index = this.activeIndex();
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      index = (index + delta + options.length) % options.length;
      if (!options[index]?.disabled) {
        this.activeIndex.set(index);
        this.scrollActiveIntoView();
        return;
      }
    }
  }

  private firstEnabledIndex(): number {
    return this.options().findIndex((option) => !option.disabled);
  }

  private lastEnabledIndex(): number {
    const options = this.options();
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index]?.disabled) return index;
    }
    return -1;
  }

  private scrollActiveIntoView(): void {
    requestAnimationFrame(() => {
      const active = this.menu().nativeElement.querySelector<HTMLElement>('[data-active="true"]');
      active?.scrollIntoView({ block: 'nearest' });
    });
  }

  private bindViewportListeners(): void {
    if (this.viewportListenersBound) return;
    window.addEventListener('resize', this.onViewportChange, { passive: true });
    window.addEventListener('scroll', this.onViewportChange, { passive: true, capture: true });
    this.viewportListenersBound = true;
  }

  private unbindViewportListeners(): void {
    if (!this.viewportListenersBound) return;
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('scroll', this.onViewportChange, true);
    this.viewportListenersBound = false;
  }

  private readonly onViewportChange = (): void => {
    if (this.open()) this.positionMenu();
  };

  private positionMenu(): void {
    if (!this.open()) return;

    const triggerRect = this.trigger().nativeElement.getBoundingClientRect();
    const menu = this.menu().nativeElement;
    const viewportMargin = 12;
    const gap = 7;
    const maxMenuHeight = 320;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(triggerRect.width, 210), viewportWidth - viewportMargin * 2);

    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(maxMenuHeight, viewportHeight - viewportMargin * 2))}px`;

    const measuredHeight = Math.min(menu.scrollHeight, maxMenuHeight);
    const spaceBelow = viewportHeight - triggerRect.bottom - viewportMargin - gap;
    const spaceAbove = triggerRect.top - viewportMargin - gap;
    const openAbove = spaceBelow < Math.min(measuredHeight, 210) && spaceAbove > spaceBelow;
    const availableHeight = Math.max(120, openAbove ? spaceAbove : spaceBelow);
    const finalHeight = Math.min(measuredHeight, maxMenuHeight, availableHeight);
    const top = openAbove
      ? Math.max(viewportMargin, triggerRect.top - gap - finalHeight)
      : Math.min(triggerRect.bottom + gap, viewportHeight - viewportMargin - finalHeight);
    const left = Math.min(
      Math.max(viewportMargin, triggerRect.left),
      Math.max(viewportMargin, viewportWidth - viewportMargin - width),
    );

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.maxHeight = `${finalHeight}px`;
  }
}
