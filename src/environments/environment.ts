export const environment = {
  production: false,
  name: 'development',
  catalogImagesEnabled: false,
  firebase: {
    apiKey: 'CONFIGURE_WITH_FIREBASE_DEV_API_KEY',
    authDomain: 'bem-feito-dev.firebaseapp.com',
    projectId: 'bem-feito-dev',
    storageBucket: 'bem-feito-dev.firebasestorage.app',
    messagingSenderId: '312978463343',
    appId: '1:312978463343:web:e49e223d872b9c68374b9a'
  },
  useEmulators: false,
  emulatorHost: '127.0.0.1'
} as const;
