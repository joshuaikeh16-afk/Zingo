import {supabase,chatAction} from './supabase-client.js';
import {account} from './session.js';
import {confirmAction} from './context-menu.js';
export async function forfeitInConversation(conversationId){
 const current=await account;if(!current)return;
 const {data,error}=await supabase.from('battles').select('id').eq('conversation_id',conversationId).eq('combat_version',1).eq('status','active').limit(2);
 if(error)throw error;if(!data?.length)throw new Error('There is no active RPG battle in this conversation.');if(data.length>1)throw new Error('Open your battle arena to forfeit the correct match.');
 const state=await chatAction('kaidra_combat_state',{target_battle:data[0].id}),own=state.fighters.find(f=>f.user_id===current.userId);
 if(!own||own.hp<=0)throw new Error('Only a living participant can forfeit their own fighter.');
 if(!await confirmAction('Forfeit your fighter?',state.fighters.length>2?'Your teammate may continue. You control only your own fighter.':'Your opponent wins this duel.','Forfeit'))return;
 const {data:result,error:problem}=await supabase.functions.invoke('combat-api',{body:{action:'surrender',battle_id:data[0].id,request_id:crypto.randomUUID(),expected_revision:state.combat.revision}});
 if(problem||result?.code)throw new Error('The battle changed. Open the arena and retry.');
}
