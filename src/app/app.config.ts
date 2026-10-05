import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { provideFirebase } from './core/firebase/firebase.providers';
import { GoogleDriveImageStorageService } from './core/google-drive/google-drive-image-storage.service';
import { ImageStoragePort } from './core/images/image-storage.port';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withViewTransitions()
    ),
    provideFirebase(),
    { provide: ImageStoragePort, useExisting: GoogleDriveImageStorageService },
  ],
};
