export const environment = {
  production: false,
  name: 'development',
  firebase: {
    apiKey: 'REPLACE_DEV_API_KEY',
    authDomain: 'REPLACE_DEV_PROJECT_ID.firebaseapp.com',
    projectId: 'REPLACE_DEV_PROJECT_ID',
    storageBucket: 'REPLACE_DEV_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'REPLACE_DEV_MESSAGING_SENDER_ID',
    appId: 'REPLACE_DEV_APP_ID'
  },
  useEmulators: false,
  emulatorHost: '127.0.0.1'
} as const;
