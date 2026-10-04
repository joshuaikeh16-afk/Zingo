import test from 'node:test';
import assert from 'node:assert/strict';
import { progressionValues } from '../js/battle-progress-model.js';

test('a new account has a complete zero-result record and starts at level one',()=>{
 assert.deepEqual(progressionValues(),{xp:0,level:1,progress:0,nextLevelXp:100,battles:0,wins:0,losses:0,draws:0,streak:0,bestStreak:0,winRate:0});
});
test('crossing a level threshold resets only the bar, not total XP',()=>{
 const before=progressionValues({xp:99}),after=progressionValues({xp:100});
 assert.equal(before.level,1);assert.equal(before.progress,99);
 assert.equal(after.level,2);assert.equal(after.progress,0);assert.equal(after.nextLevelXp,200);assert.equal(after.xp,100);
});
test('draws count in the result record, while a reset streak preserves its best',()=>{
 const s=progressionValues({xp:245,battles:6,wins:3,losses:2,draws:1,streak:0,best_streak:3});
 assert.equal(s.winRate,50);assert.equal(s.draws,1);assert.equal(s.bestStreak,3);assert.equal(s.streak,0);assert.equal(s.progress,45);
});
