import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ExternalScriptLoaderService {
  private readonly loads = new Map<string, Promise<void>>();

  load(id: string, src: string): Promise<void> {
    const existing = this.loads.get(id);
    if (existing) return existing;

    const promise = new Promise<void>((resolve, reject) => {
      const current = document.getElementById(id) as HTMLScriptElement | null;
      if (current?.dataset['loaded'] === 'true') {
        resolve();
        return;
      }

      const script = current ?? document.createElement('script');
      script.id = id;
      script.src = src;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', () => {
        script.dataset['loaded'] = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error('Não foi possível carregar a integração do Google.')), { once: true });
      if (!current) document.head.appendChild(script);
    });

    this.loads.set(id, promise);
    promise.catch(() => this.loads.delete(id));
    return promise;
  }
}
