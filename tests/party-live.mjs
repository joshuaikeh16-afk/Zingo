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
const chats=new Set();
try{
 const [a,b,c,d]=[await createUser(),await createUser(),await createUser(),await createUser()];
 for(const [u,cls]of [[a,'guardian'],[b,'healer'],[c,'ranger'],[d,'berserker']])await api('/rest/v1/battle_identities','POST',{user_id:u.id,class_id:cls,determination_version:1});
 for(const [left,right]of [[a,b],[c,d],[a,c]])await api('/rest/v1/friend_requests','POST',{requester_id:left.id,target_id:right.id,status:'accepted'});
 const pa=await rpc('kaidra_party_create',{party_name:'QA North',request_id:randomUUID()},a.token),pb=await rpc('kaidra_party_create',{party_name:'QA South',request_id:randomUUID()},c.token);
 chats.add((await rpc('kaidra_party_state',{target_party:pa},a.token)).party.conversation_id);chats.add((await rpc('kaidra_party_state',{target_party:pb},c.token)).party.conversation_id);
 await rpc('kaidra_party_invite',{target_party:pa,target_user:b.id},a.token);await rpc('kaidra_party_invite',{target_party:pb,target_user:d.id},c.token);
 await rpc('kaidra_party_action',{target_party:pa,action:'accept'},b.token);await rpc('kaidra_party_action',{target_party:pb,action:'accept'},d.token);
 const args={target_party:pb,own_teammate:b.id,opponents:[c.id,d.id],request_id:randomUUID()},id=await rpc('kaidra_party_challenge',args,a.token);assert.equal(await rpc('kaidra_party_challenge',args,a.token),id);
 const state=await rpc('kaidra_combat_state',{target_battle:id},a.token);chats.add(state.battle.conversation_id);assert.equal(state.fighters.length,4);assert.equal(state.combat.phase,'waiting');const challengeCard=await rpc('kaidra_battle_state',{target_battle:id},a.token);assert.equal(challengeCard.participants.length,4);assert.equal(challengeCard.id,id);
 for(const u of [b,c])await rpc('kaidra_battle_action',{target_battle:id,action:'accept'},u.token);
 assert.equal((await rpc('kaidra_combat_state',{target_battle:id},a.token)).combat.phase,'waiting');await rpc('kaidra_battle_action',{target_battle:id,action:'accept'},d.token);
 let current=await api('/functions/v1/combat-api','POST',{action:'state',battle_id:id},a.token);assert.equal(current.combat.phase,'playing');
 const users=new Map([a,b,c,d].map(u=>[u.id,u]));
 const initial=current.combat.revision;
 const forbidden=await request('/functions/v1/combat-api','POST',{action:'act',battle_id:id,ability_id:'quick_shot',target_id:a.id,request_id:randomUUID(),expected_revision:initial},a.token);assert(forbidden.status>=400);
 for(let i=0;i<4;i++){
  const actor=current.fighters.find(f=>f.user_id===current.combat.active_id),target=current.fighters.find(f=>f.team!==actor.team&&f.hp>0),ability={guardian:'shield_bash',healer:'radiant_strike',ranger:'quick_shot',berserker:'blood_strike'}[actor.class_id];
  current=await api('/functions/v1/combat-api','POST',{action:'act',battle_id:id,ability_id:ability,target_id:target.user_id,request_id:randomUUID(),expected_revision:current.combat.revision},users.get(actor.user_id).token);
 }
 assert.equal(current.combat.revision,initial+4);assert(current.fighters.every(f=>f.turns===1));
 current=await api('/functions/v1/combat-api','POST',{action:'surrender',battle_id:id,request_id:randomUUID(),expected_revision:current.combat.revision},a.token);
 assert.equal(current.combat.phase,'playing');assert.equal(current.fighters.find(f=>f.user_id===a.id).hp,0);assert(current.fighters.find(f=>f.user_id===b.id).hp>0);
 current=await api('/functions/v1/combat-api','POST',{action:'surrender',battle_id:id,request_id:randomUUID(),expected_revision:current.combat.revision},b.token);assert.equal(current.battle.status,'resolved');assert.equal(current.combat.winning_team,2);
 assert.deepEqual(await api('/rest/v1/battle_stats?user_id=eq.'+c.id,'GET',null,a.token),[]);
 console.log('PASS live party invites/membership, idempotent 2v2 challenge, all-four acceptance, balanced four-fighter cycle, own-fighter control, teammate continuing after surrender, team victory and private results.');
}finally{
 for(const cid of chats)await api('/rest/v1/conversations?id=eq.'+cid,'DELETE');
 for(const email of planned){const found=await api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');for(const user of found.users.filter(u=>u.email===email))await api('/auth/v1/admin/users/'+user.id,'DELETE');}
 console.log('Temporary party users and conversations removed.');
}
