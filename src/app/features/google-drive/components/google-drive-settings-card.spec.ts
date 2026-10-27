import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { DriveIntegrationService, type DriveIntegrationStatus } from '../../../core/google-drive/drive-integration.service';
import { ErrorService } from '../../../core/services/error.service';
import { ToastService } from '../../../core/services/toast.service';
import { GoogleDriveSettingsCard } from './google-drive-settings-card';

function setup() {
  const status = signal<DriveIntegrationStatus>('loading');
  const connected = signal(false);
  const config = signal<{ enabled: boolean } | null>({ enabled: true });
  const integration = {
    enabled: true,
    status,
    connected,
    config,
    load: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const injector = Injector.create({
    providers: [
      { provide: DriveIntegrationService, useValue: integration },
      { provide: AuthService, useValue: { canAdminister: () => true } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      { provide: ErrorService, useValue: { message: (error: Error) => error.message } },
    ],
  });
  const card = runInInjectionContext(injector, () => new GoogleDriveSettingsCard());
  return { card, status, connected, config, integration, injector };
}

describe('Google Drive settings connection actions', () => {
  beforeEach(() => vi.stubGlobal('window', { location: { search: '' } }));
  afterEach(() => vi.unstubAllGlobals());

  it('hides both actions while the connection is being loaded', () => {
    const { card, injector } = setup();
    expect(card.showConnect()).toBe(false);
    expect(card.showDisconnect()).toBe(false);
    injector.destroy();
  });

  it('shows only Connect when disconnected or requiring renewed access', () => {
    const { card, status, injector } = setup();
    for (const state of ['disconnected', 'ready', 'error'] as const) {
      status.set(state);
      expect(card.showConnect()).toBe(true);
      expect(card.showDisconnect()).toBe(false);
    }
    injector.destroy();
  });

  it('shows only Disconnect when the Drive connection is active', () => {
    const { card, status, connected, injector } = setup();
    status.set('connected');
    connected.set(true);
    expect(card.showConnect()).toBe(false);
    expect(card.showDisconnect()).toBe(true);
    connected.set(false);
    expect(card.showConnect()).toBe(true);
    expect(card.showDisconnect()).toBe(false);
    injector.destroy();
  });

  it('does not show connection actions when no enabled folder is configured', () => {
    const { card, status, config, injector } = setup();
    status.set('disconnected');
    config.set(null);
    expect(card.showConnect()).toBe(false);
    expect(card.showDisconnect()).toBe(false);
    config.set({ enabled: false });
    expect(card.showConnect()).toBe(false);
    expect(card.showDisconnect()).toBe(false);
    injector.destroy();
  });

  it('does not attempt disconnect when the Drive is no longer connected', async () => {
    const { card, status, integration, injector } = setup();
    status.set('disconnected');
    await card.disconnect();
    expect(integration.disconnect).not.toHaveBeenCalled();
    injector.destroy();
  });
});
