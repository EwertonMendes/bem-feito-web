import { ApiError, type Env } from './types.ts';
import { principal, sameOrigin } from './auth.ts';
import { start, launch, callback } from './oauth.ts';
import { state, token, disconnect, rejectToken } from './tokens.ts';
const SECURITY_HEADERS: Record<string,string> = {
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy':'no-referrer',
  'Cache-Control':'no-store'
};
function checkEnv(env: Env): void {
  const dev = env.ENVIRONMENT === 'dev';
  const prod = env.ENVIRONMENT === 'production';
  if (!dev && !prod) throw new ApiError(503,'environment_mismatch');
  if (dev && (env.FIREBASE_PROJECT_ID !== 'bem-feito-dev' ||
      env.FRONTEND_ORIGIN !== 'https://bem-feito-dev.web.app' ||
      env.OAUTH_REDIRECT_URI !== 'https://bem-feito-drive-dev.ewertonmendes9.workers.dev/oauth/drive/callback')) {
    throw new ApiError(503,'environment_mismatch');
  }
  // Future PROD is intentionally not provisioned yet; fail closed until distinct
  // project, origin and callback are provided without changing this code.
  if (prod && (env.FIREBASE_PROJECT_ID === 'bem-feito-dev' ||
      !/^[-a-z0-9]{4,100}$/.test(env.FIREBASE_PROJECT_ID) ||
      !env.FRONTEND_ORIGIN.startsWith('https://') ||
      env.FRONTEND_ORIGIN.includes('bem-feito-dev') ||
      !env.OAUTH_REDIRECT_URI.startsWith('https://') ||
      env.OAUTH_REDIRECT_URI.includes('bem-feito-drive-dev') ||
      new URL(env.OAUTH_REDIRECT_URI).pathname !== '/oauth/drive/callback')) {
    throw new ApiError(503,'environment_mismatch');
  }
}
function jsonError(error: unknown): Response {
  const code = error instanceof ApiError ? error.code : 'internal_error';
  const status = error instanceof ApiError ? error.status : 500;
  return Response.json({error:{code}},{status});
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    let response: Response;
    try {
      checkEnv(env);
      const url = new URL(request.url);
      const path = url.pathname;
      if (origin && origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_denied');
      if (request.method === 'OPTIONS') {
        if (origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_denied');
        response = new Response(null,{status:204,headers:{
          'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':'Authorization, Content-Type',
          'Access-Control-Max-Age':'3600'
        }});
      } else if (request.method === 'GET' && path === '/health') {
        response = Response.json({status:'ok',environment:env.ENVIRONMENT});
      } else if (request.method === 'GET' && path === '/oauth/drive/launch') {
        response = await launch(request,env);
      } else if (request.method === 'GET' && path === '/oauth/drive/callback') {
        response = await callback(request,env);
      } else if (['/oauth/drive/start','/drive/token','/drive/disconnect','/drive/connection','/drive/token/reject'].includes(path)) {
        // No state-changing operation is accepted cross-origin without the intended browser Origin.
        if (request.method === 'POST') sameOrigin(request,env);
        const user = await principal(request,env);
        if (path === '/oauth/drive/start' && request.method === 'POST') response = await start(env,user);
        else if (path === '/drive/token' && request.method === 'POST') response = await token(env,user);
        else if (path === '/drive/token/reject' && request.method === 'POST') response = await rejectToken(env,user,request);
        else if (path === '/drive/connection' && request.method === 'GET') response = await state(env,user);
        else if (path === '/drive/disconnect' && request.method === 'POST') response = await disconnect(env,user);
        else throw new ApiError(405,'method_not_allowed');
      } else { throw new ApiError(404,'not_found'); }
    } catch (error) { response = jsonError(error); }
    for (const [key,value] of Object.entries(SECURITY_HEADERS)) response.headers.set(key,value);
    if (origin === env.FRONTEND_ORIGIN) {
      response.headers.set('Access-Control-Allow-Origin',origin);
      response.headers.set('Vary','Origin');
    }
    return response;
  }
};
