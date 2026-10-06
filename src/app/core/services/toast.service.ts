import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly messagesState = signal<ToastMessage[]>([]);
  private nextId = 1;
  readonly messages = this.messagesState.asReadonly();

  success(message: string): void { this.push(message, 'success'); }
  error(message: string): void { this.push(message, 'error'); }
  info(message: string): void { this.push(message, 'info'); }

  dismiss(id: number): void {
    this.messagesState.update((messages) => messages.filter((message) => message.id !== id));
  }

  private push(message: string, kind: ToastMessage['kind']): void {
    const normalized = message.trim();
    if (!normalized) return;
    if (this.messagesState().some((toast) => toast.kind === kind && toast.message === normalized)) return;

    const id = this.nextId++;
    this.messagesState.update((messages) => [
      ...messages.slice(-2),
      { id, message: normalized, kind },
    ]);
    window.setTimeout(() => this.dismiss(id), kind === 'error' ? 5600 : 3800);
  }
}
