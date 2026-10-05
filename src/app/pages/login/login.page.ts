import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'bf-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="login">
      <section class="card">
        <img src="/brand-mark.svg" alt="" />
        <div>
          <span class="eyebrow">Bem Feito</span>
          <h1>Gestão simples, bonita e confiável.</h1>
          <p>Vendas, produção, estoque e financeiro em um único lugar.</p>
        </div>
        <button type="button" class="google" (click)="auth.loginWithGoogle()" [disabled]="auth.busy()">
          <span>G</span>{{ auth.busy() ? 'Entrando…' : 'Entrar com Google' }}
        </button>
        @if (auth.error()) { <p class="error">{{ auth.error() }}</p> }
        <small>O acesso é liberado apenas para usuários cadastrados pela Bem Feito.</small>
      </section>
    </main>
  `,
  styles: [`
    .login{min-height:100dvh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 15% 10%,var(--accent-soft),transparent 34%),radial-gradient(circle at 85% 90%,var(--brand-soft),transparent 36%),var(--bg)}
    .card{width:min(470px,100%);display:grid;gap:26px;padding:38px;border:1px solid var(--line);border-radius:28px;background:color-mix(in srgb,var(--surface) 94%,transparent);box-shadow:var(--shadow)}
    img{width:58px;height:58px}.eyebrow{color:var(--brand);font-weight:850;letter-spacing:.04em;text-transform:uppercase;font-size:.75rem}
    h1{font-size:clamp(2rem,5vw,3rem);letter-spacing:-.055em;line-height:1;margin:10px 0 14px}p{color:var(--muted);line-height:1.6;margin:0}
    .google{min-height:52px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--text);font-weight:800;display:flex;gap:12px;align-items:center;justify-content:center}
    .google span{width:28px;height:28px;display:grid;place-items:center;border-radius:50%;background:#fff;color:#3567c8;font-weight:900}.error{color:var(--danger);font-weight:700}small{color:var(--muted);text-align:center}
  `],
})
export class LoginPage {
  readonly auth = inject(AuthService);
}
