import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
// Opt-in: creates temporary users/chats in the linked project, then removes them.
if(process.env.KAIDRA_LIVE_QA!=='1')throw new Error('Set KAIDRA_LIVE_QA=1 to run live acceptance checks. Supabase CLI login required.');
const project='skmlktywdmsbjyybtmhm',base=`https://${project}.supabase.co`;
const keyRun=spawnSync('.tools/supabase/supabase',['projects','api-keys','--project-ref',project,'--reveal','--output','json'],{encoding:'utf8'});
if(keyRun.status!==0)throw new Error('Could not read test credentials');
const keys=JSON.parse(keyRun.stdout),service=keys.find(k=>k.name==='service_role').api_key,anon=keys.find(k=>k.name==='anon').api_key;
const bridge=`import json,sys,urllib.request,urllib.error
v=json.load(sys.stdin)
r=urllib.request.Request(v['url'],data=json.dumps(v['body']).encode() if v['body'] is not None else None,headers={'apikey':v['key'],'Authorization':'Bearer '+v['token'],'Content-Type':'application/json','Prefer':'return=representation'},method=v['method'])
try:
 with urllib.request.urlopen(r,timeout=45) as res:
  b=res.read();print(json.dumps({'status':res.status,'data':json.loads(b) if b else None}))
except urllib.error.HTTPError as e:
 print(json.dumps({'status':e.code,'data':json.loads(e.read())}))
`;
function request(path,method='GET',body=null,token=service){const retry=method==='GET'||method==='DELETE'||path.startsWith('/auth/v1/token');for(let attempt=0;attempt<(retry?3:1);attempt++){const r=spawnSync('python3',['-c',bridge],{input:JSON.stringify({url:base+path,method,body,token,key:anon}),encoding:'utf8',timeout:50000});if(r.status===0)return JSON.parse(r.stdout);}throw new Error('HTTP test transport failed');}
function api(path,method='GET',body=null,token=service){const r=request(path,method,body,token);assert(r.status<400,`HTTP ${r.status}: ${r.data?.code||r.data?.message||path}`);return r.data;}
const rpc=(name,args,token)=>api('/rest/v1/rpc/'+name,'POST',args,token);

const users=[],chats=[],sockets=[],emails=[];
async function until(check,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,75));}throw new Error('Timed out: '+label);}
async function join(token,cid,uid,presence=false,privatePresence=true){
 const socket=new WebSocket(`wss://${project}.supabase.co/realtime/v1/websocket?apikey=${anon}&vsn=1.0.0`);sockets.push(socket);const packets=[];
 await new Promise((done,reject)=>{socket.onopen=done;socket.onerror=()=>reject(new Error('Realtime connection failed'));});
 let ref=0,answer,live=false;const topic=presence?`realtime:typing:${cid}:${rpc("kaidra_chat_state",{target_conversation:cid},users[0].token).conversation.typing_revision}`:`realtime:qa-${randomUUID()}`;
 socket.onmessage=({data})=>{const p=JSON.parse(data);packets.push(p);if(p.event==='phx_reply'&&p.ref==='1')answer=p.payload;if(p.event==='system'&&p.payload.extension==='postgres_changes'&&p.payload.status==='ok')live=true;};
 socket.send(JSON.stringify({topic,event:'phx_join',ref:String(++ref),payload:{config:{private:presence&&privatePresence,broadcast:{self:false},presence:{enabled:presence,key:presence?uid:''},postgres_changes:presence?[]:['messages','message_reads','message_reactions','message_deliveries','chat_signals'].map(table=>({event:'*',schema:'public',table,filter:`conversation_id=eq.${cid}`}))},access_token:token}}));
 const timer=setInterval(()=>{if(socket.readyState===1)socket.send(JSON.stringify({topic:'phoenix',event:'heartbeat',ref:String(++ref),payload:{}}));},15000);socket.addEventListener('close',()=>clearInterval(timer));
 await until(()=>answer&&(answer.status==='error'||presence||live),'channel join');return {answer,packets,send(event,payload){socket.send(JSON.stringify({topic,event,ref:String(++ref),payload}));}};
}
const events=connection=>connection.packets.filter(p=>p.event==='postgres_changes').map(p=>p.payload.data);
try {
 for(const label of ['A','B','C','Outside']){const suffix=randomBytes(8).toString('hex'),email=`kaidra-qa-${suffix}@example.invalid`,password=randomBytes(24).toString('base64url');emails.push(email);let user;try{user=api('/auth/v1/admin/users','POST',{email,password,email_confirm:true});}catch(error){const result=api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');user=result.users?.find(u=>u.email===email);if(!user)throw error;}users.push(user);user.token=api('/auth/v1/token?grant_type=password','POST',{email,password},anon).access_token;api('/rest/v1/profiles','POST',{id:user.id,username:'qa_'+suffix,display_name:'QA '+label});}
 const [a,b,c,outside]=users;api('/rest/v1/friend_requests','POST',[{requester_id:a.id,target_id:b.id,status:'accepted'},{requester_id:a.id,target_id:c.id,status:'accepted'}]);
 const cid=rpc('kaidra_create_group',{group_title:'Temporary Discussion QA',member_ids:[b.id,c.id]},a.token);chats.push(cid);
 if(process.env.KAIDRA_TYPING_ONLY!=='1'){
 const ra=await join(a.token,cid,a.id),rb=await join(b.token,cid,b.id),rc=await join(c.token,cid,c.id),ro=await join(outside.token,cid,outside.id);
 const id=randomUUID();api('/rest/v1/messages','POST',{id,conversation_id:cid,sender_id:a.id,content:'A deliberate Discussion',message_type:'discussion'},a.token);
 await until(()=>[ra,rb,rc].every(r=>events(r).some(e=>e.table==='messages'&&e.record?.id===id)),'discussion received');assert(!events(ro).some(e=>e.record?.id===id));
 const pre=rpc('kaidra_chat_state',{target_conversation:cid,message_ids:[id]},b.token).discussions[0];assert.equal(pre.agree,null);assert.equal(pre.total,0);
 rpc('kaidra_discussion_position',{target_message:id,choice:'agree'},b.token);rpc('kaidra_discussion_position',{target_message:id,choice:'disagree'},b.token);rpc('kaidra_react',{target_message:id,reaction:'😂'},b.token);
 await until(()=>events(ra).some(e=>e.table==='chat_signals'&&e.record?.reason==='discussion')&&events(rc).some(e=>e.table==='chat_signals'&&e.record?.reason==='discussion'),'scoped position invalidation');
 const refresh=rpc('kaidra_chat_state',{target_conversation:cid,message_ids:[id]},b.token);assert.equal(refresh.discussions[0].total,1);assert.equal(refresh.discussions[0].own_position,'disagree');assert(refresh.reactions.some(r=>r.emoji==='😂'&&r.user_id===b.id));assert.equal(rpc('kaidra_chat_state',{target_conversation:cid,message_ids:[id]},c.token).discussions[0].agree,null);
 rpc('kaidra_discussion_position',{target_message:id,choice:'agree'},c.token);assert.equal(rpc('kaidra_chat_state',{target_conversation:cid,message_ids:[id]},b.token).discussions[0].total,2);console.log('PASS live Discussion persistence/switch, independent reaction, scoped group realtime and hidden split.');
 rpc('kaidra_message_ack',{target_conversation:cid,message_ids:[id],seen:false},b.token);await until(()=>events(ra).some(e=>e.table==='message_deliveries'&&e.record?.message_id===id&&e.record?.delivered_at),'delivered acknowledgement');assert(!rpc('kaidra_chat_state',{target_conversation:cid,message_ids:[id]},a.token).reads.some(r=>r.message_id===id));rpc('kaidra_message_ack',{target_conversation:cid,message_ids:[id],seen:true},b.token);await until(()=>events(ra).some(e=>e.table==='message_reads'&&e.record?.message_id===id),'seen acknowledgement');const receipts=rpc('kaidra_chat_state',{target_conversation:cid,message_ids:[id]},a.token);assert.equal(receipts.deliveries.filter(r=>r.message_id===id).length,2);assert.equal(receipts.reads.filter(r=>r.message_id===id).length,1);console.log('PASS live persisted sent/delivered/read distinction and per-recipient group receipts.');
 const direct=rpc('kaidra_battle_create',{target_conversation:cid,target_user:c.id,topic:'Friendly flavour',stance:'',context:{entry_type:'direct'},request_id:randomUUID()},a.token);assert(request('/rest/v1/rpc/kaidra_battle_action','POST',{target_battle:direct,action:'accept'},a.token).status>=400);assert(request('/rest/v1/rpc/kaidra_battle_action','POST',{target_battle:direct,action:'accept'},b.token).status>=400);rpc('kaidra_battle_action',{target_battle:direct,action:'accept'},c.token);assert.equal(rpc('kaidra_battle_state',{target_battle:direct},a.token).challenged_position,null);
 const contextual=rpc('kaidra_battle_create',{target_conversation:cid,target_user:b.id,topic:'',stance:'',context:{entry_type:'discussion',discussion_message_id:id},request_id:randomUUID()},a.token);assert.equal(rpc('kaidra_battle_state',{target_battle:contextual},b.token).discussion_message_id,id);rpc('kaidra_battle_action',{target_battle:contextual,action:'accept'},b.token);console.log('PASS live direct and contextual references with invited-user-only acceptance.');
 }
 const pa=await join(a.token,cid,a.id,true),pb=await join(b.token,cid,b.id,true),po=await join(outside.token,cid,outside.id,true);assert.equal(pa.answer.status,'ok',JSON.stringify(pa.answer));assert.equal(pb.answer.status,'ok',JSON.stringify(pb.answer));assert.equal(po.answer.status,'error');
 pa.send('presence',{type:'presence',event:'track',payload:{typing:true,until:Date.now()+4500}});await until(()=>pb.packets.some(p=>p.event==='presence_diff'&&p.payload.joins?.[a.id]?.metas?.some(m=>m.typing)),'private typing presence');pa.send('presence',{type:'presence',event:'untrack',payload:{}});await until(()=>pb.packets.some(p=>p.event==='presence_diff'&&p.payload.leaves?.[a.id]),'typing stop');const publicOutside=await join(outside.token,cid,outside.id,true,false);pa.send('presence',{type:'presence',event:'track',payload:{typing:true,until:Date.now()+4500}});await new Promise(r=>setTimeout(r,500));assert(!publicOutside.packets.some(p=>p.event==='presence_diff'&&p.payload.joins?.[a.id]));
 const before=pb.packets.length;rpc('kaidra_group_action',{target_conversation:cid,action:'remove',target_user:b.id},a.token);const nextA=await join(a.token,cid,a.id,true),nextC=await join(c.token,cid,c.id,true),removed=await join(b.token,cid,b.id,true);assert.equal(removed.answer.status,'error');nextA.send('presence',{type:'presence',event:'track',payload:{typing:true,until:Date.now()+4500}});await until(()=>nextC.packets.some(p=>p.event==='presence_diff'&&p.payload.joins?.[a.id]),'typing after topic rotation');assert(!pb.packets.slice(before).some(p=>p.event==='presence_diff'&&p.payload.joins?.[a.id]));
 console.log('PASS live private typing/stop, outsider and public-channel isolation, and removal topic rotation.');
} finally {
 for(const socket of sockets)socket.close();let failed=0;
 for(const cid of chats)try{api('/rest/v1/conversations?id=eq.'+cid,'DELETE');}catch{failed++;}
 for(const email of emails){try{const listed=api('/auth/v1/admin/users?filter='+encodeURIComponent(email)+'&per_page=1000');for(const user of listed.users.filter(u=>u.email===email))api('/auth/v1/admin/users/'+user.id,'DELETE');}catch{failed++;}}
 if(failed)throw new Error('Temporary fixture cleanup needs attention');console.log('Temporary Discussion QA users/chats removed.');
}
