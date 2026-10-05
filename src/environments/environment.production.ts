// Public Web config for a SEPARATE Firebase PROD project, once provisioned.
// Placeholders compile but cannot authenticate; never replace them with DEV config.
export const environment = {
  production: true,
  name: 'production',
  googleDrive: {
    enabled: false,
    clientId: 'REPLACE_GOOGLE_DRIVE_CLIENT_ID',
    pickerApiKey: 'REPLACE_GOOGLE_PICKER_API_KEY',
    cloudProjectNumber: 'REPLACE_GOOGLE_CLOUD_PROJECT_NUMBER'
  },
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
