import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BfIconName =
  | 'dashboard' | 'sales' | 'production' | 'inventory' | 'finance' | 'catalog' | 'settings'
  | 'plus' | 'search' | 'sun' | 'moon' | 'logout' | 'close' | 'trash' | 'image';

@Component({
  selector: 'bf-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('dashboard') { <path d="M4 13h6V4H4v9Zm10 7h6v-9h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z"/> }
        @case ('sales') { <path d="M4 6h16l-1.5 9h-12L4 3H2"/><circle cx="8" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/> }
        @case ('production') { <path d="M4 19V9l8-4 8 4v10"/><path d="m8 11 4 2 4-2M8 15l4 2 4-2M12 13v4"/> }
        @case ('inventory') { <path d="M4 7h16v13H4zM7 4h10l1 3H6l1-3Z"/><path d="M9 11h6"/> }
        @case ('finance') { <circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.8-.6-1.8-.9-3-.9-1.8 0-3 .8-3 2 0 3 6 1.3 6 4.2 0 1.2-1.2 2.2-3.2 2.2-1.2 0-2.4-.4-3.3-1.1M12 6v12"/> }
        @case ('catalog') { <path d="M4 5h16v14H4z"/><path d="m4 9 8 4 8-4M12 13v6"/> }
        @case ('settings') { <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/> }
        @case ('plus') { <path d="M12 5v14M5 12h14"/> }
        @case ('search') { <circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/> }
        @case ('sun') { <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/> }
        @case ('moon') { <path d="M20 15.8A8 8 0 1 1 8.2 4 6.5 6.5 0 0 0 20 15.8Z"/> }
        @case ('logout') { <path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/> }
        @case ('close') { <path d="m6 6 12 12M18 6 6 18"/> }
        @case ('trash') { <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/> }
        @case ('image') { <rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 15-4.5-4.5L8 19"/> }
      }
    </svg>
  `,
  styles: [':host{display:inline-flex;width:20px;height:20px}:host svg{width:100%;height:100%}'],
})
export class BfIcon {
  readonly name = input.required<BfIconName>();
}
