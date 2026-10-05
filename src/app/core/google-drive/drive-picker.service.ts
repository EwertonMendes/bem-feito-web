import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { DriveAuthService } from './drive-auth.service';
import { ExternalScriptLoaderService } from './external-script-loader.service';

interface PickerView {
  setIncludeFolders(value: boolean): PickerView;
  setSelectFolderEnabled(value: boolean): PickerView;
  setMimeTypes(value: string): PickerView;
}

interface PickerBuilder {
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  addView(view: PickerView): PickerBuilder;
  setCallback(callback: (data: { action: string; docs?: Array<{ id: string; name?: string }> }) => void): PickerBuilder;
  build(): { setVisible(value: boolean): void };
}

interface PickerWindow {
  gapi?: { load(name: string, callback: () => void): void };
  google?: {
    picker?: {
      Action: { PICKED: string; CANCEL: string };
      ViewId: { FOLDERS: string };
      DocsView: new (viewId: string) => PickerView;
      PickerBuilder: new () => PickerBuilder;
    };
  };
}

@Injectable({ providedIn: 'root' })
export class DrivePickerService {
  private readonly auth = inject(DriveAuthService);
  private readonly scripts = inject(ExternalScriptLoaderService);

  async selectFolder(): Promise<{ id: string; name: string }> {
    const token = await this.auth.connect();
    await this.scripts.load('google-api-loader', 'https://apis.google.com/js/api.js');
    await this.loadPicker();

    const pickerApi = (window as unknown as PickerWindow).google?.picker;
    if (!pickerApi) throw new Error('Google Picker indisponível.');

    const view = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes('application/vnd.google-apps.folder');

    return new Promise((resolve, reject) => {
      const picker = new pickerApi.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(environment.googleDrive.pickerApiKey)
        .setAppId(environment.googleDrive.cloudProjectNumber)
        .setOrigin(window.location.origin)
        .addView(view)
        .setCallback((data) => {
          if (data.action === pickerApi.Action.CANCEL) {
            reject(new Error('Seleção da pasta cancelada.'));
            return;
          }
          if (data.action !== pickerApi.Action.PICKED) return;
          const selected = data.docs?.[0];
          if (!selected?.id) {
            reject(new Error('Nenhuma pasta foi selecionada.'));
            return;
          }
          resolve({ id: selected.id, name: selected.name ?? 'Bem Feito' });
        })
        .build();
      picker.setVisible(true);
    });
  }

  private async loadPicker(): Promise<void> {
    const gapi = (window as unknown as PickerWindow).gapi;
    if (!gapi) throw new Error('Google API Loader indisponível.');
    await new Promise<void>((resolve) => gapi.load('picker', resolve));
  }
}
