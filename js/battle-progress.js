import { element } from './ui.js';

import { progressionValues } from './battle-progress-model.js';

export function progressionCard(stats) {
 const s=progressionValues(stats),card=element('section','battle-progression');card.setAttribute('aria-label','Battle progression');
 const heading=element('div','battle-progress-heading');heading.append(element('strong','',`Level ${s.level}`),element('span','muted',`${s.xp.toLocaleString()} XP`));
 const track=element('progress','battle-xp-track');track.max=100;track.value=s.progress;track.setAttribute('aria-label',`${s.progress} of 100 XP toward level ${s.level+1}`);
 card.append(heading,track,element('small','muted',`${100-s.progress} XP to level ${s.level+1}`));
 const records=element('dl','battle-records');
 for(const [label,value] of [['Wins',s.wins],['Losses',s.losses],['Draws',s.draws],['Win rate',`${s.winRate}%`],['Current streak',s.streak],['Best streak',s.bestStreak]]){
  const item=element('div');item.append(element('dt','',label),element('dd','',String(value)));records.append(item);
 }
 card.append(records);return card;
}
