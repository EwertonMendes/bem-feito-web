import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIREBASE_AUTH } from '../firebase/firebase.providers';
import { DriveAuthService, DriveAuthorizationRequiredError, DriveRedirectStartedError } from './drive-auth.service';
const mocks = vi.hoisted(() => ({ callbacks: [] as Array<(user: {uid:string}|null)=>void> }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth,callback)=>{mocks.callbacks.push(callback);return ()=>{};}) }));
class MemoryStorage {
  private readonly map = new Map<string,string>();
  getItem(key:string):string|null { return this.map.get(key)??null; }
  setItem(key:string,value:string):void { this.map.set(key,value); }
  removeItem(key:string):void { this.map.delete(key); }
}
describe('DriveAuthService (backend token broker)',()=>{
  let auth: { currentUser: {uid:string; email:string;getIdToken:ReturnType<typeof vi.fn>}|null };
  let fetchMock: ReturnType<typeof vi.fn>;
  const environmentUrl = 'https://bem-feito-drive-dev.ewertonmendes9.workers.dev';
  function setup() {
    const injector = Injector.create({providers:[{provide:FIREBASE_AUTH,useValue:auth}]});
    return runInInjectionContext(injector,()=>new DriveAuthService());
  }
  beforeEach(()=>{
    vi.clearAllMocks(); mocks.callbacks.length=0;
    auth={currentUser:{uid:'user-1',email:'user@example.com',getIdToken:vi.fn().mockResolvedValue('firebase-id-token')}};
    const local=new MemoryStorage(),session=new MemoryStorage();
    local.setItem('bem-feito:google-drive:development','very-old-credential');
    vi.stubGlobal('localStorage',local);vi.stubGlobal('sessionStorage',session);
    vi.stubGlobal('window',{location:{assign:vi.fn()}});
    fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  });
  it('cleans legacy browser storage and holds tokens only in memory',async()=>{
    fetchMock.mockResolvedValue(Response.json({accessToken:'drive-token',expiresAt:Date.now()+3600000,email:'user@example.com',version:'v'.repeat(43)}));
    const service=setup();mocks.callbacks.at(-1)?.(auth.currentUser);
    expect(localStorage.getItem('bem-feito:google-drive:development')).toBeNull();
    expect(await service.accessToken()).toBe('drive-token');
    expect(await service.accessToken()).toBe('drive-token');
    expect(service.connected()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('bem-feito:google-drive:development')).toBeNull();
  });
  it('deduplicates concurrent refresh and clears memory on logout',async()=>{
    fetchMock.mockResolvedValue(Response.json({accessToken:'drive-token',expiresAt:Date.now()+3600000,email:'user@example.com',version:'v'.repeat(43)}));
    const service=setup();mocks.callbacks.at(-1)?.(auth.currentUser);
    expect(await Promise.all(Array.from({length:12},()=>service.accessToken()))).toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    auth.currentUser=null;mocks.callbacks.at(-1)?.(null);
    expect(service.currentToken()).toBeNull();
    expect(service.linked()).toBe(false);
  });
  it('prompts interactive OAuth only when Worker confirms missing grant',async()=>{
    fetchMock.mockImplementation(async(url:string)=>{
      if(url.endsWith('/drive/token'))return Response.json({error:{code:'reconnect_required'}},{status:409});
      return Response.json({launchUrl:environmentUrl+'/oauth/drive/launch?ticket=abc'});
    });
    const service=setup();mocks.callbacks.at(-1)?.(auth.currentUser);
    await expect(service.accessToken()).rejects.toBeInstanceOf(DriveAuthorizationRequiredError);
    // Once a grant is known absent, avoid another Worker POST for every image.
    await expect(service.accessToken()).rejects.toBeInstanceOf(DriveAuthorizationRequiredError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(service.connect()).rejects.toBeInstanceOf(DriveRedirectStartedError);
    expect(window.location.assign).toHaveBeenCalledTimes(1);
  });
  it('never evicts a newer access token on a stale Google 401',async()=>{
    let counter=0;
    fetchMock.mockImplementation(async(url:string)=>{
      if(url.endsWith('/drive/token/reject'))return Response.json({status:'invalidated'});
      counter++;
      return Response.json({accessToken:'token-'+counter,expiresAt:Date.now()+3600000,
        email:'user@example.com',version:counter===1?'x'.repeat(43):'y'.repeat(43)});
    });
    const service=setup();mocks.callbacks.at(-1)?.(auth.currentUser);
    const old=await service.accessToken();
    const oldVersion=service.versionForToken(old);
    service.expireAccessToken();
    const latest=await service.accessToken();
    expect(latest).toBe('token-2');
    await service.rejectAccessToken(oldVersion);
    expect(service.currentToken()).toBe('token-2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('version-guards rejection of a Google 401 before requesting fresh access',async()=>{
    fetchMock.mockImplementation(async(url:string)=>{
      if(url.endsWith('/drive/token/reject'))return Response.json({status:'invalidated'});
      return Response.json({accessToken:'drive-token',expiresAt:Date.now()+3600000,email:'user@example.com',version:'z'.repeat(43)});
    });
    const service=setup();mocks.callbacks.at(-1)?.(auth.currentUser);
    await service.accessToken();
    await service.rejectAccessToken();
    expect(service.currentToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request=fetchMock.mock.calls[1][1] as RequestInit;
    expect(request.body).toContain('z'.repeat(43));
  });
});
