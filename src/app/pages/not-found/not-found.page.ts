import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'bf-not-found-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<main class="bf-page bf-empty"><div><strong>Página não encontrada</strong><p>O endereço informado não existe.</p><a routerLink="/dashboard">Voltar ao dashboard</a></div></main>`,
})
export class NotFoundPage {}
