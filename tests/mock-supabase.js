// Served only by tests/browser-smoke.mjs. Never imported by the production app.
const me = '00000000-0000-4000-8000-000000000001';
const alice = '00000000-0000-4000-8000-000000000002';
const bob = '00000000-0000-4000-8000-000000000003';
const a = '00000000-0000-4000-8000-000000000004';
const b = '00000000-0000-4000-8000-000000000005';
const now = new Date().toISOString();
const db = {
  profiles: [{ id: me, username: 'josh', display_name: 'Josh', interests: ['movie','action','football'], recommendation_preferences: {content_types:['movie','tv'],genres:['action'],country:'NG'}, profile_template: 'midnight' }, { id: alice, username: 'alice', display_name: 'Alice <img src=x onerror=alert(1)>', interests:['movie','comedy'] }, { id: bob, username: 'bob', display_name: 'Bob', interests:['football'] }, { id: 'new-person', username: 'sam', display_name: 'Sam' }],
  friend_requests: [{ id: 'f1', requester_id: me, target_id: alice, status: 'accepted', created_at: now }, { id: 'f2', requester_id: me, target_id: bob, status: 'accepted', created_at: now }],
  conversation_participants: [{ conversation_id: a, user_id: me }, { conversation_id: a, user_id: alice }, { conversation_id: b, user_id: me }, { conversation_id: b, user_id: bob }],
  messages: [{ id: 'm1', conversation_id: a, sender_id: alice, content: 'Any recommendations tonight?', created_at: now, message_type: 'text', read_at: null }, { id: 'm2', conversation_id: b, sender_id: bob, content: 'Ready for the match?', created_at: now, message_type: 'text', read_at: null }],
  user_preferences: [{ user_id: me, allow_dms: true }], sports_alert_settings: [], app_notifications: [], sports_events: [],
  battle_identities:[{user_id:me,class_id:'warrior',acknowledged:true},{user_id:alice,class_id:'wizard',acknowledged:true}],battle_stats:[],awakening_session:null,
  conversations: [{id:a,is_group:false,typing_revision:1},{id:b,is_group:false,typing_revision:1}], message_reactions: [], message_reads: [], user_watchlist: [], chat_polls: [], poll_votes: [], message_pins: [], chat_signals: [], onboarding_drafts: [], social_preferences:[],user_blocks:[],discussion_positions:[],message_deliveries:[],battles:[],relationships:[],relationship_types:[{key:"close_friend",label:"Close friends",active:true},{key:"partner",label:"Partners",active:true}],
};
try { const saved=JSON.parse(sessionStorage.getItem('qa:db')); if(saved)Object.assign(db,saved); } catch {}
function persist(){sessionStorage.setItem('qa:db',JSON.stringify(db));}
const channels = new Set();
const control = { db, me, alice, bob, a, b, failNextSend: false, delayConversation: null, failCatalog: false, failFixtures: false, unconfiguredFixtures: false, calls: [] };
control.uploads = []; const media = new Map();
window.__mock = control;
function emit(table, event, row) {
  for (const channel of channels) for (const entry of channel.listeners) {
    if (entry.type !== 'postgres_changes' || entry.filter.table !== table || !['*',event].includes(entry.filter.event)) continue;
    const filter = entry.filter.filter;
    if (filter) { const [key, value] = filter.split('=eq.'); if (row[key] !== value) continue; }
    queueMicrotask(() => { if (channels.has(channel)) entry.callback({ new: structuredClone(row), eventType: event, table }); });
  }
}
control.emit = emit; control.persist = persist;
const identity=uid=>db.battle_identities.find(row=>row.user_id===uid)||null;
function awakeningState(){const s=db.awakening_session;return {session_id:s?.id,version:1,total:s?.total||12,answered:s?.answers.length||0,identity:identity(me),question:identity(me)?null:{id:`q${s.answers.length+1}`,prompt:`A shared plan changes unexpectedly. What comes naturally? (Scenario ${s.answers.length+1})`,options:[{id:'consider',text:'Compare the new information before committing.'},{id:'adapt',text:'Try a reversible change and adjust to the response.'},{id:'steady',text:'Keep the group grounded through the next step.'},{id:'commit',text:'Take responsibility for a clear next step.'},{id:'opening',text:'Look for an overlooked possibility.'}]}};}
function pieces(text) { let depth=0, start=0; const result=[]; for(let i=0;i<text.length;i++) { if(text[i]==='(')depth++;if(text[i]===')')depth--;if(text[i]===','&&!depth){result.push(text.slice(start,i));start=i+1;} } result.push(text.slice(start)); return result; }
function expression(row, text) {
  if (text.startsWith('and(')) return pieces(text.slice(4,-1)).every((item)=>expression(row,item));
  const [,key,op,value]=text.match(/^([^.]+)\.([^.]+)\.(.*)$/)||[];
  if(op==='eq')return String(row[key])===value;
  if(op==='ilike')return String(row[key] || '').toLowerCase().includes(value.replaceAll('%', '').replaceAll('\\_', '_').toLowerCase());
  if(op==='lt')return row[key]<value;
  if(op==='lte')return row[key]<=value;
  return false;
}
class Query {
  constructor(table) { this.table=table;this.filters=[];this.orders=[];this.op='select'; }
  select(fields='*', options={}) { this.fields=fields;this.options=options; return this; }
  eq(key,value){this.filters.push(row=>row[key]===value);return this;}
  neq(key,value){this.filters.push(row=>row[key]!==value);return this;}
  in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
  is(key,value){this.filters.push(row=>(row[key]??null)===value);return this;}
  gt(key,value){this.filters.push(row=>row[key]>value);return this;}
  gte(key,value){this.filters.push(row=>row[key]>=value);return this;}
  lt(key,value){this.filters.push(row=>row[key]<value);return this;}
  or(value){this.filters.push(row=>pieces(value).some(item=>expression(row,item)));return this;}
  ilike(key,value){this.filters.push(row=>String(row[key]).toLowerCase().includes(value.replaceAll('%','').toLowerCase()));return this;}
  order(key,options={}){this.orders.push([key,options.ascending!==false]);return this;}
  range(start,end){this.start=start;this.count=end-start+1;return this;}
  limit(count){this.count=count;return this;}
  single(){this.one=true;return this;}
  maybeSingle(){this.one=true;return this;}
  insert(value){this.op='insert';this.value=value;return this;}
  upsert(value){this.op='upsert';this.value=value;return this;}
  update(value){this.op='update';this.value=value;return this;}
  delete(){this.op='delete';return this;}
  then(resolve,reject){return this.run().then(resolve,reject);}
  async run(){
    if(this.table==='user_watchlist'&&this.op==='select'){
      control.libraryQueries=(control.libraryQueries||0)+1;
      if(control.failLibraryLoad)return {data:null,error:{...control.failLibraryLoad},status:control.failLibraryLoad.status};
    }
    const table=db[this.table]||[];
    let rows=table.filter(row=>this.filters.every(fn=>fn(row)));
    if(this.op==='insert'||this.op==='upsert'){
      if(this.table==='messages'&&control.failNextSend){control.failNextSend=false;return {data:null,error:{message:'Offline'}};}
      const inserted=[];
      for(const value of Array.isArray(this.value)?this.value:[this.value]){
        const existing=table.find(row=>value.id?row.id===value.id:(row.user_id&&row.user_id===value.user_id));
        if(existing&&this.op==='insert')return {data:null,error:{code:'23505',message:'Duplicate'}};
        if(existing){Object.assign(existing,value);emit(this.table,'UPDATE',existing);inserted.push(existing);}
        else {const row={id:crypto.randomUUID(),created_at:new Date().toISOString(),read_at:null,...value};table.push(row);emit(this.table,'INSERT',row);inserted.push(row);}
      }
      rows=inserted;
    }else if(this.op==='update'){
      rows.forEach(row=>{Object.assign(row,this.value);emit(this.table,'UPDATE',row);});
    }else if(this.op==='delete')db[this.table]=table.filter(row=>!rows.includes(row));
    rows.sort((a,b)=>{for(const [key,ascending]of this.orders){const delta=String(a[key]||'').localeCompare(String(b[key]||''));if(delta)return ascending?delta:-delta;}return 0;});
    const count=rows.length;
    if(this.count!=null)rows=rows.slice(this.start||0,(this.start||0)+this.count);
    const result={data:this.options?.head?null:structuredClone(this.one?rows[0]||null:rows),error:null,count};
    if(this.table==='user_watchlist'&&control.delayLibrary)await new Promise(resolve=>setTimeout(resolve,control.delayLibrary));
    if(this.table==='messages'&&this.op==='select'&&this.fields==='*'&&control.delayConversation&&rows.some(row=>row.conversation_id===control.delayConversation))await new Promise(resolve=>setTimeout(resolve,700));
    if(this.op!=='select')persist();
    return result;
  }
}
function channel(name){
  const instance={name,listeners:[],presenceState(){return this.presence||{};},async track(data){control.typingTracks ||= [];control.typingTracks.push(data);},async untrack(){control.typingStopped=true;},on(type,filter,callback){this.listeners.push({type,filter,callback});return this;},subscribe(callback){channels.add(this);this.status=callback;setTimeout(()=>{if(channels.has(this)){callback?.('SUBSCRIBED');for(const entry of this.listeners)if(entry.type==='system')entry.callback({extension:'postgres_changes',status:'ok'});}},10);return this;}};
  return instance;
}
control.typing=(id)=>{for(const ch of channels)if(ch.name.startsWith(`typing:${id}:`)){ch.presence={[alice]:[{typing:true,until:Date.now()+1500}]};ch.listeners.filter(l=>l.type==='presence').forEach(l=>l.callback());}};
control.reconnect=()=>{for(const item of channels)item.status?.('SUBSCRIBED');};
export function createClient(){return {
  auth:{getSession:async()=>({data:{session:sessionStorage.getItem('qa:signed-out')==='true'?null:{user:{id:me}}}}),getUser:async()=>({data:{user:{id:me}}}),signOut:async()=>{sessionStorage.setItem('qa:signed-out','true');return {error:null};},signInWithPassword:async()=>{sessionStorage.removeItem('qa:signed-out');return {data:{session:{user:{id:me}}},error:null};},signUp:async()=>{control.signupCalls=(control.signupCalls||0)+1;await new Promise(resolve=>setTimeout(resolve,150));return {data:{session:null},error:null};},resend:async()=>{control.resendCalls=(control.resendCalls||0)+1;return {error:null};},resetPasswordForEmail:async()=>({error:null}),signInWithOAuth:async()=>({error:{message:'OAuth is not configured in this test.'}}),updateUser:async()=>({error:null}),onAuthStateChange:callback=>{if(location.pathname==='/reset-password.html'&&location.search.includes('qa-recovery'))setTimeout(()=>callback('PASSWORD_RECOVERY',{user:{id:me}}),30);return {data:{subscription:{unsubscribe(){}}}};}},
  from:(table)=>new Query(table),channel,removeChannel:async(value)=>channels.delete(value),
  rpc:async(name,args={})=>{
    if(control.missingGroups && name.startsWith('kaidra_') && !['kaidra_mark_read','kaidra_inbox'].includes(name))return {data:null,error:{code:'PGRST202'}};
    let data=true;
    if(name==='kaidra_username_available')data=!db.profiles.some(row=>row.id!==me&&row.username.toLowerCase()===args.candidate.toLowerCase());
    if(name==='kaidra_onboarding_save') {
      if(control.failOnboarding)return {error:{message:'Offline'}};
      if(args.finish){let profile=db.profiles.find(row=>row.id===me);if(!profile){profile={id:me};db.profiles.push(profile);}Object.assign(profile,{username:args.payload.username,display_name:args.payload.display_name,avatar_url:args.payload.avatar_url,interests:[...args.payload.categories,...args.payload.genres],onboarding_completed:true,recommendation_preferences:{content_types:args.payload.categories.filter(x=>x!=='football'),genres:args.payload.genres,country:args.payload.country,language:args.payload.language,favorites:args.payload.favorites}});db.onboarding_drafts=db.onboarding_drafts.filter(row=>row.user_id!==me);}
      else {let row=db.onboarding_drafts.find(row=>row.user_id===me);if(!row){row={user_id:me};db.onboarding_drafts.push(row);}Object.assign(row,{stage:args.next_stage,draft:args.payload,updated_at:new Date().toISOString()});}
    }

    if(name==='kaidra_contact_allowed')data=!db.user_blocks.some(row=>row.user_id===me&&row.blocked_user===args.target_user);
    if(name==='kaidra_block'){db.user_blocks=db.user_blocks.filter(row=>row.blocked_user!==args.target_user);if(args.blocked)db.user_blocks.push({user_id:me,blocked_user:args.target_user});}
    if(name==='kaidra_profile_social')data={identity:identity(args.target_user),stats:args.target_user===me?db.battle_stats.find(s=>s.user_id===me)||null:null,relationships:db.relationships.filter(row=>[row.requester_id,row.target_id].includes(args.target_user)).map(row=>({...row,own_visibility:'private',partner:db.profiles.find(p=>p.id===(row.requester_id===me?row.target_id:row.requester_id))}))};
    if(name==='kaidra_battle_identity')data=identity(args.target_user||me);
    if(name==='kaidra_awakening_progress')data={identity:identity(me),answered:db.awakening_session?.answers.length||0};
    if(name==='kaidra_awakening_begin'){if(identity(me))data={identity:identity(me),question:null};else{db.awakening_session ||= {id:crypto.randomUUID(),answers:[],total:12};data=awakeningState();}}
    if(name==='kaidra_awakening_answer'){const s=db.awakening_session;if(identity(me))data=awakeningState();else{if(args.question_id!==`q${s.answers.length+1}`)return {error:{message:'Invalid question'}};s.answers.push(args.answer_id);if(s.answers.length===12)s.total=14;if(s.answers.length===14)db.battle_identities.push({user_id:me,class_id:control.revealClass||'ninja',acknowledged:false});data=awakeningState();}}
    if(name==='kaidra_awakening_acknowledge')identity(me).acknowledged=true;
    if(name==='kaidra_social_recommendations')data=control.socialPicks||[];
    if(name==='kaidra_title_social')data={count:0,friends:[]};
    if(name==='kaidra_social_settings'){db.social_preferences=[{user_id:me,activity_visibility:args.visibility,notifications:args.notifications}];}
    if(name==='kaidra_match_social')data={own_support:control.ownSupport||null,locked:!control.liveMatch,friends:[]};
    if(name==='kaidra_match_support')control.ownSupport=args.side;
    if(name==='kaidra_battle_create'){data=args.request_id;db.battles.push({type:args.context?.entry_type||'opinion',flavour_text:args.topic,discussion_message_id:args.context?.discussion_message_id,id:data,conversation_id:args.target_conversation,challenger_id:me,challenged_id:args.target_user,challenger_position:args.stance,topic:args.topic,status:'pending',created_at:now});}
    if(name==='kaidra_battle_state'){const row=db.battles.find(row=>row.id===args.target_battle);data={...row,participants:[row.challenger_id,row.challenged_id].map(id=>({...db.profiles.find(p=>p.id===id),identity:identity(id)})),votes:[],posts:[],rewards:[]};}
    if(name==='kaidra_battle_action'){const battle=db.battles.find(row=>row.id===args.target_battle);if(args.action==='cancel')battle.status='cancelled';if(args.action==='accept'){battle.status='active';battle.ends_at=new Date(Date.now()+86400000).toISOString();}}
    if(name==='kaidra_relationship_request'){data=args.request_id;db.relationships.push({id:data,type:args.relationship_type,label:db.relationship_types.find(t=>t.key===args.relationship_type).label,requester_id:me,target_id:args.target_user,status:'pending',created_at:now});}
    if(name==='get_or_create_conversation')data=args.other_user_id===alice?a:b;
    if(name==='kaidra_library_save') {
      if(control.failLibrary)return {error:{message:'Offline'}};
      const item=args.item,kind=item.kind||item.type,id=String(kind==='article'?item.url:item.id);
      const provider=item.provider||({movie:'tmdb',tv:'tmdb',anime:'mal',manga:'mal',article:'news',match:'football-data'})[kind];
      let row=db.user_watchlist.find(row=>row.external_id===id&&row.media_type===kind&&row.provider===provider);
      if(!row){row={user_id:me,provider,external_id:id,media_type:kind,title:item.title,cover_url:item.image,snapshot:item,is_favorite:false,is_watchlisted:false};db.user_watchlist.push(row);}
      row[args.collection==='favorites'?'is_favorite':'is_watchlisted']=args.saved;data=row;emit('user_watchlist','UPDATE',row);
    }
    if(name==='kaidra_discussion_position'){const m=db.messages.find(m=>m.id===args.target_message);let vote=db.discussion_positions.find(v=>v.discussion_message_id===m.id&&v.user_id===me);if(!vote){vote={discussion_message_id:m.id,user_id:me,conversation_id:m.conversation_id};db.discussion_positions.push(vote);}vote.position=args.choice;m.discussion_locked_at=now;emit('chat_signals','UPDATE',{user_id:me,conversation_id:m.conversation_id});}
    if(name==='kaidra_message_ack'){if(args.seen&&control.failMarkRead)return {data:null,error:{code:'42501',message:'Read update denied'}};for(const id of args.message_ids){const m=db.messages.find(m=>m.id===id);if(!m||m.sender_id===me)continue;let delivery=db.message_deliveries.find(v=>v.message_id===id&&v.user_id===me);if(!delivery){delivery={message_id:id,user_id:me,conversation_id:args.target_conversation};db.message_deliveries.push(delivery);}delivery.delivered_at=now;if(args.seen){if(!db.message_reads.some(v=>v.message_id===id&&v.user_id===me))db.message_reads.push({message_id:id,user_id:me,conversation_id:args.target_conversation});if(!db.conversations.find(v=>v.id===args.target_conversation)?.is_group){m.read_at=now;emit('messages','UPDATE',m);}}}}
    if(name==='kaidra_message_change'){const m=db.messages.find(m=>m.id===args.target_message);if(args.action==='delete'){m.deleted_at=now;m.content='';}else{m.content=args.body;m.edited_at=now;}emit('messages','UPDATE',m);}
    if(name==='kaidra_chat_state'){
      const id=args.target_conversation;
      if(!db.conversation_participants.some(row=>row.conversation_id===id&&row.user_id===me))return {error:{message:'Membership required'}};
      const discussions=db.messages.filter(m=>m.conversation_id===id&&m.message_type==='discussion').map(m=>{const votes=db.discussion_positions.filter(v=>v.discussion_message_id===m.id),own=votes.find(v=>v.user_id===me);return {message_id:m.id,total:votes.length,own_position:own?.position,agree:own?votes.filter(v=>v.position==='agree').length:null,disagree:own?votes.filter(v=>v.position==='disagree').length:null,locked:!!m.discussion_locked_at,dm_response:votes.length?{name:db.profiles.find(p=>p.id===votes[0].user_id)?.display_name,position:votes[0].position}:null,opponents:own?.position==='disagree'?[{id:m.sender_id,name:'Alice'}]:[]};});
      data={discussions,deliveries:db.message_deliveries.filter(v=>v.conversation_id===id),conversation:db.conversations.find(row=>row.id===id),members:db.conversation_participants.filter(row=>row.conversation_id===id).map(row=>({...db.profiles.find(profile=>profile.id===row.user_id),role:row.role||'participant',muted:row.muted||false})),reactions:db.message_reactions.filter(row=>row.conversation_id===id),reads:db.message_reads.filter(row=>db.messages.some(message=>message.id===row.message_id&&message.conversation_id===id)),polls:db.chat_polls.filter(row=>row.conversation_id===id).map(row=>({...row,votes:db.poll_votes.filter(vote=>vote.message_id===row.message_id)})),pins:db.message_pins.filter(row=>row.conversation_id===id&&row.is_pinned).map(pin=>db.messages.find(row=>row.id===pin.message_id)),quotes:db.messages.filter(row=>row.conversation_id===id)};
    }
    if(name==='kaidra_create_group'){data=crypto.randomUUID();db.conversations.push({id:data,title:args.group_title,is_group:true,typing_revision:1,created_by:me,permissions:{edit_info:'admins',add_people:'admins',send_messages:'everyone',create_polls:'everyone'}});db.conversation_participants.push(...[me,...args.member_ids].map(user_id=>({conversation_id:data,user_id,role:user_id===me?'owner':'participant'})));}
    if(name==='kaidra_group_action') {
      const cid=args.target_conversation,c=db.conversations.find(row=>row.id===cid),target=db.conversation_participants.find(row=>row.conversation_id===cid&&row.user_id===args.target_user);
      if(args.action==='info')Object.assign(c,args.details);
      if(args.action==='permissions')Object.assign(c.permissions,args.details);
      if(args.action==='promote')target.role='admin';if(args.action==='demote')target.role='participant';
      if(args.action==='transfer'){db.conversation_participants.find(row=>row.conversation_id===cid&&row.user_id===me).role='admin';target.role='owner';c.created_by=target.user_id;}
      if(args.action==='mute')db.conversation_participants.find(row=>row.conversation_id===cid&&row.user_id===me).muted=args.details.muted;
      if(args.action==='remove'||args.action==='leave')db.conversation_participants=db.conversation_participants.filter(row=>row.conversation_id!==cid||row.user_id!==(args.action==='leave'?me:args.target_user));
      if(args.action==='delete')db.conversations=db.conversations.filter(row=>row.id!==cid);
      emit('conversations','UPDATE',c);
    }
    if(name==='kaidra_create_poll'){
      data=args.request_id;const message={id:data,conversation_id:args.target_conversation,sender_id:me,message_type:'poll',content:args.question,created_at:new Date().toISOString()};
      db.messages.push(message);db.chat_polls.push({message_id:data,conversation_id:args.target_conversation,question:args.question,options:args.options.map(label=>({id:crypto.randomUUID(),label})),multiple:args.multiple});emit('messages','INSERT',message);
    }
    if(name==='kaidra_vote') {let vote=db.poll_votes.find(row=>row.message_id===args.target_message&&row.user_id===me);if(!vote){vote={message_id:args.target_message,user_id:me,conversation_id:db.messages.find(row=>row.id===args.target_message).conversation_id};db.poll_votes.push(vote);}vote.choice_ids=args.choices;emit('poll_votes','UPDATE',vote);}
    if(name==='kaidra_pin'){let pin=db.message_pins.find(row=>row.message_id===args.target_message);if(!pin){pin={message_id:args.target_message,conversation_id:db.messages.find(row=>row.id===args.target_message).conversation_id};db.message_pins.push(pin);}pin.is_pinned=args.pinned;emit('message_pins','UPDATE',pin);}
    if(name==='kaidra_shared_history') data=db.messages.filter(row=>row.conversation_id===args.target_conversation&&(args.category==='entertainment'?row.shared_content:args.category==='media'?['image','voice_note'].includes(row.message_type):row.content?.includes('https://'))).slice(0,30);
    if(name==='kaidra_add_group_members')db.conversation_participants.push(...args.member_ids.map(user_id=>({conversation_id:args.target_conversation,user_id,role:'participant'})));
    if(name==='kaidra_leave_group')db.conversation_participants=db.conversation_participants.filter(row=>row.conversation_id!==args.target_conversation||row.user_id!==me);
    if(name==='kaidra_react'){const message=db.messages.find(row=>row.id===args.target_message);let row=db.message_reactions.find(row=>row.message_id===message.id&&row.user_id===me);if(!row){row={message_id:message.id,user_id:me,conversation_id:message.conversation_id};db.message_reactions.push(row);}row.emoji=row.emoji===args.reaction?null:args.reaction;emit('message_reactions','UPDATE',row);}
    if(name==='kaidra_mark_read'){
      if(control.failMarkRead)return {data:null,error:{code:'42501',message:'Read update denied'}};
      for(const message of db.messages.filter(row=>row.conversation_id===args.target_conversation&&row.sender_id!==me&&(!args.through_created_at||row.created_at<=args.through_created_at))){if(!db.message_reads.some(row=>row.message_id===message.id&&row.user_id===me)){const receipt={message_id:message.id,user_id:me,conversation_id:message.conversation_id};db.message_reads.push(receipt);emit('message_reads','INSERT',receipt);if(!db.conversations.find(row=>row.id===message.conversation_id)?.is_group){message.read_at=now;emit('messages','UPDATE',message);}}}
    }
    if(name==='kaidra_inbox')data=db.conversations.filter(row=>db.conversation_participants.some(member=>member.conversation_id===row.id&&member.user_id===me)).map(row=>{const messages=db.messages.filter(message=>message.conversation_id===row.id).sort((a,b)=>b.created_at.localeCompare(a.created_at));return {conversationId:row.id,isGroup:row.is_group,profile:row.is_group?{id:row.id,display_name:row.title,username:'group'}:db.profiles.find(profile=>db.conversation_participants.some(member=>member.conversation_id===row.id&&member.user_id!==me&&member.user_id===profile.id)),lastMessage:messages[0]||null,unreadCount:messages.filter(message=>message.sender_id!==me&&!db.message_reads.some(read=>read.message_id===message.id&&read.user_id===me)).length};}).sort((a,b)=>(b.lastMessage?.created_at||'').localeCompare(a.lastMessage?.created_at||''));
    persist(); return {data:structuredClone(data),error:null};
  },
  functions:{invoke:async(name,{body})=>{
    control.calls.push(body);
    if(['catalog','browse'].includes(body.action)){const page=body.page||1;return control.failCatalog||(control.failCatalogAfterPageOne&&page>1)?{error:{message:'Unavailable'}}:{data:{configured:!control.unconfiguredCatalog,page,hasMore:!control.emptyCatalog&&!control.unconfiguredCatalog&&page<3,context:body.action==='browse'?'Browse the catalogue · independent of your Home tastes':'Based on your interests',items:control.emptyCatalog||control.unconfiguredCatalog?[]:Array.from({length:6},(_,i)=>({id:i+1+(page-1)*6,provider:body.category==='anime'?'mal':'tmdb',type:body.category==='anime'?'anime':body.category==='tv'?'tv':'movie',kind:body.category==='anime'?'anime':body.category==='tv'?'tv':'movie',title:page===1?['The Last Horizon','City of Echoes','A Different Summer','After Midnight','Wild Hearts','The Long Way Home'][i]:`Another great story ${i+1+(page-1)*6}`,subtitle:'A story worth discussing with your friends.',image:'/tests/artwork.svg',backdrop:body.category==='anime'&&control.animeCoversOnly?null:'/tests/artwork.svg',date:'2026-01-01',rating:8,reason:'Because you like adventure'}))}};}
    if(body.action==='browse-meta')return {data:{category:body.category,genres:[{id:1,name:'Action'},{id:7,name:'Mystery'}],themes:body.category==='anime'?[{id:40,name:'Psychological'},{id:19,name:'Music'}]:[],years:body.category==='anime'?[{year:2030,seasons:['winter']},{year:2026,seasons:['winter','spring','summer','fall']},{year:1980,seasons:['winter','fall']}]:[]}};
    if(body.action==='football-meta')return {data:{clubs:[{id:10,name:'Home team'},{id:20,name:'Away team'}]}};
    if(body.action==='anime-detail')return {data:{configured:true,id:body.id,kind:'anime',provider:'mal',title:'Anime story',image:'/tests/artwork.svg',genres:['Action'],themes:['Psychological'],streaming:[]}};
    if(body.action==='providers')return {data:{configured:true,providers:[{name:'Netflix',kind:'flatrate'}],link:'https://www.themoviedb.org/movie/1/watch?locale=NG'}};
    if(body.action==='news')return {data:{items:[{id:'n1',title:body.kind==='football'?'Football news headline':'Entertainment news headline',url:'https://www.bbc.com/news',source:'BBC',publishedAt:now}]}};
    if(body.action==='fixtures')return control.failFixtures?{error:{message:'Unavailable'}}:{data:{configured:!control.unconfiguredFixtures,updatedAt:now,matches:control.unconfiguredFixtures?[]:[{id:1,homeId:10,awayId:20,home:'Home team',away:'Away team',competition:'PL',competitionName:'Premier League',utcDate:now,status:control.liveMatch?'IN_PLAY':'FINISHED',score:{home:2,away:1}}]}};
    if(body.action==='detail')return {data:{configured:true,id:body.id,kind:body.type,title:'The Last Horizon',image:'/tests/artwork.svg',backdrop:'/tests/artwork.svg',subtitle:'A story worth discussing.',genres:['Adventure'],rating:8,trailerKey:'dQw4w9WgXcQ'}};
    if(body.action==='match')return {data:{match:{id:1,homeId:10,awayId:20,home:'Home team',away:'Away team',competition:'PL',competitionName:'Premier League',utcDate:now,status:control.liveMatch?'IN_PLAY':'FINISHED',score:{home:2,away:1},updatedAt:now}}};
    return {data:{}};
  }},
  storage:{from:bucket=>({getPublicUrl:()=>({data:{publicUrl:'https://example.com/avatar.png'}}),upload:async(path,blob,options)=>{control.uploads.push({bucket,path,size:blob.size,mime:options?.contentType});if(control.failNextUpload){control.failNextUpload=false;return {error:{message:'Offline'}};}media.set(path,blob);return {error:null};},copy:async(source,path)=>{control.copies ||= [];control.copies.push({bucket,source,path});if(media.has(source))media.set(path,media.get(source));return {error:null};},createSignedUrl:async(path)=>({data:{signedUrl:media.has(path)?URL.createObjectURL(media.get(path)):'https://example.com/photo.png'}})})},
};}
