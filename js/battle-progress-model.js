export function progressionValues(stats = {}) {
 const count = key => Math.max(0, Math.floor(Number(stats[key]) || 0));
 const xp=count('xp'),battles=count('battles'),wins=count('wins'),streak=count('streak');
 return {xp,level:1+Math.floor(xp/100),progress:xp%100,nextLevelXp:(Math.floor(xp/100)+1)*100,
  battles,wins,losses:count('losses'),draws:count('draws'),streak,bestStreak:Math.max(streak,count('best_streak')),
  winRate:battles?Math.round(wins/battles*100):0};
}

