import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardStore } from '../../features/dashboard/dashboard.store';
import { formatCurrency } from '../../core/utils/money';
import { BfIcon } from '../../shared/ui/icon/icon';

@Component({
  selector: 'bf-dashboard-page',
  imports: [RouterLink, BfIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  readonly store = inject(DashboardStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly currency = formatCurrency;

  readonly chartCeiling = computed(() => {
    const max = Math.max(0, ...this.store.monthlyRevenue().map((item) => item.valueCents));
    if (!max) return 10000;
    return Math.max(5000, Math.ceil((max * 1.15) / 5000) * 5000);
  });

  readonly chartLabels = computed(() => {
    const max = this.chartCeiling();
    return [max, Math.round(max * 0.75), Math.round(max * 0.5), Math.round(max * 0.25), 0];
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.store.deactivate());
    void this.store.load();
  }

  chartAmount(cents: number): string {
    return 'R$ ' + Math.round(cents / 100).toLocaleString('pt-BR');
  }
}
