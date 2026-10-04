import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveCombat,CombatError, type Combat } from '../_shared/combat.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async(request:Request)=>{
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const read=async(id:string):Promise<Combat>=>{const results=await Promise.all([service.from('battle_combat_state').select('*').eq('battle_id',id).single(),service.from('battle_participants').select('*').eq('battle_id',id),service.from('battle_status_effects').select('*').eq('battle_id',id),service.from('battle_cooldowns').select('*').eq('battle_id',id)]);if(results.some((r:any)=>r.error))throw new CombatError('BATTLE_UNAVAILABLE');const [state,fighters,effects,cooldowns]=results.map((r:any)=>r.data);return {...state,id,seed:state.seed,fighters,effects,cooldowns};};
 const tick=async(id:string)=>{for(let n=0;n<8;n++){const expiry=await service.rpc('kaidra_combat_expire',{target_battle:id});if(expiry.error&&expiry.error.code!=='PGRST202')throw new CombatError('COMMIT_FAILED');if(expiry.data)break;const state=await read(id);if(state.phase!=='playing'||!state.deadline||Date.parse(state.deadline)>Date.now())break;const requestId=crypto.randomUUID(),intent={action:'timeout',ability:null,target:null};const result=resolveCombat(state,{actor:state.active_id!,action:'timeout',request_id:requestId,expected_revision:state.revision});const {error}=await service.rpc('kaidra_combat_commit',{target_battle:id,actor:state.active_id,request_id:requestId,expected_revision:state.revision,intent,result});if(error)throw new CombatError('COMMIT_FAILED');}};
 try {
  const secret=Deno.env.get('SPORTS_SYNC_SECRET');
  if(secret&&request.headers.get('x-sync-secret')===secret){const {data,error}=await service.from('battle_combat_state').select('battle_id').eq('phase','playing').lt('deadline',new Date().toISOString()).limit(20);if(error)throw error;const pending=await service.from('battles').select('id').eq('combat_version',1).eq('status','pending').lt('created_at',new Date(Date.now()-600000).toISOString()).limit(50);if(pending.error)throw pending.error;for(const row of pending.data||[])await service.rpc('kaidra_combat_expire',{target_battle:row.id});for(const row of data||[])await tick(row.battle_id);return json({processed:data?.length||0,expired_checked:pending.data?.length||0});}
  const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:request.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return json({code:'AUTH_REQUIRED'},401);
  const text=await request.text();if(text.length>2048)return json({code:'INVALID_INTENT'},400);let body;try{body=JSON.parse(text);}catch{return json({code:'INVALID_INTENT'},400);}
  if(!body||Array.isArray(body)||!uuid(body.battle_id)||!['state','act','surrender','timeout'].includes(body.action)||Object.keys(body).some(key=>!['action','battle_id','ability_id','target_id','request_id','expected_revision'].includes(key)))return json({code:'INVALID_INTENT'},400);
  const publicState=async()=>{const r=await client.rpc('kaidra_combat_state',{target_battle:body.battle_id});if(r.error)throw new CombatError('ACCESS_DENIED');return r.data;};
  await publicState();
  if(['state','timeout'].includes(body.action)){await tick(body.battle_id);return json(await publicState());}
  const {data:profile}=await client.from('profiles').select('is_banned').eq('id',user.id).single();if(!profile||profile.is_banned)return json({code:'ACCESS_DENIED'},403);
  if(!uuid(body.request_id)||!Number.isInteger(body.expected_revision)||body.expected_revision<0||body.target_id!=null&&!uuid(body.target_id)||body.action==='act'&&(typeof body.ability_id!=='string'||!/^[a-z_]{1,40}$/.test(body.ability_id)))return json({code:'INVALID_INTENT'},400);
  const intent:Record<string,any>={action:body.action,ability:body.ability_id||null,target:body.target_id||null};
  const {data:previous}=await service.from('battle_events').select('actor,payload').eq('battle_id',body.battle_id).eq('request_id',body.request_id).maybeSingle();
  if(previous){if(previous.actor!==user.id||JSON.stringify(previous.payload.intent)!==JSON.stringify(intent)){// JSONB key ordering differs; compare explicit intent fields.
    if(previous.actor!==user.id||['action','ability','target'].some(k=>previous.payload.intent[k]!==intent[k]))return json({code:'IDEMPOTENCY_CONFLICT'},409);
   }return json(await publicState());}
  const state=await read(body.battle_id),result=resolveCombat(state,{actor:user.id,ability:body.ability_id,target:body.target_id,action:body.action,request_id:body.request_id,expected_revision:body.expected_revision});
  const {data:committed,error}=await service.rpc('kaidra_combat_commit',{target_battle:body.battle_id,actor:user.id,request_id:body.request_id,expected_revision:body.expected_revision,intent,result});if(error)throw new CombatError('COMMIT_FAILED');if(!committed)return json({code:'STALE_TURN'},409);
  return json(await publicState());
 }catch(error){const code=error instanceof CombatError?error.code:'COMBAT_UNAVAILABLE';return json({code},code==='ACCESS_DENIED'?403:['STALE_TURN','TURN_EXPIRED'].includes(code)?409:code==='COMMIT_FAILED'||code==='COMBAT_UNAVAILABLE'?503:400);}
});
