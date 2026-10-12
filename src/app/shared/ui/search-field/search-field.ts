import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { BfIcon } from '../icon/icon';

/** Reusable controlled text search with a single focus halo and one accessible clear action. */
@Component({
  selector: 'bf-search-field',
  standalone: true,
  imports: [BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="search-shell">
      <bf-icon name="search" />
      <input #searchInput type="text" inputmode="search" autocomplete="off" spellcheck="false"
        [value]="value()" [placeholder]="placeholder()" [attr.aria-label]="ariaLabel()"
        (input)="valueChange.emit(searchInput.value)" />
      @if (value()) {
        <button type="button" (click)="clear()" [attr.aria-label]="'Limpar '+ariaLabel()" title="Limpar pesquisa">
          <bf-icon name="close" />
        </button>
      }
    </div>
  `,
  styles: [`
    :host {display:block;min-width:0}
    .search-shell {
      display:flex;align-items:center;gap:9px;min-height:45px;width:100%;min-width:0;
      padding:0 11px;border:1px solid var(--line);border-radius:13px;
      background:var(--surface);color:var(--text);
      transition:border-color 160ms ease,box-shadow 160ms ease,background 160ms ease;
    }
    .search-shell:hover {border-color:color-mix(in srgb,var(--brand) 28%,var(--line))}
    .search-shell:focus-within {
      border-color:color-mix(in srgb,var(--brand) 56%,var(--line));
      box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 12%,transparent);
      background:var(--surface-elevated);
    }
    .search-shell>bf-icon {display:inline-flex;flex:0 0 17px;width:17px;color:var(--muted)}
    input {
      appearance:none;-webkit-appearance:none;display:block;min-width:0;flex:1;
      border:0!important;outline:none!important;box-shadow:none!important;
      padding:0!important;margin:0!important;border-radius:0!important;background:transparent!important;
      font:inherit;font-size:.83rem;color:var(--text);height:40px;
    }
    input:focus,input:focus-visible {border:0!important;outline:none!important;box-shadow:none!important;background:transparent!important}
    input::placeholder {color:var(--muted);opacity:1}
    button {display:grid;place-items:center;flex:0 0 28px;width:28px;height:28px;
      border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}
    button:hover {background:var(--surface-2);color:var(--text)}
    button:focus-visible {outline:2px solid var(--brand);outline-offset:1px}
    button bf-icon{display:inline-flex;width:16px}
    @media(prefers-reduced-motion:reduce){.search-shell{transition:none}}
  `],
})
export class BfSearchField {
  readonly value = input('');
  readonly placeholder = input('Buscar');
  readonly ariaLabel = input('Pesquisar');
  readonly valueChange = output<string>();
  private readonly textField = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  clear(): void {
    this.valueChange.emit('');
    this.textField()?.nativeElement.focus();
  }
}
