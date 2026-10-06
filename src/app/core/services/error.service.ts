import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ErrorService {
  message(error: unknown): string {
    const code = this.code(error);
    const raw = error instanceof Error ? error.message.trim() : '';

    if (code === 'permission-denied') return 'Você não tem permissão para concluir esta operação.';
    if (code === 'unauthenticated') return 'Sua sessão expirou. Entre novamente para continuar.';
    if (code === 'failed-precondition' && /requires an index|query requires an index/i.test(raw)) {
      return 'Os dados ainda estão sendo preparados. Tente novamente em instantes.';
    }
    if (code === 'unavailable' || code === 'deadline-exceeded') {
      return 'O serviço está temporariamente indisponível. Tente novamente em instantes.';
    }
    if (code === 'resource-exhausted') {
      return 'O Firebase atingiu um limite temporário. Tente novamente mais tarde.';
    }

    if (!code && raw) return raw;
    return 'Não foi possível concluir a operação.';
  }

  private code(error: unknown): string {
    if (typeof error !== 'object' || !error || !('code' in error)) return '';
    const value = String((error as { code?: unknown }).code ?? '').toLowerCase();
    return value.replace(/^firestore\//, '');
  }
}
