import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@angular/core', async()=>{const actual=await vi.importActual<typeof import('@angular/core')>('@angular/core');return {...actual,effect:vi.fn()};});
import { AuthService } from '../auth/auth.service';
import { DriveIntegrationRepository } from '../repositories/drive-integration.repository';
import { DriveApiError, DriveApiService } from './drive-api.service';
import { DriveAuthService } from './drive-auth.service';
import { DriveIntegrationService } from './drive-integration.service';
import { DrivePickerService } from './drive-picker.service';
const config={id:'google-drive',enabled:true,rootFolderId:'root',rootFolderName:'DEV',folders:{products:'a',inputs:'b',kits:'c',additions:'d'}};
function setup(tokenAvailable=false){
  const linked=signal(tokenAvailable),active=signal(tokenAvailable),revision=signal(0),email=signal<string|null>('owner@example.com');
  const token=vi.fn(async()=>{linked.set(true);active.set(true);return 'token';});
  const driveAuth={linked,connected:active,revision,accountEmail:email,
    currentToken:vi.fn(()=>active()?'token':null),accessToken:token,
    connect:vi.fn(async()=>{active.set(true);return 'token';}),
    expireAccessToken:vi.fn(()=>active.set(false)),setAccountEmail:vi.fn(),disconnect:vi.fn()};
  const repository={getConfig:vi.fn().mockResolvedValue(config),saveConfig:vi.fn()};
  const driveApi={currentUser:vi.fn().mockResolvedValue({emailAddress:'owner@example.com'}),
    getFile:vi.fn(async(id:string)=>({id,mimeType:'application/vnd.google-apps.folder',trashed:false}))};
  const auth={waitForUser:vi.fn().mockResolvedValue({uid:'owner',email:'owner@example.com'}),canAdminister:vi.fn(()=>true)};
  const picker={selectFolder:vi.fn()};
  const injector=Injector.create({providers:[
    {provide:DriveIntegrationRepository,useValue:repository},
    {provide:DriveAuthService,useValue:driveAuth},
    {provide:DriveApiService,useValue:driveApi},
    {provide:DrivePickerService,useValue:picker},
    {provide:AuthService,useValue:auth}
  ]});
  const service=runInInjectionContext(injector,()=>new DriveIntegrationService());
  return {service,driveAuth,injector,driveApi,picker};
}
describe('DriveIntegrationService - offline OAuth',()=>{
  it('authorizes inaccessible existing subfolders individually without changing configured IDs',async()=>{
    const {service,injector,driveApi,picker}=setup(true);
    await service.load();
    const granted=new Set(['root']);
    driveApi.getFile.mockImplementation(async(id:string)=>{
      if(!granted.has(id)) throw new DriveApiError(404,'Not found');
      return {id,mimeType:'application/vnd.google-apps.folder',trashed:false,parents:['root']};
    });
    const pending=['a','b','c','d'];
    picker.selectFolder.mockImplementation(async()=>{const id=pending.shift()!;granted.add(id);return {id,name:id};});
    await service.connect();
    expect(service.status()).toBe('connected');
    expect(picker.selectFolder.mock.calls.map(call=>call[0])).toEqual(
      ['products','inputs','kits','additions'].map(name=>({title:`Autorize a pasta ${name}`,parentId:'root'})));
    expect(service.config()?.folders).toEqual(config.folders);
    injector.destroy();
  });
  it('rejects another selected folder instead of adopting it or hiding the authorization failure',async()=>{
    const {service,injector,driveApi,picker}=setup(true);
    await service.load();
    driveApi.getFile.mockRejectedValue(new DriveApiError(404,'Not found'));
    picker.selectFolder.mockResolvedValue({id:'different',name:'Other'});
    await expect(service.connect()).rejects.toThrow('Selecione exatamente a pasta DEV');
    expect(service.status()).toBe('error');
    expect(service.config()?.rootFolderId).toBe('root');
    injector.destroy();
  });
  it('recovers a saved grant silently while loading the configured folder',async()=>{
    const {service,driveAuth,injector,driveApi}=setup();
    await service.load();
    expect(driveAuth.accessToken).toHaveBeenCalledTimes(1);
    expect(driveApi.getFile).toHaveBeenCalledTimes(5);
    expect(service.status()).toBe('connected');
    expect(service.authorizationNeeded()).toBe(false);
    injector.destroy();
  });
  it('restores after token expiry during passive image load',async()=>{
    const {service,driveAuth,injector}=setup();
    await service.load();
    driveAuth.connected.set(false);
    await service.ensureConnected();
    expect(service.connected()).toBe(true);
    expect(driveAuth.accessToken).toHaveBeenCalledTimes(2);
    injector.destroy();
  });
  it('does not prompt for OAuth until the backend genuinely needs new authorization',async()=>{
    const {service,driveAuth,injector}=setup(true);
    await service.load();
    service.requestAuthorization();
    expect(service.status()).toBe('ready');
    expect(driveAuth.expireAccessToken).not.toHaveBeenCalled();
    injector.destroy();
  });
});
