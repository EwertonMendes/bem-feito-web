import { Injectable, inject } from '@angular/core';
import { Auth } from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { CatalogImageEntityKind } from '../../domain/models/image.model';
import { FIREBASE_AUTH } from '../firebase/firebase.providers';
import { DriveApiError, type DriveFileMetadata } from './drive-api.service';

interface CentralStatus { available: boolean; ownerEmail: string; }

@Injectable({ providedIn: 'root' })
export class CentralDriveImageApiService {
  private readonly firebase = inject<Auth>(FIREBASE_AUTH);

  async status(): Promise<CentralStatus> {
    const response = await this.request('/storage/status','GET');
    const data = await response.json() as CentralStatus;
    if (typeof data.available !== 'boolean' || !data.ownerEmail) {
      throw new Error('O armazenamento central retornou uma configuração inválida.');
    }
    return data;
  }

  async download(fileId: string): Promise<Blob> {
    const response = await this.request('/storage/image/'+encodeURIComponent(fileId),'GET');
    return response.blob();
  }

  async createImage(kind: CatalogImageEntityKind, entityId: string, blob: Blob): Promise<DriveFileMetadata> {
    const url='/storage/image?'+new URLSearchParams({kind,entityId});
    const response = await this.request(url,'POST',blob);
    return response.json() as Promise<DriveFileMetadata>;
  }

  async updateImage(kind: CatalogImageEntityKind, entityId: string, fileId: string, blob: Blob): Promise<DriveFileMetadata> {
    const url='/storage/image/'+encodeURIComponent(fileId)+'?'+new URLSearchParams({kind,entityId});
    const response = await this.request(url,'PUT',blob);
    return response.json() as Promise<DriveFileMetadata>;
  }

  async trash(kind: CatalogImageEntityKind, entityId: string, fileId: string): Promise<void> {
    const url='/storage/image/'+encodeURIComponent(fileId)+'?'+new URLSearchParams({kind,entityId});
    await this.request(url,'DELETE');
  }

  private async request(path: string, method: 'GET'|'POST'|'PUT'|'DELETE', body?:Blob): Promise<Response> {
    const user=this.firebase.currentUser;
    if (!user) throw new Error('Entre no Bem Feito para acessar as imagens.');
    const headers=new Headers();
    if (body) headers.set('Content-Type','image/webp');
    let response:Response|undefined;
    for (let attempt=0;attempt<2;attempt++) {
      const token=await user.getIdToken(attempt===1);
      response=await fetch(environment.googleDrive.workerUrl+path,{
        method,headers:new Headers({...Object.fromEntries(headers),Authorization:'Bearer '+token}),
        ...(body?{body}:{}),cache:'no-store'
      });
      if (response.status!==401) break;
    }
    if (!response?.ok) {
      const data=await response?.json().catch(()=>null) as {error?:{code?:string}}|null;
      const code=data?.error?.code;
      if (code==='storage_owner_not_connected' || code==='reconnect_required') {
        throw new Error('A conexão do Drive do proprietário precisa ser renovada nas configurações.');
      }
      if (code==='storage_image_not_accessible' || code==='storage_image_outside_catalog') {
        throw new Error('A imagem não está acessível na pasta de armazenamento do Bem Feito.');
      }
      if (code==='storage_image_reference_mismatch') {
        throw new Error('A referência da imagem mudou. Atualize os dados antes de alterar ou excluir.');
      }
      if (code==='image_write_forbidden') throw new Error('Sua conta não tem permissão para alterar imagens.');
      if (code==='storage_configuration_incomplete') throw new Error('A pasta central não está configurada corretamente.');
      if (code==='image_too_large') throw new Error('A imagem excedeu o tamanho permitido.');
      if (response?.status===401 || response?.status===403) throw new DriveApiError(response.status,'Acesso às imagens não autorizado.');
      if (response?.status===404) throw new DriveApiError(404,'Imagem não encontrada no armazenamento.');
      throw new Error('Não foi possível acessar o armazenamento central de imagens.');
    }
    return response;
  }
}
