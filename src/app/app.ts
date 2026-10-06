import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainer } from './shared/feedback/toast-container';

@Component({
  selector: 'bf-root',
  imports: [RouterOutlet, ToastContainer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet /><bf-toast-container />',
})
export class App {}
