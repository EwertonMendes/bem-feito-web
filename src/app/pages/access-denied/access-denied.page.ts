import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'bf-access-denied-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="state">
      <img src="/brand-mark.svg" alt="" />
      <h1>Acesso ainda não liberado</h1>
      <p>Sua conta Google foi reconhecida, mas não existe um usuário ativo correspondente no Firestore.</p>
      <p class="email">{{ auth.user()?.email }}</p>
      <button class="bf-button" type="button" (click)="auth.logout()">Usar outra conta</button>
    </main>
  `,
  styles: [`.state{min-height:100dvh;display:grid;place-items:center;align-content:center;gap:14px;text-align:center;padding:24px}.state img{width:58px}.state h1{margin:12px 0 0;letter-spacing:-.04em}.state p{max-width:560px;margin:0;color:var(--muted);line-height:1.5}.email{font-weight:800;color:var(--text)!important}.state button{margin-top:10px}`],
})
export class AccessDeniedPage {
  readonly auth = inject(AuthService);
}
