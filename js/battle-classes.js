import { element } from './ui.js';

// Presentation only. Assignment and scoring live exclusively in authorized server functions.
export const battleClasses=Object.freeze({
 warrior:{name:'Warrior',tagline:'Meet resistance with force.',summary:'Power. Endurance. Direct pressure.',description:'You meet resistance head-on and commit when others hesitate.',attack:'Heavy pressure and guard breaking',defense:'Brace, parry and withstand',motion:'impact',color:'#efae70',paths:['M32 9 38 19 35 36 42 48 38 52 30 40 22 48 18 44 29 34 26 19Z','M13 12 19 15 23 23 17 20Z','M45 38 52 45 50 51 43 44Z']},
 wizard:{name:'Wizard',tagline:'Knowledge turns possibility into power.',summary:'Planning. Control. Resourcefulness.',description:'You make deliberate choices, shaping the situation before committing.',attack:'Magic, planned combinations and control',defense:'Barriers, shields and mitigation',motion:'orbit',color:'#bba0ff',paths:['M32 12 49 22 49 42 32 52 15 42 15 22Z','M32 20 42 26 42 38 32 44 22 38 22 26Z','M32 5V13M32 51V59M5 32H13M51 32H59','M27 32 32 24 37 32 32 40Z']},
 ninja:{name:'Ninja',tagline:'Strike where they cannot follow.',summary:'Speed. Adaptability. Evasion.',description:'You change rhythm quickly and deny pressure a clear target.',attack:'Rapid combinations and opportunistic movement',defense:'Evade, reposition and adapt',motion:'afterimage',color:'#87d7e5',paths:['M12 26 52 20 44 39 32 46 20 39Z','M19 29 28 27 25 33ZM45 26 36 28 39 33Z','M20 14 46 9M15 48 39 53']},
 guardian:{name:'Guardian',tagline:'Stand when others would fall.',summary:'Patience. Defense. Counters.',description:'You hold your ground, read commitment and turn pressure back on itself.',attack:'Counters and punishment of reckless commitment',defense:'Block, shield and absorb pressure',motion:'barrier',color:'#99d4b6',paths:['M32 8 51 17 48 36Q45 49 32 56Q19 49 16 36L13 17Z','M32 18 41 23 40 36 32 44 24 36 23 23Z','M32 18V44M23 29H41']},
 rogue:{name:'Rogue',tagline:'Opportunity belongs to those who see it first.',summary:'Risk. Deception. Exploitation.',description:'You spot overlooked openings and turn expectations into opportunities.',attack:'Feints, conditional pressure and calculated risk',defense:'Misdirection, disruption and momentum stealing',motion:'misdirection',color:'#e895b7',paths:['M11 28Q21 13 32 25Q43 13 53 28L47 42 37 38 32 48 27 38 17 42Z','M19 29 27 28 24 34ZM45 29 37 28 40 34Z','M26 16 32 9 38 16','M22 51 30 55M40 51 34 55']},
 healer:{name:'Healer',tagline:'Keep hope standing.',summary:'Restoration. Clarity. Resilience.',description:'You create breathing room, restore balance and act decisively when it matters.',attack:'Radiant pressure and judgement',defense:'Restoration, purification and shields',motion:'restoration',color:'#eadf9d',paths:['M32 7 48 23 48 42 32 57 16 42 16 23Z','M27 21H37V27H43V37H37V43H27V37H21V27H27Z','M32 7V16M32 48V57']},
 ranger:{name:'Ranger',tagline:'See the opening. Make it count.',summary:'Precision. Preparation. Distance.',description:'You observe carefully, prepare the field and turn a clear opening into a decisive action.',attack:'Precise shots, marking and traps',defense:'Distance and controlled repositioning',motion:'projectile',color:'#a7dfb6',paths:['M20 10Q54 32 20 54L26 32Z','M10 32H52M43 24 52 32 43 40','M20 10V54']},
 berserker:{name:'Berserker',tagline:'Turn danger into momentum.',summary:'Aggression. Courage. Measured risk.',description:'You commit under pressure, knowing every surge of momentum has a price.',attack:'Rage, recoil and pressure at low HP',defense:'Aggression and resilience',motion:'rage',color:'#f48f7b',paths:['M32 8 45 17 40 27 52 39 43 52 32 43 21 52 12 39 24 27 19 17Z','M26 29 32 19 38 29 32 42Z']}

});

export function classEmblem(id,decorative=true){
 const metadata=battleClasses[id],svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 64 64');svg.classList.add('class-emblem');
 if(decorative)svg.setAttribute('aria-hidden','true');else{svg.setAttribute('role','img');svg.setAttribute('aria-label',metadata?`${metadata.name} emblem`:'Undetermined class');}
 for(const d of metadata?.paths||['M32 14 50 32 32 50 14 32Z','M32 24V34M32 40V41']){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);svg.append(path);}return svg;
}

export function classIdentity(identity,{compact=false}={}){
 const metadata=battleClasses[identity?.class_id];if(!metadata)return null;
 const card=element('div',compact?'class-identity compact':'class-identity');card.dataset.class=identity.class_id;card.style.setProperty('--class-color',metadata.color);
 const text=element('div');text.append(element('strong','',metadata.name),element('small','muted',identity.league_label||'Unranked'));
 if(!compact)text.append(element('p','',metadata.summary));card.append(classEmblem(identity.class_id),text);return card;
}
