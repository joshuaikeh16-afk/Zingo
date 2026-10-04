import { supabase, chatAction, getMutualFriends, getOrCreateConversation } from './supabase-client.js';
import { account } from './session.js';
import { element, actionButton, avatar, notify, viewProfile, emptyState, closeModal } from './ui.js';
import { dialog, confirmAction } from './context-menu.js';
import { contentRequest } from './content-client.js';
import { openContent, shareContent, richCard } from './content-view.js';
import { toggleLibrary } from './library.js';
import { goRoute, parseRoute, backRoute } from './router.js';
import { progressionCard } from './battle-progress.js';
import { classIdentity } from './battle-classes.js';
import { awakenBattleIdentity } from './awakening.js';
let currentUser, channel, homeVersion = 0, battlePanel, battleChannel, battleVersion = 0, profileTarget, profileVersion = 0;
const requests = new Map();
const call = (name, args = {}) => chatAction(name, args);
function friendly(error) { const text = error?.message || ''; return /Give this|Only |Voting is still|At least three|Support is locked|Refresh the match|Take a moment|This connection|Choose a|This conversation/.test(text) ? text : 'Could not complete that action. Please retry.'; }
async function once(name, args) { const key = JSON.stringify([name, args]); if (requests.has(key))
    return requests.get(key); const promise = call(name, args); requests.set(key, promise); try {
    return await promise;
}
finally {
    requests.delete(key);
} }
function field(form, label, type = 'text', value = '') { const wrap = element('label', 'social-field', label), input = element(type === 'textarea' ? 'textarea' : 'input'); if (type !== 'textarea')
    input.type = type; input.value = value; wrap.append(input); form.append(wrap); return input; }
function select(form, label, options, value = '') { const wrap = element('label', 'social-field', label), input = element('select'); for (const [key, name] of options) {
    const option = element('option', '', name);
    option.value = key;
    input.append(option);
} input.value = value; wrap.append(input); form.append(wrap); return input; }
function visibilityFields(form, value = 'private', notifyFriends = false) { const visibility = select(form, 'Who may see this connection?', [['private', 'Private · just the two of you'], ['friends', 'Mutual friends'], ['public', 'On your profiles']], value), wrap = element('label', 'checkbox-row'), notify = element('input'); notify.type = 'checkbox'; notify.checked = notifyFriends; wrap.append(notify, document.createTextNode('Tell friends if both of us agree')); form.append(wrap, element('p', 'muted', 'The more private choice always wins. You can change your own choice later.')); return { visibility, notify }; }
export async function startChallenge({conversationId,targetUser,topic='',discussionMessage,opponents}={}) {
 const current=await account;if(!current)return;
 try{if(!await awakenBattleIdentity())return;}catch{notify('Your battle identity could not load. Please retry.');return;}
 const panel=dialog(discussionMessage?'Discussion challenge':'Friendly challenge','challenge-dialog'),form=element('form');panel.card.append(form);
 if(conversationId)panel.modal.dataset.conversationId=conversationId;
 try {
  let eligible;
  if(discussionMessage) eligible=opponents||[];
  else if(conversationId){const state=await call('kaidra_chat_state',{target_conversation:conversationId});eligible=state.members.filter(m=>m.id!==current.userId);}
  else eligible=await getMutualFriends(current.userId);
  if(!panel.modal.isConnected)return;
  if(targetUser&&!eligible.some(p=>p.id===targetUser)){panel.card.append(element('p','muted','This person is not available to challenge.'));panel.open();return;}
  if(!eligible.length){panel.card.append(element('p','muted',discussionMessage?'Take a side to find an opposing participant.':'Invite someone into the conversation first.'));panel.open();return;}
  const opponent=select(form,'Opponent',eligible.map(p=>[p.id,p.name||p.display_name||p.username]),targetUser||eligible[0].id);
  let flavour;
  if(discussionMessage)form.append(element('p','discussion-statement',discussionMessage.content),element('p','muted','Your discussion and opposing positions stay attached to this challenge. They must accept.'));
  else {form.append(element('p','muted','Challenge them for fun. No argument or position required.'));flavour=field(form,'Optional challenge text','text',topic);flavour.maxLength=240;}
  const error=element('p','form-error'),submit=actionButton('Send challenge','spark','primary-button');submit.type='submit';form.append(error,submit);
  const requestId=crypto.randomUUID();let busy=false;
  form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;submit.disabled=true;error.textContent='';try{const cid=conversationId||await getOrCreateConversation(opponent.value);const id=await call('kaidra_battle_create',{target_conversation:cid,target_user:opponent.value,topic:flavour?.value.trim()||'',stance:'',context:discussionMessage?{entry_type:'discussion',discussion_message_id:discussionMessage.id}:{entry_type:'direct'},request_id:requestId});panel.close();notify('Challenge sent.');goRoute(`battle/${id}`);}catch(problem){error.textContent=problem.message||'Could not send challenge.';}finally{busy=false;submit.disabled=false;}});
  panel.open();
 }catch{panel.card.append(element('p','muted','Participants could not load. Please retry.'));panel.open();}
}
export function battleCard(id) {
 const card=element('article','battle-card');card.dataset.battleId=id;card.append(element('small','eyebrow','CHALLENGE'),element('p','muted','Loading challenge…'));
 once('kaidra_battle_state',{target_battle:id}).then(async data=>{if(!card.isConnected)return;const current=await account;if(!card.isConnected)return;const name=uid=>{const p=data.participants.find(p=>p.id===uid);return p?.display_name||p?.username||'Member';};card.replaceChildren(element('small','eyebrow',data.type==='discussion'?'DISCUSSION CHALLENGE':'CHALLENGE'),element('strong','',`${name(data.challenger_id)} challenged ${name(data.challenged_id)}`),element('p','',data.type==='direct'?'FRIENDLY BATTLE':data.topic));if(data.flavour_text)card.append(element('p','',data.flavour_text));card.append(element('small','muted',data.status));
 for(const participant of data.participants){const identity=classIdentity(participant.identity,{compact:true});if(identity){identity.append(element('span','class-fighter-name',participant.display_name||participant.username));card.append(identity);}}
 if(data.status==='pending'&&data.challenged_id===current?.userId&&data.type!=='opinion')for(const [label,action] of [['Accept','accept'],['Decline','decline']]){const button=actionButton(label,action==='accept'?'check':'close');button.addEventListener('click',async()=>{button.disabled=true;try{if(action==='accept'&&!await awakenBattleIdentity()){button.disabled=false;return;}await call('kaidra_battle_action',{target_battle:id,action});document.dispatchEvent(new Event('kaidra:social-refresh'));}catch(problem){notify(problem.message||'Could not respond.');button.disabled=false;}});card.append(button);}
 const view=actionButton('View challenge','arrow');view.addEventListener('click',()=>goRoute(`battle/${id}`));card.append(view);
 }).catch(()=>card.replaceChildren(element('p','muted','This challenge is no longer available.')));return card;
}
async function renderBattle(id) {
    const generation = ++battleVersion;
    const data = await call('kaidra_battle_state', { target_battle: id });
    if (generation !== battleVersion || parseRoute(location.hash).id !== id)
        return;
    const current = await account;
    if (!current || generation !== battleVersion || parseRoute(location.hash).id !== id)
        return;
    closeModal('content-detail-modal');
    if (battlePanel && battlePanel.battleId !== id) {
        const old = battlePanel;
        battlePanel = null;
        old.close();
        if (battleChannel)
            supabase.removeChannel(battleChannel);
        battleChannel = null;
    }
    if (!battlePanel) {
        battlePanel = dialog('Challenge', 'battle-modal');
        battlePanel.modal.dataset.conversationId = data.conversation_id;
        battlePanel.battleId = id;
        battlePanel.body = element('div', 'battle-body');
        battlePanel.card.append(battlePanel.body);
        battlePanel.open();
    }
    const body = battlePanel.body, oldInput = body.querySelector('textarea'), draft = oldInput?.value || '', focus = oldInput === document.activeElement, selection = oldInput?.selectionStart;
    body.replaceChildren();
    body.append(element('p','eyebrow',`${data.type==='discussion'?'DISCUSSION CHALLENGE':data.type==='direct'?'FRIENDLY BATTLE':'DEBATE'} · ${data.status.toUpperCase()}`),element('h2','',data.topic),element('p','muted',data.type==='direct'?(data.flavour_text||'A friendly challenge. No opinion required.'):'Community opinion. Keep it friendly.'));
    if(data.type==='discussion'&&data.discussion_message_id){const original=actionButton('View discussion','chat');original.addEventListener('click',()=>{battlePanel?.close();document.dispatchEvent(new CustomEvent('kaidra:jump-discussion',{detail:{conversationId:data.conversation_id,messageId:data.discussion_message_id}}));});body.append(original);}
    const identities = element('div', 'battle-sides');
    for (const participant of data.participants) {
        const side = element('div', 'battle-side');
        const identity=classIdentity(participant.identity,{compact:true});if(identity)side.append(identity);
        side.append(avatar(participant), element('strong', '', participant.display_name || participant.username), element('p', '', participant.id === data.challenger_id ? data.challenger_position : data.challenged_position || (data.type==='direct'?'Friendly battle':'Waiting for their position')), element('small', '', `${data.votes.find(v => v.side === participant.id)?.count || 0} votes`));
        if (data.type!=='direct' && data.status === 'active' && ![data.challenger_id, data.challenged_id].includes(current.userId)) {
            const vote = actionButton(data.own_vote === participant.id ? 'Your vote' : 'Back this side', 'check');
            vote.setAttribute('aria-pressed', String(data.own_vote === participant.id));
            vote.disabled = Date.now() >= Date.parse(data.ends_at);
            vote.addEventListener('click', () => act('vote', participant.id));
            side.append(vote);
        }
        identities.append(side);
    }
    body.append(identities);
    const error = element('p', 'form-error hidden'), actions = element('div', 'detail-actions');
    let acting = false;
    async function act(action, value = '', anchor) { if (acting)
        return; acting = true; if (anchor)
        anchor.disabled = true; error.classList.add('hidden'); try {
        if(action==='accept'&&!await awakenBattleIdentity())return;
        await call('kaidra_battle_action', { target_battle: id, action, value });
        notify({ accept: 'Debate started.', vote: 'Vote saved.', finish: 'Debate resolved.', concede: 'You conceded gracefully.', draw: 'Draw response saved.', post: 'Your position was added.' }[action] || 'Challenge updated.');
        await renderBattle(id);
    }
    catch (problem) {
        error.textContent = friendly(problem);
        error.classList.remove('hidden');
    }
    finally {
        acting = false;
        if (anchor)
            anchor.disabled = false;
    } }
    const action = (label, kind, value = '') => { const button = actionButton(label, kind === 'accept' ? 'check' : 'arrow'); button.addEventListener('click', () => act(kind, value, button)); actions.append(button); };
    if (data.status === 'pending') {
        if (current.userId === data.challenged_id && data.type!=='opinion') { action('Accept challenge','accept'); action('Decline','decline'); }
        if (current.userId === data.challenged_id && data.type==='opinion') {
            const response = field(body, 'Your opposing position', 'textarea', draft);
            response.maxLength = 1200;
            response.rows = 3;
            const accept = actionButton('Accept challenge', 'check', 'primary-button');
            accept.addEventListener('click', () => response.value.trim() ? act('accept', response.value.trim(), accept) : (error.textContent = 'Add your position before accepting.', error.classList.remove('hidden')));
            actions.append(accept);
            action('Decline', 'decline');
        }
        if (current.userId === data.challenger_id)
            action('Cancel challenge', 'cancel');
    }
    if (data.status === 'active' && data.type==='direct') body.append(element('p','muted','Challenge accepted. Continue in your conversation.'));
    if (data.status === 'active' && data.type!=='direct') {
        body.append(element('p', 'muted', `Voting closes ${new Date(data.ends_at).toLocaleString()}. Participants can finish after five minutes and at least three spectator votes.`));
        for (const post of data.posts) {
            const entry = element('div', 'battle-position');
            entry.append(element('strong', '', data.participants.find(p => p.id === post.user_id)?.display_name || 'Participant'), element('p', '', post.body));
            body.append(entry);
        }
        if ([data.challenger_id, data.challenged_id].includes(current.userId)) {
            const response = field(body, 'Add to your argument', 'textarea', draft);
            response.maxLength = 1200;
            response.rows = 3;
            const add = actionButton('Add position', 'edit');
            add.addEventListener('click', () => response.value.trim() && act('post', response.value.trim(), add));
            actions.append(add);
            action('Concede', 'concede');
            action(data.draw_offered_by && data.draw_offered_by !== current.userId ? 'Agree to draw' : 'Offer a draw', 'draw');
            action('Finish voting', 'finish');
        }
        else if (Date.now() >= Date.parse(data.ends_at))
            action('Resolve expired debate', 'finish');
    }
    if (data.status === 'resolved') {
        const winner = data.participants.find(p => p.id === data.winner_id);
        body.append(element('div', 'battle-result', winner ? `🏆 ${winner.display_name || winner.username} won by ${data.outcome.replaceAll('_', ' ')}` : 'A friendly draw'));
        const ownReward = data.rewards.find(r => r.user_id === current.userId);
        if (ownReward?.xp)
            body.append(element('p', 'xp-award', `+${ownReward.xp} XP`));
    }
    body.append(actions,error);if(data.type!=='direct')body.append(element('p','battle-xp-note','XP comes from established group debates with independent spectators.'));
    const conversation = actionButton('Back to conversation', 'chat');
    conversation.addEventListener('click', () => goRoute(`inbox/${data.conversation_id}`));
    body.append(conversation);
    if (focus) {
        const input = body.querySelector('textarea');
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(selection, selection);
    }
    if (!battleChannel) {
        battleChannel = supabase.channel(`battle:${id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${id}` }, () => renderBattle(id).catch(() => { })).on('postgres_changes', { event: '*', schema: 'public', table: 'battle_votes', filter: `battle_id=eq.${id}` }, () => renderBattle(id).catch(() => { })).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'battle_posts', filter: `battle_id=eq.${id}` }, () => renderBattle(id).catch(() => { })).subscribe(state => { if (state === 'SUBSCRIBED')
            renderBattle(id).catch(() => { }); });
    }
}
export async function requestRelationship(targetUser) { const panel = dialog('A connection, by choice', 'relationship-dialog'), form = element('form'); panel.card.append(element('p', 'muted', 'Invite an existing friend. Nothing is established until they accept.'), form); try {
    const { data, error } = await supabase.from('relationship_types').select('key,label').eq('active', true);
    if (error)
        throw error;
    const type = select(form, 'Connection', data.map(t => [t.key, t.label]), data[0]?.key), privacy = visibilityFields(form), errorNode = element('p', 'form-error hidden'), send = actionButton('Send request', 'people', 'primary-button');
    send.type = 'submit';
    form.append(errorNode, send);
    const requestId = crypto.randomUUID();
    let busy = false;
    form.addEventListener('submit', async (event) => { event.preventDefault(); if (busy)
        return; busy = true; send.disabled = true; try {
        await call('kaidra_relationship_request', { target_user: targetUser, relationship_type: type.value, visibility: privacy.visibility.value, notify_friends: privacy.notify.checked, request_id: requestId });
        panel.close();
        notify('Connection request sent.');
    }
    catch (problem) {
        errorNode.textContent = friendly(problem);
        errorNode.classList.remove('hidden');
    }
    finally {
        busy = false;
        send.disabled = false;
    } });
    panel.open();
}
catch {
    panel.card.append(element('p', 'muted', 'Connection options could not load. Reopen to retry.'));
    panel.open();
} }
async function relationshipRespond(row, action = 'accept') { const panel = dialog(action === 'privacy' ? 'Connection privacy' : 'Accept this connection?'), form = element('form'); panel.card.append(form); const privacy = visibilityFields(form, row.own_visibility || 'private', !!row.own_notify), error = element('p', 'form-error hidden'), save = actionButton(action === 'privacy' ? 'Save my choice' : 'Accept connection', 'check', 'primary-button'); save.type = 'submit'; form.append(error, save); let busy = false; form.addEventListener('submit', async (event) => { event.preventDefault(); if (busy)
    return; busy = true; save.disabled = true; try {
    await call('kaidra_relationship_action', { target_relationship: row.id, action, visibility: privacy.visibility.value, notify_friends: privacy.notify.checked });
    panel.close();
    notify('Connection updated.');
    refreshSocial();
}
catch (problem) {
    error.textContent = friendly(problem);
    error.classList.remove('hidden');
}
finally {
    busy = false;
    save.disabled = false;
} }); panel.open(); }
export function relationshipCard(id) {
    const card = element('article', 'relationship-card');
    card.append(element('p', 'muted', 'Loading connection…'));
    once('kaidra_profile_social', { target_user: currentUser }).then(async (data) => { if (!card.isConnected)
        return; const row = data.relationships.find(r => r.id === id); card.replaceChildren(); if (!row) {
        card.append(element('p', 'muted', 'This connection request is closed.'));
        return;
    } card.append(element('strong', '', row.label), element('p', 'muted', `${row.partner.display_name || row.partner.username} · ${row.status}`)); if (row.status === 'pending' && row.target_id === currentUser) {
        const accept = actionButton('Review & accept', 'check'), decline = actionButton('Decline', 'close');
        accept.addEventListener('click', () => relationshipRespond(row));
        decline.addEventListener('click', async () => { try {
            await call('kaidra_relationship_action', { target_relationship: id, action: 'decline' });
            refreshSocial();
        }
        catch {
            notify('Could not decline. Retry.');
        } });
        card.append(accept, decline);
    } }).catch(() => card.replaceChildren(element('p', 'muted', 'This connection is unavailable.')));
    return card;
}
export async function renderSocialProfile(targetUser, own) {
    profileTarget = { targetUser, own };
    const generation = ++profileVersion, id = own ? 'profile-social' : 'user-profile-social', target = document.getElementById(id);
    if (!target)
        return;
    try {
        const data = await call('kaidra_profile_social', { target_user: targetUser });
        if (generation !== profileVersion)
            return;
        target.replaceChildren();
        const stats = data.stats;
        const identity=classIdentity(data.identity);if(identity)target.append(identity);
        if (own) {
            if(!data.identity){const awaken=actionButton('Begin battle journey','spark');awaken.addEventListener('click',async()=>{awaken.disabled=true;try{await awakenBattleIdentity();await renderSocialProfile(targetUser,true);}catch{notify('Your battle journey could not open. Retry.');}finally{awaken.disabled=false;}});target.append(awaken);}
            const history = actionButton('Your battle history', 'spark');
            history.addEventListener('click', async () => {try{if(await awakenBattleIdentity())battleHistory(targetUser);}catch{notify('Your battle journey could not open. Retry.');}});
            target.append(history);
        }
        if(own)target.append(progressionCard(stats || {}));
        for (const row of data.relationships) {
            const entry = element('div', 'profile-connection');
            const partner = actionButton(`${row.label} · ${row.partner.display_name || row.partner.username}`, 'people');
            partner.addEventListener('click', () => viewProfile(row.partner.id));
            entry.append(partner);
            if ([row.requester_id, row.target_id].includes(currentUser)) {
                entry.append(element('small', '', row.status === 'pending' ? 'Waiting for consent' : `Your choice: ${row.own_visibility}`));
                if (row.status === 'accepted') {
                    const privacy = actionButton('Privacy', 'settings'), end = actionButton('End connection', 'close');
                    privacy.addEventListener('click', () => relationshipRespond(row, 'privacy'));
                    end.addEventListener('click', async () => { if (await confirmAction('End this connection?', 'This change stays between the two of you.', 'End connection')) {
                        try {
                            await call('kaidra_relationship_action', { target_relationship: row.id, action: 'end' });
                            refreshSocial();
                        }
                        catch {
                            notify('Could not end that connection. Retry.');
                        }
                    } });
                    entry.append(privacy, end);
                }
                else if (row.target_id === currentUser) {
                    const accept = actionButton('Review request', 'check');
                    accept.addEventListener('click', () => relationshipRespond(row));
                    entry.append(accept);
                }
                else {
                    const cancel = actionButton('Cancel request', 'close');
                    cancel.addEventListener('click', () => call('kaidra_relationship_action', { target_relationship: row.id, action: 'cancel' }).then(refreshSocial).catch(() => notify('Could not cancel. Retry.')));
                    entry.append(cancel);
                }
            }
            target.append(entry);
        }
        target.classList.toggle('hidden', !target.childElementCount);
    }
    catch {
        target.replaceChildren(element('p', 'muted', 'Social information could not load.'));
    }
}
export async function titleSocialPanel(item) { const panel = element('section', 'title-social'); try {
    const data = await once('kaidra_title_social', { provider: item.provider || (['anime', 'manga'].includes(item.kind) ? 'mal' : 'tmdb'), media_type: item.kind || item.type, external_id: String(item.id) });
    if (data.count) {
        panel.append(element('h3', '', `${data.count} friends saved or completed this`));
        const people = element('div', 'social-avatars');
        for (const friend of data.friends.slice(0, 8)) {
            const button = element('button');
            button.type = 'button';
            button.title = friend.display_name || friend.username;
            button.append(avatar(friend));
            button.addEventListener('click', () => viewProfile(friend.id));
            people.append(button);
        }
        panel.append(people);
    }
}
catch { } return panel; }
export async function matchSocialPanel(item) {
    const panel = element('section', 'match-social-panel');
    let support, working = false;
    try {
        support = await call('kaidra_match_social', { target_match: Number(item.id) });
    }
    catch {
        panel.append(element('p', 'muted', 'Social match information is unavailable.'));
        return panel;
    }
    panel.append(element('h3', '', support.locked ? 'Support at the final whistle' : 'Who are you backing?'), element('p', 'muted', 'This match’s choice is separate from your favourite club.'));
    const choices = element('div', 'support-buttons');
    for (const [side, label] of [['home', item.home], ['neutral', 'Neutral'], ['away', item.away]]) {
        const button = actionButton(label, 'ball');
        button.setAttribute('aria-pressed', String(support.own_support === side));
        button.disabled = support.locked;
        button.addEventListener('click', async () => { if (working)
            return; working = true; choices.querySelectorAll('button').forEach(b => b.disabled = true); try {
            await contentRequest('match', { id: item.id });
            await call('kaidra_match_support', { target_match: Number(item.id), side });
            support.own_support = side;
            choices.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
            notify('Your support is saved.');
        }
        catch (problem) {
            notify(friendly(problem));
        }
        finally {
            working = false;
            const fresh = await call('kaidra_match_social', { target_match: Number(item.id) }).catch(() => support);
            support = fresh;
            choices.querySelectorAll('button').forEach(b => b.disabled = !!support.locked);
        } });
        choices.append(button);
    }
    panel.append(choices);
    if (support.friends.length) {
        panel.append(element('h3', '', `${support.friends.length} friends following this match`));
        for (const friend of support.friends) {
            const row = element('div', 'support-friend');
            row.append(avatar(friend), element('strong', '', friend.display_name || 'Friend'), element('span', '', friend.side === 'neutral' ? 'Neutral' : friend.side === 'home' ? item.home : item.away));
            panel.append(row);
        }
    }
    const actions = element('div', 'detail-actions'), discuss = actionButton('Discuss / share', 'chat'), challenge = actionButton('Challenge a friend', 'spark'), take = actionButton('Post a take', 'edit');
    discuss.addEventListener('click', () => shareContent({ ...item, senderSupport: support.own_support }));
    challenge.addEventListener('click', () => startChallenge({ topic: `${item.home} vs ${item.away}`, context: { item } }));
    take.addEventListener('click', () => { const modal = dialog('What’s your take?'), form = element('form'), text = field(form, 'Your take', 'textarea'), send = actionButton('Send to a conversation', 'chat', 'primary-button'); text.required = true; text.maxLength = 1200; send.type = 'submit'; form.append(send); modal.card.append(form); form.addEventListener('submit', event => { event.preventDefault(); modal.close(); document.dispatchEvent(new CustomEvent('kaidra:share-content', { detail: { text: text.value.trim(), content: { ...item, senderSupport: support.own_support } } })); }); modal.open(); });
    actions.append(discuss, take, challenge);
    panel.append(actions);
    const follow = actionButton('Follow clubs & competitions', 'ball');
    follow.addEventListener('click', () => footballPreferences(item));
    panel.append(follow);
    return panel;
}
export async function footballPreferences(item) {
    const current = await account;
    if (!current)
        return;
    const prefs = current.profile.recommendation_preferences || {}, panel = dialog('Your football interests'), form = element('form');
    panel.card.append(form);
    const pickedClubs = new Set((prefs.football_clubs || []).map(Number)), pickedLeagues = new Set(prefs.football_competitions || []), labels = { ...(prefs.football_club_labels || {}) };
    try {
        const data = await contentRequest('fixtures');
        const clubs = [...new Map([...Object.entries(labels).map(([id, name]) => [Number(id), name]), ...(data.matches || []).flatMap(m => [[m.homeId, m.home], [m.awayId, m.away]])]).entries()].filter(([id]) => id);
        if (item?.homeId && !clubs.some(([id]) => id === item.homeId))
            clubs.push([item.homeId, item.home]);
        if (item?.awayId && !clubs.some(([id]) => id === item.awayId))
            clubs.push([item.awayId, item.away]);
        const competition = select(form, 'Choose a competition to find clubs', [['', 'Recent fixtures'], ...[...new Map(data.matches.map(m => [m.competition, m.competitionName])).entries()]]), clubList = element('div', 'follow-clubs');
        form.append(element('h3', 'section-label', 'Favourite clubs'), clubList);
        function renderClubs(rows) { clubList.replaceChildren(); for (const [id, name] of rows) {
            const row = element('label', 'checkbox-row'), input = element('input');
            input.type = 'checkbox';
            input.checked = pickedClubs.has(Number(id));
            input.addEventListener('change', () => { if (input.checked) {
                pickedClubs.add(Number(id));
                labels[id] = name;
            }
            else {
                pickedClubs.delete(Number(id));
                delete labels[id];
            } });
            row.append(input, document.createTextNode(name));
            clubList.append(row);
        } }
        renderClubs(clubs);
        competition.addEventListener('change', async () => { if (!competition.value)
            return renderClubs(clubs); clubList.textContent = 'Loading clubs…'; try {
            const meta = await contentRequest('football-meta', { competition: competition.value });
            renderClubs(meta.clubs.map(club => [club.id, club.name]));
        }
        catch {
            clubList.textContent = 'These clubs could not load. Choose another competition.';
        } });
        form.append(element('h3', 'section-label', 'Favourite competitions'));
        for (const [code, name] of [...new Map(data.matches.map(m => [m.competition, m.competitionName])).entries()]) {
            const label = element('label', 'checkbox-row'), input = element('input');
            input.type = 'checkbox';
            input.checked = pickedLeagues.has(code);
            input.addEventListener('change', () => input.checked ? pickedLeagues.add(code) : pickedLeagues.delete(code));
            label.append(input, document.createTextNode(name));
            form.append(label);
        }
        const save = actionButton('Save football interests', 'check', 'primary-button');
        save.type = 'submit';
        form.append(save);
        form.addEventListener('submit', async (event) => { event.preventDefault(); save.disabled = true; const preferences = { ...prefs, football_clubs: [...pickedClubs], football_club_labels: labels, football_competitions: [...pickedLeagues] }; const interests = [...new Set([...(current.profile.interests || []), 'football'])]; const { error } = await supabase.from('profiles').update({ recommendation_preferences: preferences, interests }).eq('id', current.userId); save.disabled = false; if (error) {
            notify('Could not save football interests. Retry.');
            return;
        } Object.assign(current.profile, { recommendation_preferences: preferences, interests }); document.dispatchEvent(new CustomEvent('kaidra:football-preferences')); panel.close(); notify('Football interests saved.'); });
        panel.open();
    }
    catch {
        panel.card.append(element('p', 'muted', 'Club choices could not load. Reopen to retry.'));
        panel.open();
    }
}
export async function reportMessage(message) { const panel = dialog('Report this message'), form = element('form'), reason = field(form, 'What happened?', 'textarea'), send = actionButton('Submit report', 'info', 'primary-button'); reason.required = true; reason.maxLength = 500; send.type = 'submit'; form.append(element('p', 'muted', 'Your report is private. Group mute and block controls are also available.'), send); panel.card.append(form); form.addEventListener('submit', async (event) => { event.preventDefault(); send.disabled = true; try {
    await call('kaidra_report', { target_message: message.id, reason: reason.value.trim() });
    panel.close();
    notify('Report submitted for review.');
}
catch {
    notify('Could not submit your report. Retry.');
    send.disabled = false;
} }); panel.open(); }
async function homeSocial() {
    const target = document.getElementById('home-social-picks');
    if (!target || !currentUser)
        return;
    const generation = ++homeVersion;
    try {
        const rows = await call('kaidra_social_recommendations');
        if (generation !== homeVersion)
            return;
        target.replaceChildren();
        target.closest('section').classList.toggle('hidden', !rows.length);
        for (const row of rows.slice(0, 3)) {
            const card = element('article', 'social-recommendation');
            card.append(element('p', 'eyebrow', 'YOUR FRIENDS ARE ONTO SOMETHING'), element('p', '', `${row.friend_count} friends saved ${row.item.title}.`), richCard(row.item, true));
            const actions = element('div', 'detail-actions'), save = actionButton('Watchlist', 'bookmark'), dismiss = actionButton('Not interested', 'close');
            save.addEventListener('click', async () => { await toggleLibrary(row.item, 'watchlist'); homeSocial(); });
            dismiss.addEventListener('click', async () => { try {
                await call('kaidra_social_dismiss', { provider: row.item.provider, media_type: row.item.kind, external_id: String(row.item.id), not_interested: true });
                homeSocial();
            }
            catch {
                notify('Could not dismiss. Retry.');
            } });
            actions.append(save, dismiss);
            card.append(actions);
            target.append(card);
        }
    }
    catch {
        target.closest('section').classList.add('hidden');
    }
    const activity = document.getElementById('home-battles');
    if (activity) {
        const { data, error } = await supabase.from('battles').select('id,status,created_at').order('created_at', { ascending: false }).limit(4);
        if (generation !== homeVersion)
            return;
        activity.replaceChildren();
        activity.closest('section').classList.toggle('hidden', !!error || !data?.length);
        if (data?.length)
            activity.append(...data.map(b => battleCard(b.id)));
    }
}
function refreshSocial() { requests.clear(); document.dispatchEvent(new CustomEvent('kaidra:social-refresh')); homeSocial(); if (profileTarget)
    renderSocialProfile(profileTarget.targetUser, profileTarget.own); }
let settingsReady = false;
async function settings() { const button = document.getElementById('save-social-settings'); button.disabled = true; const { data, error } = await supabase.from('social_preferences').select('*').eq('user_id', currentUser).maybeSingle(); if (error) {
    button.textContent = 'Retry loading preferences';
    button.disabled = false;
    settingsReady = false;
    return;
} settingsReady = true; button.disabled = false; button.textContent = 'Save social preferences'; const visibility = document.getElementById('activity-visibility'); visibility.value = data?.activity_visibility || 'private'; document.querySelectorAll('[data-notify-category]').forEach(input => input.checked = data?.notifications?.[input.dataset.notifyCategory] !== false); }
function connect() { if (channel)
    supabase.removeChannel(channel); channel = supabase.channel(`social:${currentUser}`).on('postgres_changes', { event: '*', schema: 'public', table: 'social_signals', filter: `user_id=eq.${currentUser}` }, refreshSocial).subscribe(status => { if (status === 'SUBSCRIBED')
    refreshSocial(); }); }
document.getElementById('save-social-settings')?.addEventListener('click', async (event) => { const button = event.currentTarget; if (!settingsReady) {
    await settings();
    return;
} button.disabled = true; const notifications = Object.fromEntries([...document.querySelectorAll('[data-notify-category]')].map(input => [input.dataset.notifyCategory, input.checked])); try {
    await call('kaidra_social_settings', { visibility: document.getElementById('activity-visibility').value, notifications });
    notify('Social preferences saved.');
    refreshSocial();
}
catch {
    notify('Could not save social preferences. Retry.');
}
finally {
    button.disabled = false;
} });
document.getElementById('settings-football-interests')?.addEventListener('click', () => footballPreferences());
document.addEventListener('kaidra:route-change', event => { if (event.detail.view === 'battle') {
    renderBattle(event.detail.id).catch(() => { notify('This debate is unavailable.'); backRoute('inbox'); });
}
else if (battlePanel) {
    ++battleVersion;
    const panel = battlePanel;
    battlePanel = null;
    panel.close();
} if (event.detail.view === 'home')
    homeSocial(); });
document.addEventListener('kaidra:modal-close', event => { if (event.detail.id === battlePanel?.id) {
    ++battleVersion;
    battlePanel = null;
    if (parseRoute(location.hash).view === 'battle')
        backRoute('inbox');
} if (event.detail.id === battlePanel?.id || event.detail.id?.startsWith('context-dialog-') && !battlePanel) {
    if (battleChannel)
        supabase.removeChannel(battleChannel);
    battleChannel = null;
} });
document.addEventListener('kaidra:friends-changed', refreshSocial);
document.addEventListener('kaidra:class-awakened', refreshSocial);
document.addEventListener('kaidra:library-change', () => { if (currentUser)
    homeSocial(); });
window.addEventListener('pagehide', () => { if (channel)
    supabase.removeChannel(channel); if (battleChannel)
    supabase.removeChannel(battleChannel); channel = battleChannel = null; });
window.addEventListener('pageshow', event => { if (event.persisted && currentUser)
    connect(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentUser)
    refreshSocial(); });
(async () => { const current = await account; if (!current)
    return; currentUser = current.userId; connect(); settings(); homeSocial(); })();
async function battleHistory(userId) { const panel = dialog('Your debate history'), list = element('div', 'battle-history'); panel.card.append(list); panel.open(); let offset = 0, busy = false; const more = actionButton('More debates', 'arrow'); panel.card.append(more); async function load() { if (busy)
    return; busy = true; more.disabled = true; try {
    const { data, error } = await supabase.from('battles').select('id,status,created_at').or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`).order('created_at', { ascending: false }).range(offset, offset + 9);
    if (error)
        throw error;
    if (!list.isConnected)
        return;
    list.append(...data.map(row => battleCard(row.id)));
    offset += data.length;
    more.hidden = data.length < 10;
    if (!offset)
        list.append(emptyState('Your first debate starts with a friend', 'Open a conversation, title or match to issue a friendly challenge.', 'spark'));
}
catch {
    notify('Debate history could not load. Retry.');
}
finally {
    busy = false;
    more.disabled = false;
} } more.addEventListener('click', load); load(); }
