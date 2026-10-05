export const environment = {
  production: true,
  name: 'production',
  catalogImagesEnabled: false,
  firebase: {
    apiKey: 'REPLACE_PROD_API_KEY',
    authDomain: 'REPLACE_PROD_PROJECT_ID.firebaseapp.com',
    projectId: 'REPLACE_PROD_PROJECT_ID',
    storageBucket: 'REPLACE_PROD_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'REPLACE_PROD_MESSAGING_SENDER_ID',
    appId: 'REPLACE_PROD_APP_ID'
  },
  useEmulators: false,
  emulatorHost: '127.0.0.1'
} as const;
