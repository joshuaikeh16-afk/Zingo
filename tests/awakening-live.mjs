import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
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
try{
 const a=await createUser(),b=await createUser();
 await api('/rest/v1/battle_stats','POST',{user_id:a.id,xp:125,battles:3,wins:2,losses:1,streak:2});
 assert.deepEqual(await api(`/rest/v1/battle_stats?user_id=eq.${a.id}`,'GET',null,b.token),[]);
 assert.equal((await rpc('kaidra_profile_social',{target_user:a.id},b.token)).stats,null);
 let state=await rpc('kaidra_awakening_begin',{},a.token),sid=state.session_id;
 assert.equal(state.total,12);assert(!JSON.stringify(state).includes('weights'));
 const denied=async(path,method,body,token)=>assert((await request(path,method,body,token)).status>=400);
 await denied('/rest/v1/rpc/kaidra_awakening_finalize','POST',{target_session:sid,class:'ninja'},a.token);
 await denied('/rest/v1/rpc/kaidra_awakening_answer','POST',{target_session:sid,question_id:'invented',answer_id:'fake'},a.token);
 await denied('/rest/v1/rpc/kaidra_awakening_answer','POST',{target_session:sid,question_id:state.question.id,answer_id:state.question.options[0].id},b.token);
 await denied('/rest/v1/awakening_questions','GET',null,a.token);await denied('/rest/v1/awakening_sessions','GET',null,b.token);
 await denied(`/rest/v1/profiles?id=eq.${a.id}`,'PATCH',{is_banned:true},a.token);
 await api(`/rest/v1/profiles?id=eq.${a.id}`,'PATCH',{bio:'Legitimate profile edit'},a.token);
 state=await rpc('kaidra_awakening_answer',{target_session:sid,question_id:state.question.id,answer_id:state.question.options[0].id},a.token);
 const resumed=await rpc('kaidra_awakening_begin',{},a.token);assert.deepEqual(resumed,state);
 console.log('PASS live private scoring definitions, invalid/foreign submissions, protected profile fields and exact resume.');
 while(!state.identity){
  const args={target_session:sid,question_id:state.question.id,answer_id:state.question.options[0].id};
  if(state.answered===state.total-1){
   // Competing legitimate decisions race; a completed identity must never be overwritten.
   const responses=await Promise.all([request('/rest/v1/rpc/kaidra_awakening_answer','POST',args,a.token),request('/rest/v1/rpc/kaidra_awakening_answer','POST',{...args,answer_id:state.question.options[1].id},a.token)]);
   const accepted=responses.filter(r=>r.status<400);assert(accepted.length);if(accepted.some(r=>r.data.identity))assert(accepted.every(r=>r.data.identity.class_id===accepted[0].data.identity.class_id));state=accepted[0].data;
  }else state=await rpc('kaidra_awakening_answer',args,a.token);
 }
 const classId=state.identity.class_id;assert(['warrior','wizard','ninja','guardian','rogue'].includes(classId));assert(state.total<=14);
 const finals=await Promise.all([rpc('kaidra_awakening_finalize',{target_session:sid},a.token),rpc('kaidra_awakening_finalize',{target_session:sid},a.token)]);assert(finals.every(r=>r.identity.class_id===classId));
 await denied(`/rest/v1/battle_identities?user_id=eq.${a.id}`,'PATCH',{class_id:classId==='ninja'?'wizard':'ninja'},a.token);
 await denied(`/rest/v1/battle_identities?user_id=eq.${a.id}`,'DELETE',null,a.token);
 await denied(`/rest/v1/battle_identities?user_id=eq.${a.id}`,'PATCH',{class_id:'rogue'},b.token);
 await rpc('kaidra_awakening_acknowledge',{},a.token);assert.equal((await rpc('kaidra_awakening_begin',{},a.token)).question,null);
 const publicProfile=await rpc('kaidra_profile_social',{target_user:a.id},b.token),ownProfile=await rpc('kaidra_profile_social',{target_user:a.id},a.token);
 assert.equal(publicProfile.identity.class_id,classId);assert.equal(publicProfile.stats,null);assert.equal(ownProfile.stats.xp,125);assert(!('score_audit' in publicProfile.identity));
 console.log('PASS live concurrent final decisions/finalization, immutable class, acknowledgement, no repeat exam and public class/private XP.');
}finally{
 for(const email of planned){const found=await api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');for(const user of found.users.filter(u=>u.email===email))await api('/auth/v1/admin/users/'+user.id,'DELETE');}
 console.log('Temporary Awakening accounts removed.');
}
