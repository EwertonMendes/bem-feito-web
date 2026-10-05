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
    const id = this.nextId++;
    this.messagesState.update((messages) => [...messages, { id, message, kind }]);
    window.setTimeout(() => this.dismiss(id), 3800);
  }
}
