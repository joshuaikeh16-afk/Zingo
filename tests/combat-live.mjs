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
const madeChats=[];
try{
 const a=await createUser(),b=await createUser(),outsider=await createUser();
 // Trusted QA provisioning does not alter any real account's permanent identity.
 for(const [u,cls] of [[a,'ninja'],[b,'warrior']])await api('/rest/v1/battle_identities','POST',{user_id:u.id,class_id:cls,determination_version:1});
 await api('/rest/v1/friend_requests','POST',{requester_id:a.id,target_id:b.id,status:'accepted'});
 const cid=await rpc('get_or_create_conversation',{other_user_id:b.id},a.token);madeChats.push(cid);
 const id=await rpc('kaidra_battle_create',{target_conversation:cid,target_user:b.id,topic:'QA combat',stance:'',context:{entry_type:'direct'},request_id:randomUUID()},a.token);
 const denied=async(body,token)=>assert((await request('/functions/v1/combat-api','POST',body,token)).status>=400);
 await denied({action:'state',battle_id:id},outsider.token);
 await rpc('kaidra_battle_action',{target_battle:id,action:'accept'},b.token);
 const combat=(body,token)=>api('/functions/v1/combat-api','POST',{battle_id:id,...body},token);
 let state=await combat({action:'state'},a.token);assert.equal(state.combat.phase,'playing');assert.equal(state.fighters.length,2);assert(!('seed' in state.combat));assert.equal(state.combat.active_id,a.id);
 await denied({action:'act',battle_id:id,ability_id:'slash',target_id:a.id,request_id:randomUUID(),expected_revision:state.combat.revision},b.token);
 await denied({action:'act',battle_id:id,class:'ninja',damage:999,ability_id:'execution',target_id:b.id,request_id:randomUUID(),expected_revision:state.combat.revision},a.token);
 await denied({action:'act',battle_id:id,ability_id:'slash',target_id:b.id,request_id:randomUUID(),expected_revision:state.combat.revision},a.token);
 await denied({action:'act',battle_id:id,ability_id:'shadow_strike',target_id:a.id,request_id:randomUUID(),expected_revision:state.combat.revision},a.token);
 const intent={action:'act',battle_id:id,ability_id:'shadow_strike',target_id:b.id,request_id:randomUUID(),expected_revision:state.combat.revision};
 const results=await Promise.all([request('/functions/v1/combat-api','POST',intent,a.token),request('/functions/v1/combat-api','POST',{...intent,request_id:randomUUID()},a.token)]);assert.equal(results.filter(r=>r.status<400).length,1,JSON.stringify(results.map(r=>({status:r.status,data:r.data?.code}))));
 const accepted=results.find(r=>r.status<400);state=accepted.data;assert.equal(state.combat.revision,intent.expected_revision+1);assert(state.fighters.find(f=>f.user_id===b.id).hp<120);
 const acceptedId=results[0].status<400?intent.request_id:null;
 if(acceptedId){const repeated=await combat(intent,a.token);assert.equal(repeated.combat.revision,state.combat.revision);await denied({...intent,ability_id:'basic'},a.token);}
 console.log('PASS live turn ownership, valid class/target, hidden seed, forged HP/damage rejection and concurrent single-action commit.');
 const tokens=new Map([[a.id,a.token],[b.id,b.token]]);
 while(state.combat.phase==='playing'){
 const actor=state.fighters.find(f=>f.user_id===state.combat.active_id),target=state.fighters.find(f=>f.team!==actor.team),ability=actor.class_id==='ninja'?'shadow_strike':'slash';
 state=await combat({action:'act',ability_id:ability,target_id:target.user_id,request_id:randomUUID(),expected_revision:state.combat.revision},tokens.get(actor.user_id));
 }
 assert.equal(state.battle.status,'resolved');assert.equal(state.combat.winning_team,1);assert(state.fighters.find(f=>f.user_id===b.id).hp===0);
 const own=await rpc('kaidra_combat_history',{},a.token);assert(own.some(x=>x.id===id));assert.deepEqual(await rpc('kaidra_combat_history',{},outsider.token),[]);
 const privateStats=await api('/rest/v1/battle_stats?user_id=eq.'+a.id,'GET',null,b.token);assert.deepEqual(privateStats,[]);
 const before=state.combat.revision;await denied({action:'act',battle_id:id,ability_id:'shadow_strike',target_id:b.id,request_id:randomUUID(),expected_revision:before},a.token);
 assert.equal((await rpc('kaidra_combat_state',{target_battle:id},a.token)).combat.revision,before);
 assert.equal((await rpc('kaidra_profile_social',{target_user:a.id},b.token)).stats,null);
 console.log('PASS live HP victory, finalization, one result, private progression/history and post-result action rejection.');
}finally{
 for(const cid of madeChats)await api('/rest/v1/conversations?id=eq.'+cid,'DELETE');
 for(const email of planned){const found=await api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');for(const user of found.users.filter(u=>u.email===email))await api('/auth/v1/admin/users/'+user.id,'DELETE');}
 console.log('Temporary combat users and conversations removed.');
}
