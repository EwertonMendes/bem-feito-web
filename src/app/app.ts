import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavigationLoadingService } from './core/state/navigation-loading.service';
import { BrandLoader } from './shared/feedback/brand-loader/brand-loader';
import { ToastContainer } from './shared/feedback/toast-container';

@Component({
  selector: 'bf-root',
  imports: [RouterOutlet, BrandLoader, ToastContainer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    @if (navigation.bootVisible()) {
      <bf-brand-loader [leaving]="navigation.bootLeaving()" />
    }
    <bf-toast-container />
  `,
})
export class App {
  readonly navigation = inject(NavigationLoadingService);
}
