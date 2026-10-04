import { element } from './ui.js';

// Presentation only. Assignment and scoring live exclusively in authorized server functions.
export const battleClasses=Object.freeze({
 warrior:{name:'Warrior',tagline:'Meet resistance with force.',summary:'Power. Endurance. Direct pressure.',description:'You meet resistance head-on and commit when others hesitate.',attack:'Heavy pressure and guard breaking',defense:'Brace, parry and withstand',motion:'impact',color:'#efae70',paths:['M32 9 38 19 35 36 42 48 38 52 30 40 22 48 18 44 29 34 26 19Z','M13 12 19 15 23 23 17 20Z','M45 38 52 45 50 51 43 44Z']},
 wizard:{name:'Wizard',tagline:'Knowledge turns possibility into power.',summary:'Planning. Control. Resourcefulness.',description:'You make deliberate choices, shaping the situation before committing.',attack:'Magic, planned combinations and control',defense:'Barriers, shields and mitigation',motion:'orbit',color:'#bba0ff',paths:['M32 12 49 22 49 42 32 52 15 42 15 22Z','M32 20 42 26 42 38 32 44 22 38 22 26Z','M32 5V13M32 51V59M5 32H13M51 32H59','M27 32 32 24 37 32 32 40Z']},
 ninja:{name:'Ninja',tagline:'Strike where they cannot follow.',summary:'Speed. Adaptability. Evasion.',description:'You change rhythm quickly and deny pressure a clear target.',attack:'Rapid combinations and opportunistic movement',defense:'Evade, reposition and adapt',motion:'afterimage',color:'#87d7e5',paths:['M12 26 52 20 44 39 32 46 20 39Z','M19 29 28 27 25 33ZM45 26 36 28 39 33Z','M20 14 46 9M15 48 39 53']},
 guardian:{name:'Guardian',tagline:'Stand when others would fall.',summary:'Patience. Defense. Counters.',description:'You hold your ground, read commitment and turn pressure back on itself.',attack:'Counters and punishment of reckless commitment',defense:'Block, shield and absorb pressure',motion:'barrier',color:'#99d4b6',paths:['M32 8 51 17 48 36Q45 49 32 56Q19 49 16 36L13 17Z','M32 18 41 23 40 36 32 44 24 36 23 23Z','M32 18V44M23 29H41']},
 rogue:{name:'Rogue',tagline:'Opportunity belongs to those who see it first.',summary:'Risk. Deception. Exploitation.',description:'You spot overlooked openings and turn expectations into opportunities.',attack:'Feints, conditional pressure and calculated risk',defense:'Misdirection, disruption and momentum stealing',motion:'misdirection',color:'#e895b7',paths:['M11 28Q21 13 32 25Q43 13 53 28L47 42 37 38 32 48 27 38 17 42Z','M19 29 27 28 24 34ZM45 29 37 28 40 34Z','M26 16 32 9 38 16','M22 51 30 55M40 51 34 55']}
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
