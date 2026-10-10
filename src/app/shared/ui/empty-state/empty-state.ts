import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'bf-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bf-empty' },
  template: `
    <div>
      <strong>{{ title() }}</strong>
      <p>{{ description() }}</p>
      <ng-content />
    </div>
  `,
})
export class BfEmptyState {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
}
