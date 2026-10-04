import { supabase, chatAction } from './supabase-client.js';
import { element, actionButton, notify } from './ui.js';
import { startChallenge } from './social.js';

export function discussionCard(message, state, userId, refresh) {
 const data = state.discussions?.find(item => item.message_id === message.id) || {total:0,opponents:[]};
 const card = element('div','discussion-card'), label = element('small','discussion-label','DISCUSSION');
 card.append(label, element('p','discussion-statement',message.content));
 if (message.sender_id !== userId) {
  const choices = element('div','discussion-choices');
  for (const [choice,text] of [['agree','Agree'],['disagree','Disagree']]) {
   const button = actionButton(text, choice==='agree'?'check':'close');
   button.setAttribute('aria-pressed',String(data.own_position===choice));
   button.addEventListener('click',async()=>{choices.querySelectorAll('button').forEach(b=>b.disabled=true);try{await chatAction('kaidra_discussion_position',{target_message:message.id,choice});await refresh(state);}catch(error){notify(error.message||'Could not save your position.');}finally{choices.querySelectorAll('button').forEach(b=>b.disabled=false);}});
   choices.append(button);
  }
  card.append(choices);
 }
 if (!state.isGroup && data.dm_response) card.append(element('p','discussion-result',`${data.dm_response.name} ${data.dm_response.position==='agree'?'agrees':'disagrees'}.`));
 else if (state.isGroup && data.own_position && data.total) {
  const result=element('div','discussion-result');
  result.append(element('span','',`Agree ${Math.round(data.agree/data.total*100)}% · Disagree ${Math.round(data.disagree/data.total*100)}%`),element('small','',`You chose: ${data.own_position==='agree'?'Agree':'Disagree'}`));card.append(result);
 }
 card.append(element('small','discussion-total',`${data.total} ${data.total===1?'person has':'people have'} taken a side`));
 if (data.opponents?.length) {
  const challenge=actionButton(state.isGroup?'Challenge':'Settle it','spark','discussion-challenge');
  challenge.addEventListener('click',()=>startChallenge({conversationId:state.id,discussionMessage:message,opponents:data.opponents}));card.append(challenge);
 }
 return card;
}

// Decide direction before capturing: browser keeps vertical/diagonal gestures.
export function swipeToReply(row, reply) {
 let gesture, suppressedUntil=0;
 const icon=element('span','swipe-reply-icon','↩');icon.setAttribute('aria-hidden','true');row.prepend(icon);
 function reset(){row.style.removeProperty('--reply-drag');row.style.removeProperty('--reply-progress');row.classList.remove('is-swiping');delete row.dataset.gestureActive;gesture=null;}
 row.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'||event.target.closest('button,a,input,textarea,audio,video'))return;row.dataset.gestureActive='true';gesture={id:event.pointerId,x:event.clientX,y:event.clientY,locked:false,ready:false};});
 row.addEventListener('pointermove',event=>{
  if(!gesture||event.pointerId!==gesture.id)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
  if(!gesture.locked){if(Math.hypot(dx,dy)<10)return;if(dx<=0||Math.abs(dy)*1.8>=dx){reset();return;}gesture.locked=true;row.setPointerCapture(event.pointerId);row.classList.add('is-swiping');}
  const distance=Math.min(90,Math.max(0,dx));row.style.setProperty('--reply-drag',`${distance}px`);row.style.setProperty('--reply-progress',String(Math.min(1,distance/60)));
  if(distance>=60&&!gesture.ready){gesture.ready=true;navigator.vibrate?.(8);}else if(distance<60)gesture.ready=false;
 });
 row.addEventListener('pointerup',event=>{if(!gesture||event.pointerId!==gesture.id)return;const ready=gesture.locked&&gesture.ready;if(gesture.locked)suppressedUntil=Date.now()+400;reset();if(ready)reply();});
 row.addEventListener('pointercancel',reset);
 row.addEventListener('lostpointercapture',event=>{if(event.target===row)reset();});
 row.addEventListener('click',event=>{if(Date.now()<suppressedUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
}

export function typingPresence(conversationId,userId,getMembers,show,revision) {
 let ready=false,lastSent=0,idle,closed=false;
 const channel=supabase.channel(`typing:${conversationId}:${revision}`,{config:{private:true,presence:{enabled:true,key:userId}}});
 function render(){if(closed)return;const now=Date.now(),members=getMembers();const ids=new Set(Object.entries(channel.presenceState()).flatMap(([key,states])=>key!==userId&&states.some(state=>state.typing&&Number(state.until)>now)?[key]:[]));const names=members.filter(member=>ids.has(member.id)).map(member=>member.display_name||member.username);show(names.length?`${names.slice(0,2).join(' and ')}${names.length>2?' and others':''} ${names.length===1?'is':'are'} typing…`:'');}
 channel.on('presence',{event:'sync'},render).subscribe(status=>{ready=status==='SUBSCRIBED';if(!ready)show('');});
 const expiry=setInterval(render,800);
 function stop(){clearTimeout(idle);if(ready)channel.untrack().catch(()=>{});lastSent=0;}
 return {update(text){if(closed||!ready)return;if(!text.trim()){stop();return;}const now=Date.now();if(now-lastSent>=1800){lastSent=now;channel.track({typing:true,until:now+4500}).catch(()=>{});}clearTimeout(idle);idle=setTimeout(stop,3000);},stop,close(){stop();closed=true;clearInterval(expiry);supabase.removeChannel(channel);show('');}};
}

export function receipt(message,state,userId) {
 if(message.localState)return {text:message.localState==='failed'?'Not sent':'Sending…',label:message.localState==='failed'?'Message not sent':'Sending message',read:false};
 const recipients=(state.deliveries||[]).filter(row=>row.message_id===message.id),reads=(state.reads||[]).filter(row=>row.message_id===message.id&&row.user_id!==userId);
 const seen=recipients.filter(row=>reads.some(read=>read.user_id===row.user_id)).length;
 const delivered=recipients.filter(row=>row.delivered_at).length;
 const allRead=recipients.length>0&&seen===recipients.length,allDelivered=recipients.length>0&&delivered===recipients.length;
 return {text:allRead||allDelivered||(!state.isGroup&&message.read_at)?'✓✓':'✓',read:allRead||(!state.isGroup&&!!message.read_at),label:state.isGroup?`Sent · delivered to ${delivered}/${recipients.length} · read by ${seen}/${recipients.length}`:allRead||message.read_at?'Read':allDelivered?'Delivered':'Sent'};
}
