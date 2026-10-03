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
  conversations: [{id:a,is_group:false},{id:b,is_group:false}], message_reactions: [], message_reads: [], user_watchlist: [], chat_polls: [], poll_votes: [], message_pins: [], chat_signals: [],
};
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
control.emit = emit;
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
  limit(count){this.count=count;return this;}
  single(){this.one=true;return this;}
  maybeSingle(){this.one=true;return this;}
  insert(value){this.op='insert';this.value=value;return this;}
  upsert(value){this.op='upsert';this.value=value;return this;}
  update(value){this.op='update';this.value=value;return this;}
  delete(){this.op='delete';return this;}
  then(resolve,reject){return this.run().then(resolve,reject);}
  async run(){
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
    if(this.count!=null)rows=rows.slice(0,this.count);
    const result={data:this.options?.head?null:structuredClone(this.one?rows[0]||null:rows),error:null,count};
    if(this.table==='messages'&&this.op==='select'&&this.fields==='*'&&control.delayConversation&&rows.some(row=>row.conversation_id===control.delayConversation))await new Promise(resolve=>setTimeout(resolve,700));
    return result;
  }
}
function channel(name){
  const instance={name,listeners:[],on(type,filter,callback){this.listeners.push({type,filter,callback});return this;},subscribe(callback){channels.add(this);this.status=callback;setTimeout(()=>{if(channels.has(this)){callback?.('SUBSCRIBED');for(const entry of this.listeners)if(entry.type==='system')entry.callback({extension:'postgres_changes',status:'ok'});}},10);return this;}};
  return instance;
}
control.reconnect=()=>{for(const item of channels)item.status?.('SUBSCRIBED');};
export function createClient(){return {
  auth:{getSession:async()=>({data:{session:sessionStorage.getItem('qa:signed-out')==='true'?null:{user:{id:me}}}}),getUser:async()=>({data:{user:{id:me}}}),signOut:async()=>{sessionStorage.setItem('qa:signed-out','true');return {error:null};},signInWithPassword:async()=>{sessionStorage.removeItem('qa:signed-out');return {data:{session:{user:{id:me}}},error:null};},signUp:async()=>({data:{session:null},error:null}),resetPasswordForEmail:async()=>({error:null}),signInWithOAuth:async()=>({error:{message:'OAuth is not configured in this test.'}}),updateUser:async()=>({error:null}),onAuthStateChange:callback=>{if(location.pathname==='/reset-password.html'&&location.search.includes('qa-recovery'))setTimeout(()=>callback('PASSWORD_RECOVERY',{user:{id:me}}),30);return {data:{subscription:{unsubscribe(){}}}};}},
  from:(table)=>new Query(table),channel,removeChannel:async(value)=>channels.delete(value),
  rpc:async(name,args={})=>{
    if(control.missingGroups && name.startsWith('kaidra_') && !['kaidra_mark_read','kaidra_inbox'].includes(name))return {data:null,error:{code:'PGRST202'}};
    let data=true;
    if(name==='get_or_create_conversation')data=args.other_user_id===alice?a:b;
    if(name==='kaidra_library_save') {
      if(control.failLibrary)return {error:{message:'Offline'}};
      const item=args.item,kind=item.kind||item.type,id=String(kind==='article'?item.url:item.id);
      let row=db.user_watchlist.find(row=>row.external_id===id&&row.media_type===kind);
      if(!row){row={user_id:me,provider:'tmdb',external_id:id,media_type:kind,title:item.title,cover_url:item.image,snapshot:item,is_favorite:false,is_watchlisted:false};db.user_watchlist.push(row);}
      row[args.collection==='favorites'?'is_favorite':'is_watchlisted']=args.saved;data=row;emit('user_watchlist','UPDATE',row);
    }
    if(name==='kaidra_chat_state'){
      const id=args.target_conversation;
      if(!db.conversation_participants.some(row=>row.conversation_id===id&&row.user_id===me))return {error:{message:'Membership required'}};
      data={conversation:db.conversations.find(row=>row.id===id),members:db.conversation_participants.filter(row=>row.conversation_id===id).map(row=>({...db.profiles.find(profile=>profile.id===row.user_id),role:row.role||'participant',muted:row.muted||false})),reactions:db.message_reactions.filter(row=>row.conversation_id===id),reads:db.message_reads.filter(row=>db.messages.some(message=>message.id===row.message_id&&message.conversation_id===id)),polls:db.chat_polls.filter(row=>row.conversation_id===id).map(row=>({...row,votes:db.poll_votes.filter(vote=>vote.message_id===row.message_id)})),pins:db.message_pins.filter(row=>row.conversation_id===id&&row.is_pinned).map(pin=>db.messages.find(row=>row.id===pin.message_id)),quotes:db.messages.filter(row=>row.conversation_id===id)};
    }
    if(name==='kaidra_create_group'){data=crypto.randomUUID();db.conversations.push({id:data,title:args.group_title,is_group:true,created_by:me,permissions:{edit_info:'admins',add_people:'admins',send_messages:'everyone',create_polls:'everyone'}});db.conversation_participants.push(...[me,...args.member_ids].map(user_id=>({conversation_id:data,user_id,role:user_id===me?'owner':'participant'})));}
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
    return {data:structuredClone(data),error:null};
  },
  functions:{invoke:async(name,{body})=>{
    control.calls.push(body);
    if(body.action==='catalog'){const page=body.page||1;return control.failCatalog||(control.failCatalogAfterPageOne&&page>1)?{error:{message:'Unavailable'}}:{data:{configured:!control.unconfiguredCatalog,page,hasMore:!control.emptyCatalog&&!control.unconfiguredCatalog&&page<3,context:'Based on your interests',items:control.emptyCatalog||control.unconfiguredCatalog?[]:Array.from({length:6},(_,i)=>({id:i+1+(page-1)*6,type:body.category==='tv'?'tv':'movie',kind:body.category==='tv'?'tv':'movie',title:page===1?['The Last Horizon','City of Echoes','A Different Summer','After Midnight','Wild Hearts','The Long Way Home'][i]:`Another great story ${i+1+(page-1)*6}`,subtitle:'A story worth discussing with your friends.',image:'/tests/artwork.svg',backdrop:'/tests/artwork.svg',date:'2026-01-01',rating:8,reason:'Because you like adventure'}))}};}
    if(body.action==='providers')return {data:{configured:true,providers:[{name:'Netflix',kind:'flatrate'}],link:'https://www.themoviedb.org/movie/1/watch?locale=NG'}};
    if(body.action==='news')return {data:{items:[{id:'n1',title:body.kind==='football'?'Football news headline':'Entertainment news headline',url:'https://www.bbc.com/news',source:'BBC',publishedAt:now}]}};
    if(body.action==='fixtures')return control.failFixtures?{error:{message:'Unavailable'}}:{data:{configured:!control.unconfiguredFixtures,updatedAt:now,matches:control.unconfiguredFixtures?[]:[{id:1,home:'Home team',away:'Away team',competition:'PL',competitionName:'Premier League',utcDate:now,status:'FINISHED',score:{home:2,away:1}}]}};
    if(body.action==='detail')return {data:{configured:true,id:body.id,kind:body.type,title:'The Last Horizon',image:'/tests/artwork.svg',backdrop:'/tests/artwork.svg',subtitle:'A story worth discussing.',genres:['Adventure'],rating:8,trailerKey:'dQw4w9WgXcQ'}};
    if(body.action==='match')return {data:{match:{id:1,home:'Home team',away:'Away team',competition:'PL',competitionName:'Premier League',utcDate:now,status:'FINISHED',score:{home:2,away:1},updatedAt:now}}};
    return {data:{}};
  }},
  storage:{from:bucket=>({getPublicUrl:()=>({data:{publicUrl:'https://example.com/avatar.png'}}),upload:async(path,blob,options)=>{control.uploads.push({bucket,path,size:blob.size,mime:options?.contentType});if(control.failNextUpload){control.failNextUpload=false;return {error:{message:'Offline'}};}media.set(path,blob);return {error:null};},createSignedUrl:async(path)=>({data:{signedUrl:media.has(path)?URL.createObjectURL(media.get(path)):'https://example.com/photo.png'}})})},
};}
