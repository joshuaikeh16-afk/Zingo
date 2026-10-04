import { chatAction } from './supabase-client.js';
import { account } from './session.js';
import { element, actionButton } from './ui.js';
import { dialog } from './context-menu.js';
import { battleClasses, classEmblem } from './battle-classes.js';

let journey;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const call=(name,args={})=>chatAction(name,args);

// Only explicit participant actions call this; spectator/card/profile rendering never does.
export function awakenBattleIdentity(){
 if(journey)return journey;
 journey=runAwakening().finally(()=>{journey=null;});return journey;
}

async function runAwakening(){
 const current=await account;if(!current)return null;
 const progress=await call('kaidra_awakening_progress'),existing=progress.identity;
 if(existing?.acknowledged)return existing;
 const panel=dialog('Class determination','awakening-dialog'),body=element('div','awakening-body');
 panel.card.append(body);panel.open();
 return new Promise(resolve=>{
  let finished=false,working=false,state,chosen;
  const close=event=>{if(event.detail.id!==panel.id)return;document.removeEventListener('kaidra:modal-close',close);if(!finished)resolve(null);};
  document.addEventListener('kaidra:modal-close',close);
  function showError(message,retry){const error=element('p','form-error',message);error.setAttribute('role','alert');body.append(error);if(retry){const button=actionButton('Try again','arrow');button.addEventListener('click',()=>{error.remove();button.remove();retry();});body.append(button);}}
  function complete(identity){finished=true;panel.close();resolve(identity);}
  async function result(identity,animate){
   if(!body.isConnected)return;
   const metadata=battleClasses[identity.class_id];if(!metadata){showError('Your battle identity could not display. Close and reopen to retry.');return;}
   if(animate){body.replaceChildren(element('small','awakening-kicker','DETERMINATION COMPLETE'),element('p','awakening-evaluating','Your identity is taking shape.'));body.classList.add('is-evaluating');await wait(matchMedia('(prefers-reduced-motion: reduce)').matches?180:650);if(!body.isConnected)return;}
   body.classList.remove('is-evaluating');body.replaceChildren();body.dataset.class=identity.class_id;body.style.setProperty('--class-color',metadata.color);
   const reveal=element('div',`awakening-reveal${animate?' is-revealing':''}`),stage=element('div','awakening-stage');stage.setAttribute('aria-hidden','true');
   for(const name of ['halo','orbit','barrier','slash','echo','sparks'])stage.append(element('span','awakening-'+name));
   stage.append(classEmblem(identity.class_id));
   const heading=element('h3','awakening-class-name',metadata.name.toUpperCase());heading.tabIndex=-1;
   const details=element('div','awakening-result-details');details.append(element('p','awakening-summary',metadata.summary),element('p','',metadata.description),element('strong','awakening-permanent','Your class is permanent.'));
   const accept=actionButton('Accept destiny','check','awakening-primary');accept.disabled=animate;
   accept.addEventListener('click',async()=>{if(working)return;working=true;accept.disabled=true;try{await call('kaidra_awakening_acknowledge');document.dispatchEvent(new CustomEvent('kaidra:class-awakened',{detail:{identity}}));complete({...identity,acknowledged:true});}catch(error){showError(error.message||'Could not acknowledge your destiny. Your class is already saved.');}finally{working=false;accept.disabled=false;}});
   reveal.append(stage,element('small','awakening-kicker','YOUR CLASS HAS AWAKENED'),heading,element('p','awakening-tagline',metadata.tagline),details,accept);body.append(reveal);
   if(animate)await wait(matchMedia('(prefers-reduced-motion: reduce)').matches?350:1800);
   if(!body.isConnected)return;accept.disabled=false;heading.focus({preventScroll:true});
  }
  function question(){
   if(!body.isConnected)return;chosen=null;body.removeAttribute('data-class');body.replaceChildren();
   const q=state.question,header=element('div','awakening-question-header'),progress=element('progress','awakening-progress');progress.max=state.total;progress.value=state.answered;progress.setAttribute('aria-label',`${state.answered} of ${state.total} decisions confirmed`);
   header.append(element('small','awakening-kicker',`QUESTION ${state.answered+1} OF ${state.total}`),progress);
   const title=element('h3','awakening-question',q.prompt);title.tabIndex=-1;
   const form=element('form','awakening-question-form'),answers=element('fieldset','awakening-answers'),legend=element('legend','sr-only','Choose what comes naturally');answers.append(legend);
   const next=actionButton('Confirm decision','arrow','awakening-primary');next.type='submit';next.disabled=true;
   for(const option of q.options){const label=element('label','awakening-answer'),input=element('input'),text=element('span','',option.text),mark=element('span','awakening-choice-mark','✓');input.type='radio';input.name='awakening-answer';input.value=option.id;mark.setAttribute('aria-hidden','true');input.addEventListener('change',()=>{chosen=option.id;next.disabled=false;});label.append(input,text,mark);answers.append(label);}
   const error=element('p','form-error');error.setAttribute('role','alert');
   form.append(answers,error,next);form.addEventListener('submit',async event=>{event.preventDefault();if(working||!chosen)return;working=true;answers.disabled=true;next.disabled=true;error.textContent='';try{const response=await call('kaidra_awakening_answer',{target_session:state.session_id,question_id:q.id,answer_id:chosen});state=response;if(!body.isConnected)return;if(state.identity)await result(state.identity,true);else question();}catch(problem){error.textContent=problem.message||'Your decision could not save. Retry with the same answer.';}finally{working=false;if(answers.isConnected){answers.disabled=false;next.disabled=!chosen;}}});
   body.append(header,title,form,element('small','awakening-save-note','Progress saves to your account. Confirmed decisions stay recorded.'));title.focus({preventScroll:true});body.scrollTop=0;
  }
  async function begin(){if(working)return;working=true;body.setAttribute('aria-busy','true');try{state=await call('kaidra_awakening_begin');if(!body.isConnected)return;if(state.identity)await result(state.identity,false);else question();}catch(error){showError(error.message||'Determination could not begin. Please retry.',begin);}finally{working=false;body.removeAttribute('aria-busy');}}
  if(existing){result(existing,false);return;}
  const opening=element('div','awakening-intro'),sigil=element('div','awakening-intro-sigil');sigil.setAttribute('aria-hidden','true');sigil.append(classEmblem(null));
  opening.append(sigil,element('small','awakening-kicker','KAIDRA · CLASS DETERMINATION'),element('h3','awakening-intro-title','You can shape your path.'),element('p','awakening-intro-subtitle','You cannot change your destiny.'),element('p','awakening-intro-copy','Every fighter approaches conflict differently. There are no correct answers. Choose what comes naturally.'),element('strong','awakening-permanent','YOUR RESULT IS PERMANENT.'),element('p','awakening-intro-note','12 decisions, with up to two final scenarios. Your progress is saved if you leave. There is no retake or class change.'));
  const start=actionButton(progress.answered?'Resume determination':'Begin determination','arrow','awakening-primary');start.addEventListener('click',begin);opening.append(start);body.append(opening);
 });
}
