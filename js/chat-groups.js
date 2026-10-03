import { chatAction, getMutualFriends, supabase } from './supabase-client.js';
import { element, avatar, openModal, closeModal, notify, viewProfile, actionButton, iconButton, navigate } from './ui.js';
import { dialog, openMenu, confirmAction } from './context-menu.js';
import { richCard } from './content-view.js';
import { renderMessageContent } from './message-content.js';
import { messagePreview } from './message-state.js';
export function groupAllowed(state, userId, capability) { return !!state?.isGroup && (['owner', 'admin'].includes(state.members.find(member => member.id === userId)?.role) || state.permissions?.[capability] === 'everyone'); }
async function groupPhoto(file, userId) {
  if (!file) return null;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP under 5 MB.');
  const path = `${userId}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
  const { error } = await supabase.storage.from('avatars').upload(path, file); if (error) throw error;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}
export function installGroups({ getUserId, getActive, openThread, refreshList, refreshState, jumpToMessage }) {
  async function createGroup() {
    closeModal('new-chat-modal');
    const panel = dialog('New group', 'group-wizard'), body = element('div'), footer = element('div', 'detail-actions'), error = element('p', 'form-error'); panel.card.append(body, error, footer); panel.open();
    let friends = [], selected = new Set(), step = 1, busy = false, title = '', photo;
    const next = actionButton('Continue', 'arrow', 'primary-button'); next.disabled = true; footer.append(next);
    body.append(element('p', 'muted', 'Loading your friends…'));
    try { friends = await getMutualFriends(getUserId()); } catch { body.replaceChildren(element('p', 'form-error', 'Could not load friends. Close and try again.')); return; }
    if (!panel.modal.isConnected) return;
    function people() {
      step = 1; body.replaceChildren(); footer.replaceChildren(next); next.textContent = 'Continue';
      const search = element('input'), people = element('div', 'people-list group-friend-picker'), count = element('p', 'muted'); search.type = 'search'; search.placeholder = 'Find a friend'; search.setAttribute('aria-label', 'Find a friend');
      body.append(element('p', 'muted', 'Choose people · up to 49 friends'), search, count, people);
      const render = () => { people.replaceChildren(); count.textContent = `${selected.size} selected`; next.disabled = !selected.size;
        for (const person of friends.filter(person => `${person.display_name} ${person.username}`.toLowerCase().includes(search.value.toLowerCase()))) {
          const label = element('label', 'group-friend-option'), check = element('input'); check.type = 'checkbox'; check.value = person.id; check.checked = selected.has(person.id); check.disabled = selected.size >= 49 && !check.checked;
          check.addEventListener('change', () => { if (check.checked) selected.add(person.id); else selected.delete(person.id); render(); }); label.append(avatar(person), element('span', '', person.display_name || person.username), check); people.append(label);
        }
        if (!friends.length) people.append(element('p', 'muted', 'Add a friend to start a group.'));
      }; search.addEventListener('input', render); render();
    }
    function identity() {
      step = 2; body.replaceChildren(); const preview = element('div', 'group-cover-preview'); preview.append(avatar({display_name:title || 'Group'}, 'group-info-avatar'), element('strong', '', `${selected.size + 1} people · including you`));
      const name = element('input'); name.id = 'group-wizard-name'; name.maxLength = 80; name.placeholder = 'Movie night crew'; name.value = title; name.setAttribute('aria-label', 'Group name');
      const image = element('input'); image.type = 'file'; image.accept = 'image/jpeg,image/png,image/webp'; image.setAttribute('aria-label', 'Optional group photo');
      image.addEventListener('change', () => { photo = image.files[0]; }); name.addEventListener('input', () => { title = name.value; next.disabled = !title.trim(); });
      body.append(preview, element('label', '', 'Group name'), name, element('label', '', 'Group photo (optional)'), image);
      const back = actionButton('Back', 'back'); back.addEventListener('click', people); footer.replaceChildren(back, next); next.textContent = 'Create group'; next.disabled = !title.trim(); name.focus();
    }
    next.addEventListener('click', async () => {
      if (step === 1) { identity(); return; } if (busy) return; busy = true; next.disabled = true; error.textContent = '';
      try {
        const image = await groupPhoto(photo, getUserId());
        const id = await chatAction('kaidra_create_group', { group_title: title.trim(), member_ids: [...selected] });
        if (image) { try { await chatAction('kaidra_group_action', { target_conversation: id, action: 'info', details: { avatar_url: image } }); } catch { notify('Group created. You can retry its photo from Group info.'); } }
        panel.close(); await openThread(id, { id, display_name: title.trim(), username: 'group', avatar_url: image }, true); await refreshList();
      } catch (err) { error.textContent = err.message || 'Could not create your group. Try again.'; } finally { busy = false; next.disabled = !title.trim(); }
    }); people();
  }
  document.getElementById('new-group-btn').addEventListener('click', createGroup);
  async function run(state, action, target_user = null, details = {}) { await chatAction('kaidra_group_action', { target_conversation: state.id, action, target_user, details }); await refreshState(state); await refreshList(); }
  function sharedHistory(state) {
    const panel = dialog('Shared in this group', 'shared-history-modal'), tabs = element('div', 'library-tabs'), list = element('div', 'shared-history-list'), more = actionButton('Load more', 'arrow'), error = element('p', 'form-error'); let category = 'entertainment', before, version = 0;
    async function load(reset = false) {
      const ticket = ++version; more.disabled = true; error.textContent = ''; if (reset) { before = null; list.replaceChildren(); }
      try {
        const batch = await chatAction('kaidra_shared_history', { target_conversation: state.id, category, ...(before ? {before_time: before.created_at, before_id: before.id} : {}) }); if (ticket !== version || !panel.modal.isConnected) return;
        for (const message of batch) { const entry = element('article', 'shared-history-entry'), content = message.shared_content ? richCard(message.shared_content, true) : renderMessageContent(message, {members: state.members}); if (content) entry.append(content); const jump = actionButton('View message', 'chat'); jump.addEventListener('click', async () => { panel.close(); closeModal('chat-info-modal'); await jumpToMessage(message.id); }); entry.append(jump); list.append(entry); }
        if (!batch.length && reset) list.append(element('p', 'muted', 'Nothing shared here yet.')); before = batch.at(-1) || before; more.classList.toggle('hidden', batch.length < 30);
      } catch { error.textContent = 'Could not load shared items. Try again.'; } finally { more.disabled = false; }
    }
    for (const name of ['entertainment', 'media', 'links']) { const tab = actionButton(name[0].toUpperCase() + name.slice(1)); tab.classList.toggle('active', name === category); tab.addEventListener('click', () => { category = name; [...tabs.children].forEach(node => node.classList.toggle('active', node === tab)); load(true); }); tabs.append(tab); }
    more.addEventListener('click', () => load()); panel.card.append(tabs, list, error, more); panel.open(); load(true);
  }
  function editInfo(state) {
    const panel = dialog('Edit group'), form = element('form'), name = element('input'), description = element('textarea'), image = element('input'), error = element('p', 'form-error'), save = actionButton('Save changes', 'check', 'primary-button');
    name.value = state.profile.display_name; name.maxLength = 80; name.required = true; name.setAttribute('aria-label','Group name'); description.value = state.description || ''; description.maxLength = 500; description.setAttribute('aria-label','Description'); image.type='file'; image.accept='image/jpeg,image/png,image/webp'; image.setAttribute('aria-label','Group photo'); save.type='submit';
    form.append(element('label','','Name'),name,element('label','','Description'),description,element('label','','Photo (optional)'),image,error,save); panel.card.append(form); panel.open();
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{const url=await groupPhoto(image.files[0],getUserId());await run(state,'info',null,{title:name.value.trim(),description:description.value.trim(),...(url?{avatar_url:url}:{})});panel.close();showInfo();}catch(err){error.textContent=err.message||'Could not save group information.';}finally{save.disabled=false;}});
  }
  function permissions(state) {
    const panel = dialog('Group permissions'), form = element('form'), choices = {}, error = element('p','form-error');
    for (const [key,title] of Object.entries({edit_info:'Edit group info',add_people:'Add people',send_messages:'Send messages',create_polls:'Create polls'})) {
      const label=element('label','permission-row',title), select=element('select'); select.setAttribute('aria-label',title);
      for(const [value,text] of [['everyone','Everyone'],['admins','Admins only']]) {const option=element('option','',text);option.value=value;select.append(option);} select.value=state.permissions[key]||'admins'; choices[key]=select; label.append(select);form.append(label);
    }
    const save=actionButton('Save permissions','check','primary-button');save.type='submit';form.append(error,save);panel.card.append(form);panel.open();
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{await run(state,'permissions',null,Object.fromEntries(Object.entries(choices).map(([k,v])=>[k,v.value])));panel.close();showInfo();}catch(err){error.textContent=err.message;}finally{save.disabled=false;}});
  }
  async function addPeople(state) {
    const panel=dialog('Add people'), list=element('div','people-list'), save=actionButton('Add selected friends','plus','primary-button'), error=element('p','form-error');panel.card.append(list,error,save);panel.open();save.disabled=true;
    try {
      const friends=(await getMutualFriends(getUserId())).filter(person=>!state.members.some(member=>member.id===person.id));
      for(const person of friends){const label=element('label','group-friend-option'),check=element('input');check.type='checkbox';check.value=person.id;check.addEventListener('change',()=>save.disabled=!list.querySelector('input:checked'));label.append(avatar(person),element('span','',person.display_name||person.username),check);list.append(label);}
      if(!friends.length)list.append(element('p','muted','All your friends are already here.'));
    } catch {error.textContent='Could not load friends.';}
    save.addEventListener('click',async()=>{save.disabled=true;try{await chatAction('kaidra_add_group_members',{target_conversation:state.id,member_ids:[...list.querySelectorAll('input:checked')].map(node=>node.value)});await refreshState(state);panel.close();showInfo();}catch(err){error.textContent=err.message;save.disabled=false;}});
  }
  async function transfer(state, leaveAfter = false) {
    const panel=dialog(leaveAfter?'Transfer ownership before leaving':'Transfer ownership');panel.card.append(element('p','muted','Choose the person who will own this group.'));
    for(const member of state.members.filter(person=>person.id!==getUserId())) {const button=element('button','person-row');button.type='button';button.append(avatar(member),element('strong','',member.display_name||member.username));button.addEventListener('click',async()=>{
      if(!await confirmAction('Transfer ownership?', `${member.display_name||member.username} will control roles and group permissions.`, 'Transfer'))return;
      button.disabled=true;try{await run(state,'transfer',member.id);panel.close();if(leaveAfter){await chatAction('kaidra_leave_group',{target_conversation:state.id});closeModal('chat-info-modal');navigate('inbox');await refreshList();}else showInfo();}catch(err){notify(err.message);button.disabled=false;}
    });panel.card.append(button);} panel.open();
  }
  async function showInfo({fresh = true} = {}) {
    const state=getActive();if(!state)return;
    if(!state.isGroup){viewProfile(state.profile.id);return;}
    document.getElementById('chat-info-modal').dataset.conversationId = state.id; openModal('chat-info-modal'); const container=document.getElementById('chat-members');container.replaceChildren(element('p','muted','Loading group…'));
    try{if(fresh)await refreshState(state);}catch{container.replaceChildren(element('p','form-error','This group is unavailable.'));return;}if(getActive()!==state)return;
    const me=state.members.find(person=>person.id===getUserId()), owner=me?.role==='owner';document.getElementById('chat-info-title').textContent='Group info';container.replaceChildren();
    const identity=element('div','group-info-identity');identity.append(avatar(state.profile,'group-info-avatar'),element('h3','',state.profile.display_name),element('span','muted',`${state.members.length} people`));if(state.description)identity.append(element('p','',state.description));container.append(identity);
    const actions=element('div','group-info-actions'),shared=actionButton('Shared','bookmark'),mute=actionButton(me?.muted?'Unmute notifications':'Mute notifications','bell');shared.addEventListener('click',()=>sharedHistory(state));mute.addEventListener('click',async()=>{mute.disabled=true;try{await run(state,'mute',null,{muted:!me.muted});showInfo();}catch{notify('Could not update notifications.');mute.disabled=false;}});actions.append(shared,mute);
    if(groupAllowed(state,getUserId(),'edit_info')) {const edit=actionButton('Edit info','edit');edit.addEventListener('click',()=>editInfo(state));actions.append(edit);}
    if(groupAllowed(state,getUserId(),'add_people')){const add=actionButton('Add people','plus');add.addEventListener('click',()=>addPeople(state));actions.append(add);}
    if(owner){const settings=actionButton('Permissions','settings');settings.addEventListener('click',()=>permissions(state));actions.append(settings);}container.append(actions,element('h3','section-label','People'));
    for(const member of state.members){const button=element('button','person-row');button.type='button';const copy=element('span','person-copy');copy.append(element('strong','',`${member.display_name||member.username}${member.id===getUserId()?' · You':''}`),element('small','',`@${member.username}`));button.append(avatar(member),copy);if(['owner','admin'].includes(member.role))button.append(element('span','role-badge',member.role==='owner'?'Owner':'Admin'));
      button.addEventListener('click',()=>openMenu(button,[
        {label:'View profile',icon:'user',run:()=>{closeModal('chat-info-modal');viewProfile(member.id);}},
        member.id!==getUserId()&&{label:'Message',icon:'chat',run:()=>{closeModal('chat-info-modal');document.dispatchEvent(new CustomEvent('kaidra:message-user',{detail:{profile:member}}));}},
        owner&&member.id!==getUserId()&&{label:member.role==='admin'?'Remove admin':'Make admin',icon:'people',run:async()=>{await run(state,member.role==='admin'?'demote':'promote',member.id);showInfo();}},
        member.id!==getUserId()&&member.role!=='owner'&&(owner||me?.role==='admin'&&member.role==='participant')&&{label:'Remove from group',icon:'trash',danger:true,run:async()=>{if(await confirmAction('Remove participant?',`${member.display_name||member.username} will lose access to this conversation.`,'Remove')){await run(state,'remove',member.id);showInfo();}}}
      ],member.display_name||member.username));container.append(button);
    }
    const leave=actionButton('Leave group','logout','danger-button');leave.addEventListener('click',async()=>{
      if(owner&&state.members.length>1){transfer(state,true);return;}
      const deleting=owner;if(!await confirmAction(deleting?'Delete this group?':'Leave this group?',deleting?'You are the last person. This permanently deletes the conversation.':'You will lose access to this conversation.',deleting?'Delete group':'Leave group'))return;
      leave.disabled=true;try{await chatAction('kaidra_group_action',{target_conversation:state.id,action:deleting?'delete':'leave'});closeModal('chat-info-modal');navigate('inbox');await refreshList();}catch(err){notify(err.message);leave.disabled=false;}
    });container.append(leave);
    if(owner&&state.members.length>1){const change=actionButton('Transfer ownership','people');change.addEventListener('click',()=>transfer(state));const remove=actionButton('Delete group','trash','danger-button');remove.addEventListener('click',async()=>{if(!await confirmAction('Delete this group?','This permanently removes its messages, polls, and shared history for everyone.','Delete group'))return;await chatAction('kaidra_group_action',{target_conversation:state.id,action:'delete'});closeModal('chat-info-modal');navigate('inbox');await refreshList();});container.append(change,remove);}
  }
  document.getElementById('chat-info-btn').addEventListener('click',showInfo);
  document.addEventListener('kaidra:chat-state', event => { const modal=document.getElementById('chat-info-modal'); if (!modal.classList.contains('hidden') && modal.dataset.conversationId===event.detail.id) showInfo({fresh:false}); });
  return {createGroup,showInfo};
}
