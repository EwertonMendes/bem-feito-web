import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ErrorService {
  message(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return 'Não foi possível concluir a operação.';
  }
}
