import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { FIREBASE_AUTH } from './core/firebase/firebase.providers';

/**
 * Disposable E2E-only entrypoint. Auth is connected exclusively to the
 * local Firebase emulator by the temporary workflow, never production.
 */
@Component({
  standalone: true,
  selector: 'bf-temporary-e2e-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main style="margin:3rem auto;max-width:400px">
      <h1>Isolated E2E login</h1>
      <button type="button" (click)="login()">Entrar E2E</button>
      @if(error()){<p role="alert">{{error()}}</p>}
    </main>
  `,
})
export class TemporaryE2eLogin {
  private readonly auth = inject(FIREBASE_AUTH);
  private readonly router = inject(Router);
  readonly error = signal('');

  async login(): Promise<void> {
    try {
      await signInWithEmailAndPassword(this.auth, 'qa-e2e@example.test', 'LocalEmulatorPass123!');
      await this.router.navigateByUrl('/estoque');
    } catch (error) {
      this.error.set(String(error));
    }
  }
}
