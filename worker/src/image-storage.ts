import { ApiError, type Env, type Principal, type Connection } from './types.ts';
import { grant } from './tokens.ts';

// Only files inside the configured Bem Feito folder tree may be accessed.
// Google bearer credentials belong exclusively to the storage owner and
// MUST NEVER appear in a response returned to another Firebase user.
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const MAX_IMAGE = 3 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const KINDS = new Set(['products', 'inputs', 'additions']);
type Kind = 'products' | 'inputs' | 'additions';

interface StorageConfig { enabled: boolean; folders: Record<Kind, string>; rootFolderId: string; }
interface DriveMeta {
  id: string; name: string; size?: string; mimeType: string; trashed?: boolean;
  parents?: string[]; appProperties?: Record<string, string>; modifiedTime?: string;
}
interface GoogleResult { status: number; response: Response; }

function id(value: string | null): string {
  if (!value || !ID.test(value)) throw new ApiError(400, 'invalid_image_identifier');
  return value;
}
function kind(value: string | null): Kind {
  if (!value || !KINDS.has(value)) throw new ApiError(400, 'invalid_image_kind');
  return value as Kind;
}
function ensureWrite(user: Principal): void {
  if (user.role !== 'owner' && user.role !== 'operator') throw new ApiError(403, 'image_write_forbidden');
}
function fields(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && 'fields' in value &&
    typeof (value as {fields:unknown}).fields === 'object'
    ? (value as {fields:Record<string,any>}).fields : {};
}
function str(field: any): string {
  return typeof field?.stringValue === 'string' ? field.stringValue : '';
}
function assertConfig(doc: unknown): StorageConfig {
  const data = fields(doc);
  const folders = fields(data.folders?.mapValue);
  const rootFolderId = str(data.rootFolderId);
  if (data.enabled?.booleanValue !== true || !ID.test(rootFolderId) ||
      [...KINDS].some(k => !ID.test(str(folders[k])))) {
    throw new ApiError(503, 'storage_configuration_incomplete');
  }
  return {
    enabled: true,
    rootFolderId,
    folders: {
      products: str(folders.products),
      inputs: str(folders.inputs),
      additions: str(folders.additions),
    },
  };
}
async function firestore(env: Env, firebaseJwt: string, path: string): Promise<Record<string,unknown>> {
  // The caller's Firebase JWT is used here, so Firestore Security Rules
  // remain authoritative. The Worker never has a Firestore admin identity.
  let response: Response;
  try {
    response = await fetch(
      'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(env.FIREBASE_PROJECT_ID) +
        '/databases/(default)/documents/' + path,
      { headers: { Authorization: 'Bearer ' + firebaseJwt, Accept: 'application/json' },
        redirect: 'follow', signal: AbortSignal.timeout(10000) },
    );
  } catch { throw new ApiError(503, 'storage_firestore_unavailable'); }
  if (response.status === 404) throw new ApiError(404, 'storage_document_not_found');
  if (response.status === 401 || response.status === 403) throw new ApiError(403, 'storage_permission_denied');
  if (!response.ok) throw new ApiError(503, 'storage_firestore_unavailable');
  return await response.json() as Record<string,unknown>;
}
function callerToken(request: Request): string {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) throw new ApiError(401,'authentication_required');
  return auth.slice(7);
}
async function config(env: Env, request: Request): Promise<StorageConfig> {
  const doc = await firestore(env,callerToken(request),'integrations/google-drive');
  return assertConfig(doc);
}
async function storageOwner(env: Env): Promise<Principal> {
  // A fixed single-tenant identity, deployed independently for DEV and PROD.
  // Never infer the central owner from the requesting user's role or the
  // first connected user: a second owner (Maria) must not replace Ewerton.
  const email = env.STORAGE_OWNER_EMAIL?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ApiError(503,'storage_owner_not_configured');
  }
  const rows = await env.DB.prepare(
    "SELECT owner_uid,google_subject,google_email FROM drive_connections WHERE lower(google_email)=? AND status='connected' LIMIT 2"
  ).bind(email).all<Pick<Connection,'owner_uid'|'google_subject'|'google_email'>>();
  if (rows.results.length !== 1) throw new ApiError(503,'storage_owner_not_connected');
  const row = rows.results[0];
  if (row.google_email.trim().toLowerCase() !== email || !ID.test(row.owner_uid) || !row.google_subject) {
    throw new ApiError(503,'storage_owner_invalid');
  }
  return { uid:row.owner_uid,email,googleSub:row.google_subject,role:'owner' };
}
export async function storageStatus(env: Env, _user: Principal): Promise<Response> {
  const email = env.STORAGE_OWNER_EMAIL?.trim().toLowerCase() ?? '';
  let available = false;
  try { await storageOwner(env); available = true; }
  catch (e) { if (!(e instanceof ApiError && e.code.startsWith('storage_owner_'))) throw e; }
  return Response.json({available,ownerEmail:email});
}
async function google(env: Env, owner: Principal, url: string, init: RequestInit = {}): Promise<GoogleResult> {
  // Only fixed Drive v3 endpoints are ever sent here; callers cannot supply URLs.
  const make = async() => {
    const access = await grant(env,owner);
    const headers = new Headers(init.headers);
    headers.set('Authorization','Bearer '+access.accessToken);
    let response: Response;
    try { response = await fetch(url,{...init,headers,redirect:'manual',signal:AbortSignal.timeout(15000)}); }
    catch { throw new ApiError(503,'storage_drive_unavailable'); }
    return {response,version:access.version};
  };
  let result = await make();
  if (result.response.status === 401) {
    // Invalidate ONLY the stale central token, preserving the OAuth grant.
    await env.DB.prepare(
      'UPDATE drive_connections SET encrypted_access_token=NULL,access_token_expires_at=0,access_token_version=NULL WHERE owner_uid=? AND access_token_version=?'
    ).bind(owner.uid,result.version).run();
    result = await make();
  }
  if (result.response.status === 403 || result.response.status === 404) throw new ApiError(404,'storage_image_not_accessible');
  if (!result.response.ok || (result.response.status >= 300 && result.response.status < 400)) {
    throw new ApiError(503,'storage_drive_unavailable');
  }
  return { status:result.response.status, response:result.response };
}
async function metadata(env: Env, owner: Principal, fileId: string): Promise<DriveMeta> {
  const fields = encodeURIComponent('id,name,mimeType,trashed,parents,appProperties,size,modifiedTime');
  const result = await google(env,owner,DRIVE+'/files/'+encodeURIComponent(fileId)+'?fields='+fields+'&supportsAllDrives=true');
  return await result.response.json() as DriveMeta;
}
function assertImage(meta: DriveMeta, cfg: StorageConfig, expected?:{kind:Kind;entityId:string}): {kind:Kind;entityId:string} {
  const k = meta.appProperties?.entityType;
  const entityId = meta.appProperties?.entityId ?? '';
  if (!meta.id || !ID.test(meta.id) || meta.trashed || meta.mimeType !== 'image/webp' ||
      meta.appProperties?.app !== 'bem-feito' ||
      !k || !KINDS.has(k) || !ID.test(entityId) ||
      !meta.parents?.includes(cfg.folders[k as Kind]) ||
      !Number.isSafeInteger(Number(meta.size)) || Number(meta.size) <= 0 || Number(meta.size) > MAX_IMAGE ||
      (expected && (expected.kind !== k || expected.entityId !== entityId))) {
    throw new ApiError(403,'storage_image_outside_catalog');
  }
  return {kind:k as Kind,entityId};
}
async function assertReferenced(env:Env, request:Request, kind:Kind, entityId:string,fileId:string): Promise<void> {
  const doc = await firestore(env,callerToken(request),encodeURIComponent(kind)+'/'+encodeURIComponent(entityId));
  const data = fields(doc);
  const image = fields(data.image?.mapValue);
  if (str(image.fileId) !== fileId || str(image.provider) !== 'google-drive') {
    throw new ApiError(403,'storage_image_reference_mismatch');
  }
}
function fileUrl(fileId:string, suffix=''):string {
  return DRIVE+'/files/'+encodeURIComponent(fileId)+'?supportsAllDrives=true'+suffix;
}
function info(meta:DriveMeta):Record<string,unknown> {
  return {id:meta.id,name:meta.name,mimeType:meta.mimeType,modifiedTime:meta.modifiedTime,
    size:meta.size,trashed:meta.trashed,parents:meta.parents,appProperties:meta.appProperties};
}
async function upload(env:Env,owner:Principal,body:ArrayBuffer,fileId:string):Promise<DriveMeta> {
  const result=await google(env,owner,UPLOAD+'/files/'+encodeURIComponent(fileId)+
    '?uploadType=media&fields='+encodeURIComponent('id,name,mimeType,modifiedTime,size,trashed,parents,appProperties')+
    '&supportsAllDrives=true',
    {method:'PATCH',headers:{'Content-Type':'image/webp'},body});
  return await result.response.json() as DriveMeta;
}
export async function imageRequest(request:Request,env:Env,user:Principal):Promise<Response> {
  const url = new URL(request.url);
  const fileId = url.pathname.startsWith('/storage/image/') ? id(url.pathname.slice('/storage/image/'.length)) : null;
  const method = request.method;
  if (!['GET','POST','PUT','DELETE'].includes(method) ||
      (method === 'POST' && fileId) || (method !== 'POST' && !fileId)) {
    throw new ApiError(405,'method_not_allowed');
  }
  if (method !== 'GET') ensureWrite(user);
  const cfg = await config(env,request);
  const owner = await storageOwner(env);
  if (method === 'GET') {
    const meta=await metadata(env,owner,fileId!);
    assertImage(meta,cfg);
    const result=await google(env,owner,fileUrl(fileId!,'&alt=media'));
    const binary=await result.response.arrayBuffer();
    if (!binary.byteLength || binary.byteLength > MAX_IMAGE) throw new ApiError(502,'storage_invalid_image_size');
    return new Response(binary,{headers:{'Content-Type':'image/webp','Cache-Control':'no-store'}});
  }
  const k = kind(url.searchParams.get('kind')), entityId = id(url.searchParams.get('entityId'));
  if (method === 'POST' || method === 'PUT') {
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'image/webp') {
      throw new ApiError(415,'invalid_image_type');
    }
    const length = Number(request.headers.get('Content-Length') ?? '0');
    if (length > MAX_IMAGE) throw new ApiError(413,'image_too_large');
    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_IMAGE) throw new ApiError(413,'image_too_large');
    // WebP RIFF magic: prevent uploading arbitrary HTML, SVG or scripts.
    const signature=new Uint8Array(body.slice(0,12));
    if (signature.length<12 || String.fromCharCode(...signature.slice(0,4))!=='RIFF' ||
        String.fromCharCode(...signature.slice(8,12))!=='WEBP') throw new ApiError(415,'invalid_image_type');
    if (method === 'PUT') {
      await assertReferenced(env,request,k,entityId,fileId!);
      assertImage(await metadata(env,owner,fileId!),cfg,{kind:k,entityId});
      const meta=await upload(env,owner,body,fileId!);
      return Response.json(info(meta));
    }
    const created=await google(env,owner,DRIVE+'/files?fields='+encodeURIComponent('id,name,mimeType,parents,appProperties'),
      {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:k+'_'+entityId+'.webp',mimeType:'image/webp',
          parents:[cfg.folders[k]],appProperties:{app:'bem-feito',entityType:k,entityId}})});
    const value=await created.response.json() as DriveMeta;
    if (!value.id || !ID.test(value.id)) throw new ApiError(502,'storage_invalid_create_response');
    try {
      const meta=await upload(env,owner,body,value.id);
      return Response.json(info(meta));
    } catch (error) {
      // Best-effort cleanup; never replace or delete an existing referenced file.
      await google(env,owner,fileUrl(value.id,'&fields=id'),{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})
      }).catch(()=>{});
      throw error;
    }
  }
  await assertReferenced(env,request,k,entityId,fileId!);
  assertImage(await metadata(env,owner,fileId!),cfg,{kind:k,entityId});
  await google(env,owner,fileUrl(fileId!,'&fields=id'),{
    method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})
  });
  return Response.json({deleted:true});
}
