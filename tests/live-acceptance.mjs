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
function request(path,method='GET',body=null,token=service){const r=spawnSync('python3',['-c',bridge],{input:JSON.stringify({url:base+path,method,body,token,key:anon}),encoding:'utf8',timeout:50000});if(r.status!==0)throw new Error('HTTP test transport failed');return JSON.parse(r.stdout);}
function api(path,method='GET',body=null,token=service){const r=request(path,method,body,token);assert(r.status<400,`HTTP ${r.status}: ${r.data?.code||r.data?.message||path}`);return r.data;}
const rpc=(name,args,token)=>api('/rest/v1/rpc/'+name,'POST',args,token);
const users=[],chats=[],sockets=[];let acceptanceError;
async function connect(token){let last;for(let attempt=0;attempt<3;attempt++){try{return await connectOnce(token);}catch(error){last=error;sockets.at(-1)?.close();if(attempt<2)await new Promise(done=>setTimeout(done,500));}}throw last;}
async function connectOnce(token){
 const records=[],socket=new WebSocket(`wss://${project}.supabase.co/realtime/v1/websocket?apikey=${anon}&vsn=1.0.0`);sockets.push(socket);
 await new Promise((done,reject)=>{socket.onopen=done;socket.onerror=()=>reject(new Error('Realtime connection failed'));});
 let reference=0,joined=false,live=false,joinError;
 socket.onmessage=({data})=>{const value=JSON.parse(data);if(value.event==='phx_reply'&&value.ref==='1'){if(value.payload.status==='ok')joined=true;else joinError=new Error('Realtime join rejected');}if(value.event==='system'&&value.payload.extension==='postgres_changes'&&value.payload.status==='ok')live=true;if(value.event==='postgres_changes')records.push(value.payload.data);};
 const topic='realtime:qa-'+randomUUID();socket.send(JSON.stringify({topic,event:'phx_join',ref:String(++reference),payload:{config:{broadcast:{self:false},presence:{key:''},postgres_changes:['messages','message_reads','message_reactions','chat_polls','poll_votes','message_pins','chat_signals','user_watchlist','battles','battle_votes','battle_posts','relationships','social_signals','app_notifications'].map(table=>({event:'*',schema:'public',table})),private:false},access_token:token}}));
 const timer=setInterval(()=>socket.readyState===1&&socket.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(++reference)})),15000);socket.addEventListener('close',()=>clearInterval(timer));
 await until(()=>{if(joinError)throw joinError;return joined&&live},'Realtime subscription');return records;
}
async function until(condition,label){const start=Date.now();while(Date.now()-start<20000){if(condition())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timed out: '+label);}
const has=(records,table,id)=>records.some(event=>event.table===table&&(event.record?.id===id||event.record?.message_id===id));
try{
 for(const label of ['A','B','Outside']){
  const suffix=randomBytes(8).toString('hex'),email=`kaidra-qa-${suffix}@example.invalid`,password=randomBytes(24).toString('base64url');
  const user=api('/auth/v1/admin/users','POST',{email,password,email_confirm:true});users.push(user.id);
  const token=api('/auth/v1/token?grant_type=password','POST',{email,password},anon).access_token;
  const payload={username:'qa_'+suffix,display_name:'QA '+label,categories:['movie','anime','football'],genres:['action'],country:'NG',language:'any',providers:[],favorites:[]};
  rpc('kaidra_onboarding_save',{payload,next_stage:1,finish:false},token);assert.equal(api('/rest/v1/onboarding_drafts?select=stage&user_id=eq.'+user.id,'GET',null,token)[0].stage,1);
  rpc('kaidra_onboarding_save',{payload,next_stage:3,finish:true},token);assert.equal(api('/rest/v1/profiles?select=onboarding_completed&id=eq.'+user.id,'GET',null,token)[0].onboarding_completed,true);
  user.token=token;users[users.length-1]=user;
 }
 const [a,b,outside]=users;api('/rest/v1/friend_requests','POST',{requester_id:a.id,target_id:b.id,status:'accepted'});
 assert.deepEqual(api('/rest/v1/onboarding_drafts?select=*','GET',null,outside.token),[]);console.log('PASS live private resumable setup and completed social identities.');
 const ra=await connect(a.token),rb=await connect(b.token),ro=await connect(outside.token);
 for(const [name,args] of [['get_or_create_conversation',{other_user_id:b.id}],['kaidra_create_group',{group_title:'Temporary realtime QA',member_ids:[b.id]}]]){
  const cid=rpc(name,args,a.token);chats.push(cid);
  for(const sender of [a,b]){const id=randomUUID();api('/rest/v1/messages','POST',{id,conversation_id:cid,sender_id:sender.id,content:'Realtime QA '+sender.id,message_type:'text',mention_ids:[]},sender.token);await until(()=>has(ra,'messages',id)&&has(rb,'messages',id),'bidirectional message');assert(!has(ro,'messages',id));}
  rpc('kaidra_mark_read',{target_conversation:cid},b.token);await until(()=>rb.some(e=>e.table==='message_reads'&&e.record?.conversation_id===cid),'read receipt');
  const inbox=rpc('kaidra_inbox',{},b.token);assert.equal(inbox.find(row=>row.conversationId===cid).unreadCount,0);
  console.log('PASS live WebSocket',name.startsWith('get_')?'DM':'group','bidirectional delivery and cleared unread receipts.');
 }
 const cid=chats[1],poll=rpc('kaidra_create_poll',{target_conversation:cid,question:'Which film?',options:['One','Two'],multiple:false,request_id:randomUUID()},a.token);
 await until(()=>has(rb,'chat_polls',poll),'poll creation');const state=rpc('kaidra_chat_state',{target_conversation:cid},b.token);
 rpc('kaidra_vote',{target_message:poll,choices:[state.polls[0].options[0].id]},b.token);await until(()=>has(ra,'poll_votes',poll),'live vote');
 rpc('kaidra_pin',{target_message:poll,pinned:true},a.token);await until(()=>has(rb,'message_pins',poll),'live pin');
 rpc('kaidra_react',{target_message:poll,reaction:'❤️'},b.token);await until(()=>has(ra,'message_reactions',poll),'live reaction');
 console.log('PASS live group poll creation/vote, pin and reaction events.');
 const item={provider:'tmdb',kind:'movie',id:550,title:'QA movie'};for(const collection of ['favorites','watchlist'])rpc('kaidra_library_save',{item,collection,saved:true},a.token);
 await until(()=>ra.some(e=>e.table==='user_watchlist'&&e.record?.external_id==='550'),'library event');
 const path='/rest/v1/user_watchlist?select=provider,media_type,external_id,title,cover_url,snapshot,is_favorite,is_watchlisted&user_id=eq.'+a.id+'&order=created_at.desc';const rows=api(path,'GET',null,a.token);assert.equal(rows.length,1);assert(rows[0].is_favorite&&rows[0].is_watchlisted);assert.deepEqual(api(path,'GET',null,b.token),[]);
 rpc('kaidra_library_save',{item,collection:'favorites',saved:false},a.token);const remaining=api(path,'GET',null,a.token)[0];assert(!remaining.is_favorite&&remaining.is_watchlisted);console.log('PASS exact production library query, independent flags, persistence and private realtime.');
 // Social flows use the same authenticated conversations and live subscriptions.
 const battle=rpc('kaidra_battle_create',{target_conversation:cid,target_user:b.id,topic:'QA friendly opinion',stance:'The first story wins',request_id:randomUUID()},a.token);
 await until(()=>has(rb,'battles',battle),'live challenge');assert.deepEqual(api('/rest/v1/battles?select=id&id=eq.'+battle,'GET',null,outside.token),[]);
 assert(request('/rest/v1/rpc/kaidra_battle_action','POST',{target_battle:battle,action:'accept',value:'Wrong actor'},a.token).status>=400);
 rpc('kaidra_battle_action',{target_battle:battle,action:'accept',value:'The second story wins'},b.token);await until(()=>ra.some(e=>e.table==='battles'&&e.record?.id===battle&&e.record?.status==='active'),'live acceptance');
 rpc('kaidra_battle_action',{target_battle:battle,action:'concede'},b.token);await until(()=>ra.some(e=>e.table==='battles'&&e.record?.id===battle&&e.record?.status==='resolved'),'live result');
 const battleState=rpc('kaidra_battle_state',{target_battle:battle},a.token);assert.equal(battleState.winner_id,a.id);assert(battleState.rewards.every(row=>row.xp===0));
 const relationship=rpc('kaidra_relationship_request',{target_user:b.id,relationship_type:'close_friend',visibility:'public',notify_friends:false,request_id:randomUUID()},a.token);
 await until(()=>has(rb,'relationships',relationship),'private live connection request');assert.deepEqual(rpc('kaidra_profile_social',{target_user:a.id},outside.token).relationships,[]);
 rpc('kaidra_relationship_action',{target_relationship:relationship,action:'accept',visibility:'private',notify_friends:false},b.token);assert.deepEqual(rpc('kaidra_profile_social',{target_user:a.id},outside.token).relationships,[]);
 rpc('kaidra_relationship_action',{target_relationship:relationship,action:'privacy',visibility:'public',notify_friends:false},b.token);const publicConnections=rpc('kaidra_profile_social',{target_user:a.id},outside.token).relationships;assert.equal(publicConnections.length,1);assert(!('conversation_id' in publicConnections[0]));assert.deepEqual(api('/rest/v1/relationships?select=*&id=eq.'+relationship,'GET',null,outside.token),[]);
 rpc('kaidra_relationship_action',{target_relationship:relationship,action:'privacy',visibility:'private',notify_friends:false},a.token);assert.deepEqual(rpc('kaidra_profile_social',{target_user:a.id},outside.token).relationships,[]);
 console.log('PASS live battle invite/accept/result, scoped WebSocket delivery, no concession XP, and private/public relationship consent without raw DM identifiers.');
 // Exercise real deployed providers; returned content never enters the public feed as fixtures.
 for(const category of ['movie','tv','anime']){const content=api('/functions/v1/content-api','POST',{action:'browse',category,page:1},a.token);assert(content.configured&&Array.isArray(content.items)&&content.items.length>0,category+' provider browse');console.log('PASS deployed provider browse:',category,content.items.length,'real titles');}
 const archive=api('/functions/v1/content-api','POST',{action:'browse-meta',category:'anime'},a.token);assert(archive.genres.length&&archive.themes.length&&archive.years.some(row=>row.year<2000));console.log('PASS real anime provider genres, themes and historical season archive.');
 const fixtures=api('/functions/v1/content-api','POST',{action:'fixtures'},a.token);assert(fixtures.configured&&fixtures.matches.length);const fixture=fixtures.matches[0];const match=api('/functions/v1/content-api','POST',{action:'match',id:fixture.id},a.token).match;assert(match.homeId&&match.awayId);const social=rpc('kaidra_match_social',{target_match:match.id},a.token);if(social.locked){assert(request('/rest/v1/rpc/kaidra_match_support','POST',{target_match:match.id,side:'home'},a.token).status>=400);}else{rpc('kaidra_match_support',{target_match:match.id,side:'neutral'},a.token);assert.equal(rpc('kaidra_match_social',{target_match:match.id},a.token).own_support,'neutral');}console.log('PASS real football match normalization, trusted ingest and support state.');
 const signalStart=rb.length;rpc('kaidra_group_action',{target_conversation:cid,action:'remove',target_user:b.id},a.token);
 await until(()=>rb.slice(signalStart).some(e=>e.table==='chat_signals'&&e.record?.user_id===b.id),'membership revocation signal');
 assert.deepEqual(api('/rest/v1/messages?select=id&conversation_id=eq.'+cid,'GET',null,b.token),[]);assert(request('/rest/v1/rpc/kaidra_chat_state','POST',{target_conversation:cid},b.token).status>=400);
 const id=randomUUID();api('/rest/v1/messages','POST',{id,conversation_id:cid,sender_id:a.id,content:'After revocation',message_type:'text',mention_ids:[]},a.token);await until(()=>has(ra,'messages',id),'owner event');await new Promise(r=>setTimeout(r,700));assert(!has(rb,'messages',id));assert(!has(ro,'messages',id));console.log('PASS removed member receives refresh signal, loses private history and receives no subsequent messages.');
}catch(error){acceptanceError=error;throw error;}finally{
 for(const socket of sockets)socket.close();
 let cleanupFailures=0;for(const cid of chats){try{api('/rest/v1/conversations?id=eq.'+cid,'DELETE');}catch{cleanupFailures++;}}
 for(const user of users){try{api('/auth/v1/admin/users/'+(typeof user==='string'?user:user.id),'DELETE');}catch{cleanupFailures++;}}
 if(cleanupFailures){console.error('Temporary fixture cleanup requires attention:',cleanupFailures);if(!acceptanceError)throw new Error('Test fixture cleanup failed');}else console.log('Temporary test accounts and chats removed.');
}
