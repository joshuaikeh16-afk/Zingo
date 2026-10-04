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
let cid;const stored=[];
function rawUpload(bucket,path,bytes,mime,token){return new Promise((resolve,reject)=>{const script=`import sys,json,base64,urllib.request,urllib.error
v=json.load(sys.stdin)
r=urllib.request.Request(v['url'],data=base64.b64decode(v['bytes']),headers={'apikey':v['key'],'Authorization':'Bearer '+v['token'],'Content-Type':v['mime']},method='POST')
try:
 with urllib.request.urlopen(r,timeout=30) as response: print(json.dumps({'status':response.status,'data':json.loads(response.read())}))
except urllib.error.HTTPError as error:
 print(json.dumps({'status':error.code,'data':json.loads(error.read())}))
`;const child=spawn('python3',['-c',script],{stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',v=>output+=v);child.on('error',reject);child.on('close',code=>{try{if(code!==0)throw new Error('Upload transport failed');resolve(JSON.parse(output));}catch(error){reject(error);}});child.stdin.end(JSON.stringify({url:base+'/storage/v1/object/'+bucket+'/'+path,bytes:bytes.toString('base64'),key:anon,token,mime}));});}
try {
 const a=await createUser(),b=await createUser(),c=await createUser();await api('/rest/v1/friend_requests','POST',{requester_id:a.id,target_id:b.id,status:'accepted'});cid=await rpc('kaidra_create_group',{group_title:'Messenger live QA',member_ids:[b.id]},a.token);
 const link=await rpc('kaidra_group_link_manage',{target_conversation:cid,operation:'create'},a.token);let preview=await rpc('kaidra_group_join',{invite_token:link.token},c.token);assert.equal(preview.status,'preview');assert(!preview.members);
 await rpc('kaidra_group_link_manage',{target_conversation:cid,operation:'approval',approval:true},a.token);assert.equal((await rpc('kaidra_group_join',{invite_token:link.token,join_now:true},c.token)).status,'pending');assert.equal((await api('/rest/v1/messages?conversation_id=eq.'+cid,'GET',null,c.token)).length,0);assert((await request('/rest/v1/rpc/kaidra_group_requests','POST',{target_conversation:cid,target_user:c.id,decision:'approve'},c.token)).status>=400);await rpc('kaidra_group_requests',{target_conversation:cid,target_user:c.id,decision:'approve'},a.token);assert.equal((await rpc('kaidra_group_join',{invite_token:link.token},c.token)).status,'member');
 const stickerId=randomUUID(),path=cid+'/'+stickerId+'.png',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');let upload=await rawUpload('chat-media',path,png,'image/png',a.token);assert(upload.status<400,JSON.stringify(upload));stored.push(['chat-media',path]);
 const media=(await api('/rest/v1/messages','POST',{id:stickerId,conversation_id:cid,sender_id:a.id,content:'',message_type:'sticker',media_url:path,media_metadata:{name:'qa.png',size:99,mime:'forged'}},a.token))[0];assert.equal(media.media_metadata.mime,'image/png');assert.equal(media.media_metadata.size,png.length);
 const privatePath=a.id+'/'+randomUUID()+'.png';upload=await rawUpload('user-stickers',privatePath,png,'image/png',a.token);assert(upload.status<400);stored.push(['user-stickers',privatePath]);await api('/rest/v1/user_stickers','POST',{user_id:a.id,label:'QA sticker',path:privatePath},a.token);assert.equal((await api('/rest/v1/user_stickers','GET',null,b.token)).length,0);const forbidden=await request('/storage/v1/object/sign/user-stickers/'+privatePath,'POST',{expiresIn:60},b.token);assert(forbidden.status>=400);
 const docPath=cid+'/'+randomUUID()+'.pdf',pdf=Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\n%%EOF');upload=await rawUpload('chat-media',docPath,pdf,'application/pdf',b.token);assert(upload.status<400,JSON.stringify(upload));stored.push(['chat-media',docPath]);await api('/rest/v1/messages','POST',{conversation_id:cid,sender_id:b.id,content:'',message_type:'document',media_url:docPath,media_metadata:{name:'qa.pdf'}},b.token);assert.equal((await rpc('kaidra_shared_history',{target_conversation:cid,category:'docs'},c.token)).length,1);
 const replacement=await rpc('kaidra_group_link_manage',{target_conversation:cid,operation:'create'},a.token);assert((await request('/rest/v1/rpc/kaidra_group_join','POST',{invite_token:link.token},b.token)).status>=400);await rpc('kaidra_group_link_manage',{target_conversation:cid,operation:'revoke'},a.token);assert((await request('/rest/v1/rpc/kaidra_group_join','POST',{invite_token:replacement.token},c.token)).status>=400);
 console.log('PASS live messenger: approval prevents message access, only admins approve, real private PNG/PDF uploads and trusted metadata, owner-only saved stickers/signed URLs, shared documents and rotating/revoked invites.');
} finally {
 for(const [bucket,path] of stored)await api('/storage/v1/object/'+bucket,'DELETE',{prefixes:[path]});if(cid)await api('/rest/v1/conversations?id=eq.'+cid,'DELETE');for(const user of users)await api('/auth/v1/admin/users/'+user.id,'DELETE');console.log('Temporary messenger users, conversation and media removed.');
}
