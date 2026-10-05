import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, connectAuthEmulator, getAuth } from 'firebase/auth';
import { Firestore, connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';
import { FirebaseStorage, connectStorageEmulator, getStorage } from 'firebase/storage';
import { environment } from '../../../environments/environment';

export const FIREBASE_APP = new InjectionToken<FirebaseApp>('FIREBASE_APP');
export const FIREBASE_AUTH = new InjectionToken<Auth>('FIREBASE_AUTH');
export const FIRESTORE = new InjectionToken<Firestore>('FIRESTORE');
export const FIREBASE_STORAGE = new InjectionToken<FirebaseStorage>('FIREBASE_STORAGE');

export function provideFirebase(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: FIREBASE_APP,
      useFactory: () => initializeApp(environment.firebase),
    },
    {
      provide: FIREBASE_AUTH,
      deps: [FIREBASE_APP],
      useFactory: (app: FirebaseApp) => {
        const auth = getAuth(app);
        if (environment.useEmulators) {
          try { connectAuthEmulator(auth, `http://${environment.emulatorHost}:9099`, { disableWarnings: true }); } catch {}
        }
        return auth;
      },
    },
    {
      provide: FIRESTORE,
      deps: [FIREBASE_APP],
      useFactory: (app: FirebaseApp) => {
        const firestore = initializeFirestore(app, { ignoreUndefinedProperties: true });
        if (environment.useEmulators) {
          try { connectFirestoreEmulator(firestore, environment.emulatorHost, 8080); } catch {}
        }
        return firestore;
      },
    },
    {
      provide: FIREBASE_STORAGE,
      deps: [FIREBASE_APP],
      useFactory: (app: FirebaseApp) => {
        const storage = getStorage(app);
        if (environment.useEmulators) {
          try { connectStorageEmulator(storage, environment.emulatorHost, 9199); } catch {}
        }
        return storage;
      },
    },
  ]);
}
