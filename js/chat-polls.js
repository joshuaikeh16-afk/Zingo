import { chatAction } from './supabase-client.js';
import { element, actionButton, iconButton, notify } from './ui.js';
import { dialog } from './context-menu.js';
export function createPoll(state, onCreated) {
  const panel = dialog('Create a poll', 'poll-create-modal'), form = element('form'), question = element('input'), options = element('div','poll-option-inputs'), add = actionButton('Add option','plus'), multi = element('input'), error = element('p','form-error'), submit = actionButton('Create poll','poll','primary-button'), requestId = crypto.randomUUID();
  question.placeholder = 'What are we watching tonight?'; question.setAttribute('aria-label','Poll question'); question.required = true; question.maxLength = 240;
  function addOption() { if (options.children.length >= 10) return; const row=element('div','poll-option-input'), input=element('input'), remove=iconButton('close','Remove option');input.placeholder=`Option ${options.children.length+1}`;input.setAttribute('aria-label','Poll option');input.required=true;input.maxLength=120;remove.addEventListener('click',()=>{if(options.children.length>2)row.remove();add.disabled=options.children.length>=10;});row.append(input,remove);options.append(row);add.disabled=options.children.length>=10; }
  add.addEventListener('click',addOption);addOption();addOption();multi.type='checkbox';const label=element('label','checkbox-row','Allow multiple answers');label.prepend(multi);submit.type='submit';
  form.append(element('label','','Question'),question,element('label','','Options'),options,add,label,error,submit);panel.card.append(form);panel.open();
  form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;error.textContent='';try{await chatAction('kaidra_create_poll',{target_conversation:state.id,question:question.value.trim(),options:[...options.querySelectorAll('input')].map(input=>input.value.trim()),multiple:multi.checked,request_id:requestId});panel.close();await onCreated();}catch(err){error.textContent=err.message||'Could not create this poll. Try again.';}finally{submit.disabled=false;}});
}
export function pollCard(message, state, userId, refresh) {
  const poll=state.polls?.find(poll=>poll.message_id===message.id), card=element('section','poll-card');card.setAttribute('aria-label','Group poll');
  card.append(element('small','rich-card-label','Poll'),element('strong','poll-question',message.content));
  if(!poll){card.append(element('p','muted','Loading poll…'));return card;}
  const votes=poll.votes||[], mine=votes.find(vote=>vote.user_id===userId)?.choice_ids||[], voters=votes.filter(vote=>vote.choice_ids.length).length;
  card.append(element('span','muted',poll.multiple?'Choose one or more · tap to change':'Choose one · tap to change'));
  for(const option of poll.options){const count=votes.filter(vote=>vote.choice_ids.includes(option.id)).length, button=element('button',`poll-choice${mine.includes(option.id)?' selected':''}`);button.type='button';button.setAttribute('aria-pressed',String(mine.includes(option.id)));button.style.setProperty('--vote-percent',`${voters?Math.round(count/voters*100):0}%`);button.append(element('span','',option.label),element('small','',`${count} · ${voters?Math.round(count/voters*100):0}%`));
    button.addEventListener('click',async()=>{card.querySelectorAll('button').forEach(node=>node.disabled=true);const choices=mine.includes(option.id)?mine.filter(id=>id!==option.id):poll.multiple?[...mine,option.id]:[option.id];try{await chatAction('kaidra_vote',{target_message:message.id,choices});await refresh(state);}catch{notify('Your vote could not be saved. Try again.');card.querySelectorAll('button').forEach(node=>node.disabled=false);}});card.append(button);
  }
  card.append(element('small','muted',`${voters} ${voters===1?'person':'people'} voted`));return card;
}
