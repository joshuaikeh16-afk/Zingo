// Server-only combat rules. Clients submit intentions; never HP or damage.
export class CombatError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
export type Ability={id:string;name:string;kind:string;target:'enemy'|'ally'|'self'|'all_enemies';cost:number;cooldown:number;min?:number;max?:number;amount?:number;duration?:number;hits?:number;description:string;condition?:string};
const ability=(id:string,name:string,kind:string,target:Ability['target'],cost:number,cooldown:number,description:string,extra:Partial<Ability>={}):Ability=>({id,name,kind,target,cost,cooldown,description,...extra});
export const kits:Record<string,{hp:number;resource:string;start:number;speed:number;abilities:Ability[]}>= {
 warrior:{hp:120,resource:'Stamina',start:100,speed:4,abilities:[ability('slash','Slash','attack','enemy',0,0,'Reliable physical pressure.',{min:16,max:20}),ability('guard_break','Guard Break','pierce','enemy',20,2,'Break half of shields and guarding.',{min:24,max:28}),ability('parry','Parry','counter','self',15,2,'Reduce one hit by 50% and retaliate for 8.',{amount:8,duration:2}),ability('battle_cry','Battle Cry','buff','self',25,3,'Add 6 damage to attacks for 3 own turns.',{amount:6,duration:3}),ability('last_stand','Last Stand','attack','enemy',30,4,'Heavy pressure when your HP is at most 35%.',{min:30,max:38,condition:'low_hp'})]},
 wizard:{hp:100,resource:'Mana',start:100,speed:3,abilities:[ability('arcane_bolt','Arcane Bolt','attack','enemy',10,0,'A reliable magical attack.',{min:14,max:18}),ability('hex','Hex','weaken','enemy',20,2,'Reduce outgoing damage by 6 for 2 own turns.',{amount:6,duration:2}),ability('barrier','Barrier','shield','self',25,2,'Absorb 28 damage for up to 3 own turns.',{amount:28,duration:3}),ability('mana_focus','Mana Focus','focus','self',0,2,'Recover 35 mana instead of attacking.',{amount:35}),ability('arcane_burst','Arcane Burst','cast','enemy',40,3,'Telegraph a spell. 32–40 damage resolves before your next turn. Disruption can interrupt it.',{min:32,max:40,duration:1})]},
 ninja:{hp:100,resource:'Energy',start:100,speed:8,abilities:[ability('shadow_strike','Shadow Strike','attack','enemy',10,0,'Fast, precise damage.',{min:18,max:22}),ability('smoke_step','Smoke Step','evade','self',20,2,'Reduce the next incoming attack by 70%.',{amount:70,duration:2}),ability('kunai_rush','Kunai Rush','multi','enemy',25,2,'Three hits. Shields absorb each hit.',{min:7,max:8,hits:3}),ability('afterimage','Afterimage','evade','self',30,3,'Reduce the next two incoming hits by 55%.',{amount:55,hits:2,duration:2}),ability('execution','Execution','execute','enemy',30,3,'18–22 damage; adds 14 against a target below 35% HP.',{min:18,max:22,amount:14})]},
 guardian:{hp:125,resource:'Guard',start:100,speed:2,abilities:[ability('shield_bash','Shield Bash','interrupt','enemy',10,1,'Damage and interrupt a charging spell.',{min:12,max:16}),ability('fortify','Fortify','guard','self',20,2,'Reduce incoming damage by 45% for 2 own turns.',{amount:45,duration:2}),ability('perfect_guard','Perfect Guard','guard_once','self',30,3,'Reduce one incoming attack by 80%.',{amount:80,duration:2}),ability('counter','Counter','counter','self',20,2,'Reduce one attack by 50% and retaliate for 14.',{amount:14,duration:2}),ability('unbreakable','Unbreakable','shield','self',40,4,'Absorb 40 damage for up to 3 own turns.',{amount:40,duration:3}),ability('protect','Protect','protect','ally',25,2,'Intercept 60% of attacks aimed at an ally for 2 own turns. Intercepted damage uses your defenses.',{amount:60,duration:2})]},
 rogue:{hp:105,resource:'Momentum',start:100,speed:6,abilities:[ability('cheap_shot','Cheap Shot','exploit','enemy',0,0,'14–18 damage. Add 10 if the target is marked or vulnerable.',{min:14,max:18,amount:10}),ability('feint','Feint','vulnerable','enemy',15,2,'Remove guarding and create an opening: +6 incoming damage for 2 own turns.',{amount:6,duration:2}),ability('sabotage','Sabotage','sabotage','enemy',20,2,'Steal up to 20 resource and weaken attacks by 4 for 2 own turns.',{amount:20,duration:2}),ability('mark','Mark','marked','enemy',15,2,'Expose an opening: +5 incoming damage for 3 own turns.',{amount:5,duration:3}),ability('all_in','All In','reckless','enemy',35,3,'34–44 damage. You lose 12 HP and become vulnerable.',{min:34,max:44,amount:12,duration:2})]},
 healer:{hp:105,resource:'Spirit',start:100,speed:3,abilities:[ability('radiant_strike','Radiant Strike','attack','enemy',0,0,'Reliable light damage.',{min:16,max:20}),ability('restoration','Restoration','heal','ally',30,3,'Restore 26 HP. Late-battle healing is reduced.',{amount:26}),ability('purify','Purify','purify','ally',20,2,'Remove negative statuses and restore 8 HP.',{amount:8}),ability('sacred_shield','Sacred Shield','shield','ally',25,2,'Absorb 28 damage for up to 3 own turns.',{amount:28,duration:3}),ability('regeneration','Regeneration','regen','ally',25,4,'Restore 8 HP at the start of 3 own turns.',{amount:8,duration:3}),ability('judgement','Judgement','attack','enemy',25,3,'A decisive light attack.',{min:28,max:34})]},
 ranger:{hp:105,resource:'Focus',start:100,speed:5,abilities:[ability('quick_shot','Quick Shot','attack','enemy',0,0,'A reliable ranged shot.',{min:18,max:22}),ability('mark_target','Mark Target','marked','enemy',15,2,'Expose a precise opening: +6 incoming damage for 3 own turns.',{amount:6,duration:3}),ability('piercing_shot','Piercing Shot','pierce','enemy',25,2,'Bypass half of shielding and guarding.',{min:26,max:30}),ability('trap','Trap','trap','enemy',20,3,'The next offensive action triggers 10 damage.',{amount:10,duration:3}),ability('reposition','Reposition','guard','self',20,2,'Create distance: reduce damage by 35% for 2 own turns.',{amount:35,duration:2}),ability('volley','Volley','attack','all_enemies',35,3,'A measured volley against every living enemy.',{min:15,max:19})]},
 berserker:{hp:125,resource:'Rage',start:40,speed:4,abilities:[ability('blood_strike','Blood Strike','blood','enemy',0,0,'22–26 damage, at a cost of 6 HP. Low HP adds up to 6 pressure.',{min:22,max:26,amount:6}),ability('reckless_assault','Reckless Assault','reckless','enemy',25,2,'32–40 damage. Lose 12 HP and become vulnerable.',{min:32,max:40,amount:12,duration:2}),ability('frenzy','Frenzy','frenzy','self',25,3,'Add 8 outgoing damage but take 6 extra damage for 3 own turns.',{amount:8,duration:3}),ability('rage','Rage','rage','self',0,2,'Gain 40 rage at a cost of 6 HP.',{amount:40}),ability('deaths_door','Death’s Door','attack','enemy',40,4,'40–48 damage, usable at most 35% HP. Remaining at low HP is dangerous.',{min:40,max:48,condition:'low_hp'})]}
};
export type Fighter={user_id:string;team:number;class_id:string;hp:number;max_hp:number;resource:number;turn_order:number;turns:number;timeouts:number;ready:boolean};
export type Effect={id:string;kind:string;source:string;target:string;amount:number;expires:number;charges:number;data?:any};
export type Combat={id:string;phase:string;active_id:string|null;turn:number;round:number;revision:number;deadline:string|null;seed:string;winning_team:number|null;fighters:Fighter[];effects:Effect[];cooldowns:{user_id:string;ability_id:string;ready_turn:number}[]};
export type Intent={actor:string;ability?:string;target?:string|null;request_id:string;expected_revision:number;action?:'act'|'surrender'|'timeout'};
const hostile=new Set(['weaken','vulnerable','marked','trap','bleed','poison','burn','healing_reduction']);
export function resolveCombat(input:Combat,intent:Intent,now=Date.now()) {
 const s:Combat=structuredClone(input),events:any[]=[];let rngCounter=0;
 const rng=()=>{let n=2166136261;for(const c of `${s.seed}:${s.turn}:${rngCounter++}`)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0)/4294967296;};
 const emit=(kind:string,source:string|null,target:string|null,amount=0,extra:any={})=>events.push({kind,source,target,amount,...extra});
 const effects=(f:Fighter,kind:string)=>s.effects.filter(e=>e.target===f.user_id&&e.kind===kind);
 const remove=(effect:Effect)=>{s.effects=s.effects.filter(e=>e.id!==effect.id);emit('status_removed',effect.source,effect.target,0,{status:effect.kind});};
 const apply=(kind:string,actor:Fighter,target:Fighter,amount:number,duration=2,charges=-1,data:any=null)=>{for(const e of effects(target,kind))remove(e);s.effects.push({id:`${intent.request_id}:${events.length}:${kind}:${target.user_id}`,kind,source:actor.user_id,target:target.user_id,amount,expires:target.turns+duration+(actor.user_id===target.user_id?1:0),charges,data});emit('status_applied',actor.user_id,target.user_id,amount,{status:kind,duration});};
 const heal=(actor:Fighter,target:Fighter,amount:number)=>{const pressure=Math.max(.2,1-Math.max(0,s.round-12)*.06),reduction=effects(target,'healing_reduction').reduce((n,e)=>Math.max(n,e.amount),0);const actual=Math.min(target.max_hp-target.hp,Math.round(amount*pressure*(1-reduction/100)));target.hp+=actual;emit('heal',actor.user_id,target.user_id,actual);};
 const damage=(actor:Fighter,target:Fighter,base:number,pierce=false,redirect=false,secondary=false)=>{
  if(target.hp<=0)return;
  let amount=Math.max(1,base),blocked=0;
  const protect=effects(target,'protect').find(e=>e.source!==target.user_id&&s.fighters.some(f=>f.user_id===e.source&&f.hp>0));
  if(protect&&!redirect){const guardian=s.fighters.find(f=>f.user_id===protect.source)!;const intercepted=Math.floor(amount*protect.amount/100);amount-=intercepted;damage(actor,guardian,intercepted,pierce,true,true);emit('intercept',guardian.user_id,target.user_id,intercepted);}
  if(!secondary){amount+=effects(actor,'buff').reduce((n,e)=>n+e.amount,0);amount-=effects(actor,'weaken').reduce((n,e)=>n+e.amount,0);amount+=effects(target,'marked').reduce((n,e)=>n+e.amount,0)+effects(target,'vulnerable').reduce((n,e)=>n+e.amount,0);if(actor.class_id==='berserker')amount+=Math.min(6,Math.floor((1-actor.hp/actor.max_hp)*7));amount+=Math.max(0,s.round-12)*2;}
  amount=Math.max(1,amount);const before=amount;
  const guard=Math.max(0,...s.effects.filter(e=>e.target===target.user_id&&['guard','guard_once','counter','evade'].includes(e.kind)).map(e=>e.kind==='counter'?50:e.amount));amount=Math.max(1,Math.round(amount*(1-guard/100*(pierce?.5:1))));
  for(const e of s.effects.filter(e=>e.target===target.user_id&&['guard_once','counter','evade'].includes(e.kind))){if(e.charges>0)e.charges--;if(e.charges===0)remove(e);}
  for(const shield of effects(target,'shield')){const absorbed=Math.min(shield.amount,Math.floor(amount*(pierce?.5:1)));shield.amount-=absorbed;amount-=absorbed;if(shield.amount<=0)remove(shield);}
  blocked=before-amount;const actual=Math.min(target.hp,amount);target.hp-=actual;if(target.class_id==='berserker')target.resource=Math.min(100,target.resource+Math.min(12,Math.ceil(actual/2)));emit('damage',actor.user_id,target.user_id,actual,{blocked,redirected:redirect});if(target.hp===0)emit('fighter_defeated',actor.user_id,target.user_id);
 };
 const strike=(actor:Fighter,target:Fighter,a:Ability)=>{
  for(let hit=0;hit<(a.hits||1);hit++){let base=Math.floor((a.min||0)+rng()*((a.max||a.min||0)-(a.min||0)+1));if(a.kind==='execute'&&target.hp/target.max_hp<=.35)base+=a.amount||0;if(a.kind==='exploit'&&s.effects.some(e=>e.target===target.user_id&&['marked','vulnerable'].includes(e.kind)))base+=a.amount||0;const counter=effects(target,'counter')[0];damage(actor,target,base,a.kind==='pierce');if(counter&&actor.hp>0&&target.hp>0)damage(target,actor,counter.amount,false,false,true);}
 };
 const finish=()=>{const alive=[...new Set(s.fighters.filter(f=>f.hp>0).map(f=>f.team))];if(alive.length<=1){s.phase='finished';s.winning_team=alive[0]??null;s.active_id=null;s.deadline=null;emit('battle_finished',null,null,0,{winning_team:s.winning_team});return true;}return false;};
 if(s.phase!=='playing')throw new CombatError('BATTLE_NOT_ACTIVE');if(intent.expected_revision!==s.revision)throw new CombatError('STALE_TURN');
 const actor=s.fighters.find(f=>f.user_id===intent.actor);if(!actor||actor.hp<=0)throw new CombatError('FIGHTER_UNAVAILABLE');
 const timeout=intent.action==='timeout';if(timeout&&(!s.deadline||now<Date.parse(s.deadline)))throw new CombatError('TURN_STILL_OPEN');
 if(intent.action==='surrender'){actor.hp=0;emit('fighter_defeated',actor.user_id,actor.user_id,0,{surrender:true});}
 else {
  if(actor.user_id!==s.active_id)throw new CombatError('NOT_YOUR_TURN');if(!timeout&&s.deadline&&now>=Date.parse(s.deadline))throw new CombatError('TURN_EXPIRED');
  if(timeout){actor.timeouts++;if(actor.timeouts>=3){actor.hp=0;emit('fighter_defeated',actor.user_id,actor.user_id,0,{timeouts:true});}else {apply('guard_once',actor,actor,20,1,1);emit('turn_timeout',actor.user_id,null);}}
  else {
   actor.timeouts=0;
   const basic:Ability=ability('basic','Basic Attack','attack','enemy',0,0,'A low-pressure fallback.',{min:10,max:14});const a=intent.ability==='basic'?basic:kits[actor.class_id]?.abilities.find(a=>a.id===intent.ability);if(!a)throw new CombatError('INVALID_ABILITY');
   if(actor.resource<a.cost)throw new CombatError('INSUFFICIENT_RESOURCE');if(s.cooldowns.some(c=>c.user_id===actor.user_id&&c.ability_id===a.id&&c.ready_turn>actor.turns))throw new CombatError('ABILITY_COOLDOWN');if(a.condition==='low_hp'&&actor.hp/actor.max_hp>.35)throw new CombatError('ABILITY_CONDITION');
   const target=a.target==='self'?actor:s.fighters.find(f=>f.user_id===intent.target);const targets=a.target==='all_enemies'?s.fighters.filter(f=>f.team!==actor.team&&f.hp>0):target?[target]:[];
   if(a.id==='protect'&&intent.target===actor.user_id)throw new CombatError('INVALID_TARGET');
   if(!targets.length||targets.some(t=>t.hp<=0||(a.target==='enemy'&&t.team===actor.team)||(a.target==='ally'&&t.team!==actor.team))||(a.target==='self'&&intent.target&&intent.target!==actor.user_id))throw new CombatError('INVALID_TARGET');
   actor.resource-=a.cost;s.cooldowns=s.cooldowns.filter(c=>!(c.user_id===actor.user_id&&c.ability_id===a.id));if(a.cooldown)s.cooldowns.push({user_id:actor.user_id,ability_id:a.id,ready_turn:actor.turns+a.cooldown+1});emit('ability_used',actor.user_id,target?.user_id||null,0,{ability_id:a.id,name:a.name,class_id:actor.class_id});
   for(const t of targets){
    if(['attack','pierce','multi','execute','exploit','blood','reckless','interrupt'].includes(a.kind)){strike(actor,t,a);if(a.kind==='interrupt')for(const e of effects(t,'casting'))remove(e);}
    else if(a.kind==='cast')apply('casting',actor,actor,0,2,1,{ability_id:a.id,target:t.user_id});
    else if(a.kind==='heal')heal(actor,t,a.amount||0);
    else if(a.kind==='purify'){for(const e of s.effects.filter(e=>e.target===t.user_id&&hostile.has(e.kind)))remove(e);heal(actor,t,a.amount||0);}
    else if(a.kind==='focus'||a.kind==='rage'){actor.resource=Math.min(100,actor.resource+(a.amount||0));if(a.kind==='rage')actor.hp=Math.max(0,actor.hp-6);emit('resource',actor.user_id,actor.user_id,a.amount||0);}
    else if(a.kind==='sabotage'){const stolen=Math.min(t.resource,a.amount||0);t.resource-=stolen;actor.resource=Math.min(100,actor.resource+stolen);apply('weaken',actor,t,4,a.duration);}
    else if(a.kind==='frenzy'){apply('buff',actor,actor,a.amount||0,a.duration);apply('vulnerable',actor,actor,6,a.duration);}
    else {if(a.kind==='vulnerable')for(const e of s.effects.filter(e=>e.target===t.user_id&&['guard','guard_once','counter'].includes(e.kind)))remove(e);apply(a.kind,actor,t,a.amount||0,a.duration,a.kind==='evade'?(a.hits||1):a.kind==='counter'||a.kind==='guard_once'?1:-1);}
   }
   if(a.kind==='blood'||a.kind==='reckless'){actor.hp=Math.max(0,actor.hp-(a.amount||0));emit('recoil',actor.user_id,actor.user_id,a.amount||0);if(a.kind==='reckless')apply('vulnerable',actor,actor,5,a.duration);}
   if(['attack','pierce','multi','execute','exploit','blood','reckless','interrupt','cast'].includes(a.kind))for(const trap of effects(actor,'trap')){const source=s.fighters.find(f=>f.user_id===trap.source);if(source)damage(source,actor,trap.amount,false,false,true);remove(trap);}
  }
  actor.turns++;actor.resource=Math.min(100,actor.resource+(actor.class_id==='berserker'?8:10));
 }
 s.revision++;
 if(finish())return {state:s,events};
 if(actor.user_id!==s.active_id&&intent.action==='surrender')return {state:s,events};
 let previous=actor.turn_order;
 for(let pass=0;pass<s.fighters.length;pass++){
  const alive=s.fighters.filter(f=>f.hp>0).sort((a,b)=>a.turn_order-b.turn_order);const next=alive.find(f=>f.turn_order>previous)||alive[0];previous=next.turn_order;s.active_id=next.user_id;s.turn++;s.round=1+Math.floor((s.turn-1)/s.fighters.length);
  for(const e of s.effects.filter(e=>e.target===next.user_id&&e.kind!=='casting'&&e.expires<=next.turns))remove(e);
  for(const e of [...s.effects.filter(e=>e.target===next.user_id)]){
   const source=s.fighters.find(f=>f.user_id===e.source)||next;
   if(e.kind==='regen')heal(source,next,e.amount);
   if(['bleed','poison','burn'].includes(e.kind))damage(source,next,e.amount,false,false,true);
   if(e.kind==='casting'){const a=kits[next.class_id].abilities.find(a=>a.id===e.data?.ability_id),target=s.fighters.find(f=>f.user_id===e.data?.target);if(a&&target&&target.hp>0)strike(next,target,a);remove(e);}
  }
  if(s.round>=20){const amount=Math.min(next.hp,4+(s.round-20)*2);next.hp-=amount;emit('pressure',null,next.user_id,amount);}
  if(finish())break;
  if(next.hp>0){s.deadline=new Date((timeout?Date.parse(input.deadline!):now)+25000).toISOString();emit('turn_started',next.user_id,null,0,{turn:s.turn,round:s.round});break;}
 }
 return {state:s,events};
}
