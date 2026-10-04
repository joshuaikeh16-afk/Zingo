import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
if(process.env.KAIDRA_LIVE_QA!=='1')throw new Error('Set KAIDRA_LIVE_QA=1 for temporary-account live acceptance checks.');
const project='skmlktywdmsbjyybtmhm',base=`https://${project}.supabase.co`;
const keysRun=spawnSync('.tools/supabase/supabase',['projects','api-keys','--project-ref',project,'--reveal','--output','json'],{encoding:'utf8'});
if(keysRun.status!==0)throw new Error('Test credential lookup failed');
const keys=JSON.parse(keysRun.stdout),service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
const bridge=`import sys,json,urllib.request,urllib.error
v=json.load(sys.stdin)
r=urllib.request.Request(v['url'],data=json.dumps(v['body']).encode() if v['body'] is not None else None,headers={'apikey':v['key'],'Authorization':'Bearer '+v['token'],'Content-Type':'application/json','Prefer':'return=representation'},method=v['method'])
try:
 with urllib.request.urlopen(r,timeout=30) as response:
  b=response.read();print(json.dumps({'status':response.status,'data':json.loads(b) if b else None}))
except urllib.error.HTTPError as error:
 b=error.read();print(json.dumps({'status':error.code,'data':json.loads(b) if b else None}))
`;
function transport(path,method,body,token){return new Promise((resolve,reject)=>{const child=spawn('python3',['-c',bridge],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',data=>output+=data);const timer=setTimeout(()=>{child.kill();reject(new Error('HTTP test transport timeout'));},35000);child.on('error',()=>{clearTimeout(timer);reject(new Error('HTTP test transport failed'));});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('HTTP test transport failed'));try{resolve(JSON.parse(output));}catch{reject(new Error('Invalid HTTP test response'));}});child.stdin.end(JSON.stringify({url:base+path,method,body,token,key:anon}));});}
async function request(path,method='GET',body=null,token=service){for(let i=0;i<3;i++){try{return await transport(path,method,body,token);}catch(error){if(i===2||!(method==='GET'||method==='DELETE'||path.startsWith('/auth/v1/token')))throw error;}}}
async function api(path,method='GET',body=null,token=service){const result=await request(path,method,body,token);assert(result.status<400,`HTTP ${result.status}: ${result.data?.message||result.data?.code||path}`);return result.data;}
const rpc=(name,args,token)=>api('/rest/v1/rpc/'+name,'POST',args,token);
const planned=[],users=[];
async function createUser(){const suffix=randomBytes(8).toString('hex'),email=`kaidra-awakening-qa-${suffix}@example.invalid`,password=randomBytes(24).toString('base64url');planned.push(email);let user;try{user=await api('/auth/v1/admin/users','POST',{email,password,email_confirm:true});}catch{const found=await api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');user=found.users.find(u=>u.email===email);if(!user)throw new Error('Temporary user creation failed');}users.push(user);await api('/rest/v1/profiles','POST',{id:user.id,username:'qa_'+suffix,display_name:'QA awakening',onboarding_completed:true});const token=(await api('/auth/v1/token?grant_type=password','POST',{email,password},anon)).access_token;return {...user,token};}
const cids=[];
const args=(cid,target,id=randomUUID())=>({target_conversation:cid,target_user:target,topic:'',stance:'',context:{entry_type:'direct'},request_id:id});
try{
 const a=await createUser(),b=await createUser(),c=await createUser();
 for(const u of [a,b])await api('/rest/v1/battle_identities','POST',{user_id:u.id,class_id:'warrior',determination_version:1});
 await api('/rest/v1/friend_requests','POST',{requester_id:a.id,target_id:b.id,status:'accepted'});
 const dm=await rpc('get_or_create_conversation',{other_user_id:b.id},a.token);cids.push(dm);
 const group=await rpc('kaidra_create_group',{group_title:'Battle creation QA',member_ids:[b.id]},a.token);cids.push(group);
 const legacy=randomUUID();await api('/rest/v1/battles','POST',{id:legacy,conversation_id:dm,challenger_id:a.id,challenged_id:b.id,type:'direct',topic:'Friendly battle',challenger_position:null,combat_version:0,status:'active',accepted_at:new Date().toISOString(),ends_at:new Date(Date.now()+86400000).toISOString()});
 const firstArgs=args(dm,b.id),first=await request('/rest/v1/rpc/kaidra_battle_create','POST',firstArgs,a.token);
 if(process.env.KAIDRA_EXPECT_CREATE_CONFLICT==='1'){
  assert.equal(first.status,409);assert.equal(first.data.code,'23505');assert.match(first.data.message,/battles_open_pair_idx/);
  console.log('REPRODUCED: HTTP 409 / SQLSTATE 23505 on battles_open_pair_idx from a legacy accepted direct challenge.');
 }else{
  assert.equal(first.status,400,JSON.stringify(first));assert.equal(first.data.code,'P0001');assert.equal(JSON.parse(first.data.details).battle_id,legacy);
  assert.equal((await api('/rest/v1/battles?id=eq.'+legacy+'&select=status'))[0].status,'active','Creation must preserve existing legacy challenges');
  assert((await request('/rest/v1/rpc/kaidra_battle_action','POST',{target_battle:legacy,action:'close_legacy'},c.token)).status>=400);
  await rpc('kaidra_battle_action',{target_battle:legacy,action:'close_legacy'},b.token);await rpc('kaidra_battle_action',{target_battle:legacy,action:'close_legacy'},b.token);assert(!(await api('/rest/v1/messages?conversation_id=eq.'+dm+'&select=event_data')).some(m=>m.event_data?.battle_id===legacy),'Old closed card still in chat');
  assert.equal((await api('/rest/v1/battles?id=eq.'+legacy+'&select=status'))[0].status,'cancelled');assert.deepEqual(await api('/rest/v1/battle_rewards?battle_id=eq.'+legacy),[]);
  const id=await rpc('kaidra_battle_create',firstArgs,a.token);
  assert((await request('/rest/v1/rpc/kaidra_battle_action','POST',{target_battle:id,action:'close_legacy'},a.token)).status>=400,'Legacy close must never end an RPG battle');
  assert.equal(await rpc('kaidra_battle_create',firstArgs,a.token),id,'Identical retry must return the same battle');
  const conflicting=await request('/rest/v1/rpc/kaidra_battle_create','POST',args(group,b.id),a.token);
  assert.equal(conflicting.status,400);assert.equal(conflicting.data.code,'P0001');assert.equal(JSON.parse(conflicting.data.details).battle_id,id);assert.match(conflicting.data.message,/already have an open battle/);
  const outsider=await request('/rest/v1/rpc/kaidra_battle_create','POST',args(dm,b.id),c.token);assert(outsider.status>=400);assert(!outsider.data.details?.includes(id));
  const reuse=await request('/rest/v1/rpc/kaidra_battle_create','POST',args(group,b.id,id),a.token);assert(reuse.status>=400);assert.match(reuse.data.message,/request.*already used/i);
  await api('/rest/v1/battles?id=eq.'+id,'PATCH',{created_at:new Date(Date.now()-660000).toISOString()});
  const second=await rpc('kaidra_battle_create',args(group,b.id),a.token);assert.equal((await rpc('kaidra_battle_state',{target_battle:id},a.token)).status,'expired');assert(!(await api('/rest/v1/messages?conversation_id=eq.'+dm+'&select=event_data')).some(m=>m.event_data?.battle_id===id),'Expired card still in chat');
  await rpc('kaidra_battle_action',{target_battle:second,action:'cancel'},a.token);assert(!(await api('/rest/v1/messages?conversation_id=eq.'+group+'&select=event_data')).some(m=>m.event_data?.battle_id===second),'Cancelled card still in chat');
  const repeated=args(dm,b.id),retry=await Promise.all([request('/rest/v1/rpc/kaidra_battle_create','POST',repeated,a.token),request('/rest/v1/rpc/kaidra_battle_create','POST',repeated,a.token)]);assert(retry.every(r=>r.status===200&&r.data===repeated.request_id));
  await rpc('kaidra_battle_action',{target_battle:repeated.request_id,action:'cancel'},a.token);
  const races=await Promise.all([request('/rest/v1/rpc/kaidra_battle_create','POST',args(dm,b.id),a.token),request('/rest/v1/rpc/kaidra_battle_create','POST',args(group,a.id),b.token)]);assert.equal(races.filter(r=>r.status===200).length,1);assert.equal(races.filter(r=>r.status===400&&r.data.code==='P0001').length,1);
  const win=races.find(r=>r.status===200).data;const owner=(await api('/rest/v1/battles?id=eq.'+win+'&select=challenger_id'))[0].challenger_id;await rpc('kaidra_battle_action',{target_battle:win,action:'cancel'},owner===a.id?a.token:b.token);
  // The opponent may awaken after receiving an invitation; no fake class is inserted.
  const third=await rpc('kaidra_battle_create',args(group,a.id),b.token);await rpc('kaidra_battle_action',{target_battle:third,action:'cancel'},b.token);
  await api('/rest/v1/conversation_participants','POST',{conversation_id:group,user_id:c.id});
  const unawakened=await rpc('kaidra_battle_create',args(group,c.id),b.token);const state=await rpc('kaidra_battle_state',{target_battle:unawakened},b.token);assert.equal(state.status,'pending');assert.equal(state.participants.find(p=>p.id===c.id).identity,null);
  console.log('PASS live creation: existing records preserved, participant-only legacy closure without XP, idempotent retries, descriptive cross-chat conflict, request-ID misuse rejection, outsider privacy, cross-chat expiry, same-request and competing-request races, invitation card cleanup, and invitations before opponent awakening.');
 }
}finally{
 for(const cid of cids)await api('/rest/v1/conversations?id=eq.'+cid,'DELETE');for(const email of planned){const found=await api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');for(const user of found.users.filter(u=>u.email===email))await api('/auth/v1/admin/users/'+user.id,'DELETE');}console.log('Temporary battle-creation users and conversations removed.');
}
