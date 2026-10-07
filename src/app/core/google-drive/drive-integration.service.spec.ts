import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<typeof import('@angular/core')>('@angular/core');
  return { ...actual, effect: vi.fn() };
});
import { AuthService } from '../auth/auth.service';
import { DriveIntegrationRepository } from '../repositories/drive-integration.repository';
import { DriveApiService } from './drive-api.service';
import { DriveAuthService } from './drive-auth.service';
import { DriveIntegrationService } from './drive-integration.service';
import { DrivePickerService } from './drive-picker.service';

const config = {
  id: 'google-drive',
  enabled: true,
  rootFolderId: 'root',
  rootFolderName: 'Bem Feito DEV - Imagens',
  folders: {
    products: 'products',
    inputs: 'inputs',
    kits: 'kits',
    additions: 'additions',
  },
};

describe('DriveIntegrationService', () => {
  it('does not let passive image authorization requests invalidate a connection in progress', async () => {
    const linked = signal(true);
    const tokenActive = signal(false);
    const revision = signal(0);
    const accountEmail = signal<string | null>('user@example.com');

    let releaseConnect!: () => void;
    const driveAuth = {
      linked,
      connected: tokenActive,
      revision,
      accountEmail,
      currentToken: vi.fn(() => tokenActive() ? 'token' : null),
      connect: vi.fn(() => new Promise<string>((resolve) => {
        releaseConnect = () => {
          tokenActive.set(true);
          resolve('token');
        };
      })),
      expireAccessToken: vi.fn(() => tokenActive.set(false)),
      setAccountEmail: vi.fn(),
      disconnect: vi.fn(),
    };

    const repository = {
      getConfig: vi.fn().mockResolvedValue(config),
      saveConfig: vi.fn(),
    };

    const driveApi = {
      currentUser: vi.fn().mockResolvedValue({ emailAddress: 'user@example.com' }),
      getFile: vi.fn().mockImplementation(async (id: string) => ({
        id,
        name: id,
        mimeType: 'application/vnd.google-apps.folder',
        trashed: false,
      })),
    };

    const auth = {
      waitForUser: vi.fn().mockResolvedValue({ uid: 'user-1', email: 'user@example.com' }),
      canAdminister: vi.fn(() => true),
    };

    const picker = { selectFolder: vi.fn() };

    const injector = Injector.create({
      providers: [
        { provide: DriveIntegrationRepository, useValue: repository },
        { provide: DriveAuthService, useValue: driveAuth },
        { provide: DriveApiService, useValue: driveApi },
        { provide: DrivePickerService, useValue: picker },
        { provide: AuthService, useValue: auth },
      ],
    });

    const service = runInInjectionContext(injector, () => new DriveIntegrationService());

    await service.load();
    expect(service.status()).toBe('ready');

    const connecting = service.connect();
    expect(service.connecting()).toBe(true);

    service.requestAuthorization();
    service.requestAuthorization();
    service.requestAuthorization();

    expect(driveAuth.expireAccessToken).not.toHaveBeenCalled();

    releaseConnect();
    await connecting;

    expect(service.connected()).toBe(true);
    expect(service.status()).toBe('connected');
    expect(service.authorizationNeeded()).toBe(false);
    expect(driveAuth.expireAccessToken).not.toHaveBeenCalled();

    injector.destroy();
  });

  it('expires the token only after a real unauthorized response is reported', async () => {
    const linked = signal(true);
    const tokenActive = signal(true);
    const revision = signal(0);
    const accountEmail = signal<string | null>('user@example.com');

    const driveAuth = {
      linked,
      connected: tokenActive,
      revision,
      accountEmail,
      currentToken: vi.fn(() => tokenActive() ? 'token' : null),
      connect: vi.fn(),
      expireAccessToken: vi.fn(() => tokenActive.set(false)),
      setAccountEmail: vi.fn(),
      disconnect: vi.fn(),
    };

    const injector = Injector.create({
      providers: [
        { provide: DriveIntegrationRepository, useValue: { getConfig: vi.fn().mockResolvedValue(config) } },
        { provide: DriveAuthService, useValue: driveAuth },
        {
          provide: DriveApiService,
          useValue: {
            currentUser: vi.fn().mockResolvedValue({ emailAddress: 'user@example.com' }),
            getFile: vi.fn().mockImplementation(async (id: string) => ({
              id,
              name: id,
              mimeType: 'application/vnd.google-apps.folder',
              trashed: false,
            })),
          },
        },
        { provide: DrivePickerService, useValue: { selectFolder: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            waitForUser: vi.fn().mockResolvedValue({ uid: 'user-1', email: 'user@example.com' }),
            canAdminister: vi.fn(() => true),
          },
        },
      ],
    });

    const service = runInInjectionContext(injector, () => new DriveIntegrationService());
    await service.load();

    service.handleUnauthorized();

    expect(driveAuth.expireAccessToken).toHaveBeenCalledTimes(1);
    expect(service.status()).toBe('ready');
    expect(service.authorizationNeeded()).toBe(true);

    injector.destroy();
  });
});
