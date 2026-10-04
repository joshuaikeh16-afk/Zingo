import { createClient } from 'npm:@supabase/supabase-js@2';
import { cachedSports, SportsError, sportsOperation } from '../_shared/sports.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
Deno.serve(async(request:Request)=>{
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const client=createClient(url,anon,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data:{user},error}=await client.auth.getUser();if(error||!user)return json({code:'AUTH_REQUIRED'},401);
  const text=await request.text();if(text.length>2048)return json({code:'INVALID_REQUEST'},400);
  let body;try{body=JSON.parse(text);}catch{throw new SportsError('INVALID_REQUEST');}
  if(!body||Array.isArray(body)||typeof body!=='object')throw new SportsError('INVALID_REQUEST');sportsOperation(body);
  const {data:profile}=await client.from('profiles').select('is_banned').eq('id',user.id).single();if(!profile||profile.is_banned)return json({code:'ACCESS_DENIED'},403);
  const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  return json(await cachedSports(service,body,Deno.env.get('API_SPORTS_KEY')||'',user.id));
 }catch(error){const code=error instanceof SportsError?error.code:'SPORTS_UNAVAILABLE';return json({code},error instanceof SportsError?error.status:503);}
});
