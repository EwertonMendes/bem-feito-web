import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BfIcon } from '../icon/icon';
import { NgTemplateOutlet } from '@angular/common';
import { BfSelect } from '../select/select';

/**
 * Variante pesquisável do select padrão.
 * Herda seleção, FormValueControl, posicionamento, acessibilidade e aparência.
 */
@Component({
  selector: 'bf-select-search',
  imports: [BfIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: '../select/select.html',
  styleUrl: '../select/select.scss',
})
export class BfSelectSearch extends BfSelect {
  override readonly searchable: boolean = true;
}
