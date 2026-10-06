import { describe, expect, it } from 'vitest';
import { ErrorService } from './error.service';

describe('ErrorService', () => {
  const service = new ErrorService();

  it('keeps domain validation messages intact', () => {
    expect(service.message(new Error('Informe a data.'))).toBe('Informe a data.');
  });

  it('does not expose Firestore index creation URLs', () => {
    const error = Object.assign(
      new Error('The query requires an index. You can create it here: https://console.firebase.google.com/example'),
      { code: 'failed-precondition' },
    );

    const message = service.message(error);
    expect(message).toBe('Os dados ainda estão sendo preparados. Tente novamente em instantes.');
    expect(message).not.toContain('http');
  });

  it('translates permission failures without leaking Firebase internals', () => {
    const error = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    expect(service.message(error)).toBe('Você não tem permissão para concluir esta operação.');
  });
});
