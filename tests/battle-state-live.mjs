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
let cid;
try{
 const a=await createUser(),b=await createUser(),c=await createUser();for(const u of [a,b])await api('/rest/v1/battle_identities','POST',{user_id:u.id,class_id:'warrior',determination_version:1});await api('/rest/v1/friend_requests','POST',{requester_id:a.id,target_id:b.id,status:'accepted'});cid=await rpc('get_or_create_conversation',{other_user_id:b.id},a.token);
 const id=await rpc('kaidra_battle_create',{target_conversation:cid,target_user:b.id,topic:'',stance:'',context:{entry_type:'direct'},request_id:randomUUID()},a.token);
 const first=await request('/rest/v1/rpc/kaidra_battle_state','POST',{target_battle:id},a.token);
 if(process.env.KAIDRA_EXPECT_READ_ONLY==='1'){assert.equal(first.status,405);assert.equal(first.data.code,'25006');console.log('REPRODUCED: HTTP 405 / SQLSTATE 25006: '+first.data.message);}
 else{
 assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.data.id,id);assert.equal(first.data.participants.length,2);assert.equal(first.data.status,'pending');assert(first.data.participants.every(p=>p.identity.class_id==='warrior'));
 const other=await rpc('kaidra_battle_state',{target_battle:id},b.token);assert.equal(other.id,id);assert(other.rewards.every(row=>row.user_id===b.id));
 const outsider=await request('/rest/v1/rpc/kaidra_battle_state','POST',{target_battle:id},c.token);assert(outsider.status>=400);assert.notEqual(outsider.status,405);
 // Legacy expiry updates are part of this RPC's existing contract.
 await api('/rest/v1/battles?id=eq.'+id,'PATCH',{created_at:new Date(Date.now()-172800000).toISOString()});const expired=await rpc('kaidra_battle_state',{target_battle:id},a.token);assert.equal(expired.status,'expired');assert.equal((await rpc('kaidra_combat_state',{target_battle:id},a.token)).combat.phase,'finished');
 console.log('PASS live battle-state POST: both participants, class metadata, reward privacy, outsider rejection, expiry write and closed combat state.');
 }
}finally{
 if(cid)await api('/rest/v1/conversations?id=eq.'+cid,'DELETE');for(const email of planned){const found=await api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');for(const user of found.users.filter(u=>u.email===email))await api('/auth/v1/admin/users/'+user.id,'DELETE');}console.log('Temporary battle-state users and conversation removed.');
}
