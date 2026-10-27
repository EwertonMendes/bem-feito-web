import { required, productionProject, validateProductionIdentity, assertGoogleApiKey,
  assertGoogleClientId, writeGenerated } from './prod-config.mjs';

export function createFrontendConfig(env) {
  const { projectId, workerOrigin } = validateProductionIdentity(env);
  const number = required(env, 'PROD_FIREBASE_MESSAGING_SENDER_ID');
  const cloudNumber = required(env, 'PROD_GOOGLE_CLOUD_PROJECT_NUMBER');
  if (!/^[0-9]{6,20}$/.test(number) || !/^[0-9]{6,20}$/.test(cloudNumber) ||
    number === '312978463343' || cloudNumber === '312978463343') {
    throw new Error('PROD cloud and Firebase numeric project identities must not be DEV');
  }
  const firebase = {
    apiKey: assertGoogleApiKey(required(env, 'PROD_FIREBASE_API_KEY'), 'PROD_FIREBASE_API_KEY'),
    authDomain: required(env, 'PROD_FIREBASE_AUTH_DOMAIN'),
    projectId,
    storageBucket: required(env, 'PROD_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: number,
    appId: required(env, 'PROD_FIREBASE_APP_ID'),
  };
  if (firebase.authDomain !== projectId + '.firebaseapp.com' ||
      !firebase.storageBucket.startsWith(projectId + '.') ||
      !firebase.appId.startsWith('1:' + number + ':web:')) {
    throw new Error('Firebase PROD web config does not belong to the declared project');
  }
  const config = {
    production: true,
    name: 'production',
    googleDrive: {
      enabled: true,
      workerUrl: workerOrigin,
      clientId: assertGoogleClientId(required(env, 'PROD_GOOGLE_PICKER_CLIENT_ID'), 'PROD_GOOGLE_PICKER_CLIENT_ID'),
      pickerApiKey: assertGoogleApiKey(required(env, 'PROD_GOOGLE_PICKER_API_KEY'), 'PROD_GOOGLE_PICKER_API_KEY'),
      cloudProjectNumber: cloudNumber,
    },
    firebase,
    useEmulators: false,
    emulatorHost: '127.0.0.1',
  };
  const serialized = JSON.stringify(config, null, 2);
  if (serialized.includes('bem-feito-dev') || serialized.includes('312978463343')) {
    throw new Error('DEV identity detected in production config');
  }
  return '// Generated from approved GitHub PROD environment variables; never commit this file.\n' +
    'export const environment = ' + serialized + ' as const;\n';
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/prepare-prod-environment.mjs')) {
  productionProject(process.env);
  writeGenerated('src/environments/environment.production.ts', createFrontendConfig(process.env));
  console.log('Validated production Angular configuration generated without logging public keys.');
}
