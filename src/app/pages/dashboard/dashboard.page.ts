import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardStore } from '../../features/dashboard/dashboard.store';
import { formatCurrency } from '../../core/utils/money';

@Component({
  selector: 'bf-dashboard-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.page.html',
  styleUrl: './dashboard.page.scss',
})
export class DashboardPage {
  readonly store = inject(DashboardStore);
  readonly currency = formatCurrency;
  readonly maxMonth = computed(() => Math.max(1, ...this.store.monthlyRevenue().map((item) => item.valueCents)));

  constructor() {
    void this.store.load();
  }
}
