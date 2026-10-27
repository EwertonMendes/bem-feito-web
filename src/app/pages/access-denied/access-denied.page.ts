import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'bf-access-denied-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="state">
      <img src="/brand-mark.svg" alt="" />
      <h1>Acesso ainda não liberado</h1>
      @if(auth.profileErrorCode(); as code) {
        <p role="alert">A consulta ao Firestore falhou: {{code}}. Seu cadastro não foi alterado.</p>
      } @else {
        <p>Ainda não foi possível validar o perfil deste UID no servidor. Sua conta não foi alterada.</p>
      }
      <p class="email">{{ auth.user()?.email }}</p>
      <button class="bf-button" type="button" [disabled]="verifying()" (click)="retry()">{{verifying()?'Verificando...':'Verificar acesso novamente'}}</button>
      @if (error()) { <p role="alert">{{error()}}</p> }
      <button class="bf-button secondary" type="button" (click)="auth.logout()">Usar outra conta</button>
    </main>
  `,
  styles: [`.state{min-height:100dvh;display:grid;place-items:center;align-content:center;gap:14px;text-align:center;padding:24px}.state img{width:58px}.state h1{margin:12px 0 0;letter-spacing:-.04em}.state p{max-width:560px;margin:0;color:var(--muted);line-height:1.5}.email{font-weight:800;color:var(--text)!important}.state button{margin-top:10px}`],
})
export class AccessDeniedPage {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly verifying = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    // If the server later validates a profile, leave the denied page without
    // making the user sign out or reauthenticate.
    effect(() => {
      const user = this.auth.user();
      const profile = this.auth.profile();
      if (user && profile?.id === user.uid && profile.active) {
        void this.router.navigateByUrl('/dashboard');
      }
    });
  }

  async retry(): Promise<void> {
    if (this.verifying()) return;
    this.verifying.set(true);
    this.error.set(null);
    try {
      const profile = await this.auth.retryProfile();
      if (profile?.active && ['owner','operator','viewer'].includes(profile.role)) {
        await this.router.navigateByUrl('/dashboard');
      } else {
        this.error.set('O servidor não retornou um perfil ativo para o UID autenticado.');
      }
    } catch {
      this.error.set(this.auth.error() || 'Não foi possível confirmar o perfil diretamente no Firestore.');
    } finally {
      this.verifying.set(false);
    }
  }
}
