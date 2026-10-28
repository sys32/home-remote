import test from 'node:test';
import assert from 'node:assert/strict';
import {SleepTimer} from '../sleep.mjs';

test('sleep timer targets one TV, replaces older timer and cancels safely',async()=>{
  const pending=new Map();let sequence=0,fired=0;const changes=[];
  const clock={now:()=>1000,set:(fn,ms)=>{const id=++sequence;pending.set(id,{fn,ms});return id;},clear:id=>pending.delete(id)};
  const timer=new SleepTimer(value=>changes.push(value),error=>assert.equal(error,null),clock);
  assert.throws(()=>timer.schedule(0,{ip:'test'},()=>{}));assert.throws(()=>timer.schedule(181,{ip:'test'},()=>{}));
  const first=timer.schedule(15,{ip:'192.168.1.5',name:'TV'},()=>fired++);assert.equal(first.endsAt,901000);assert.equal(pending.get(1).ms,900000);
  const old=pending.get(1).fn;
  timer.schedule(30,{ip:'192.168.1.6',name:'Other'},()=>fired++);assert.equal(pending.has(1),false);await old();assert.equal(fired,0);
  timer.cancel();assert.equal(pending.size,0);assert.equal(timer.value,null);
  timer.schedule(1,{ip:'192.168.1.5',name:'TV'},()=>fired++);await pending.get(3).fn();assert.equal(fired,1);assert.equal(timer.value,null);assert.equal(changes.at(-1),null);
});

test('timer reports failure without pretending the TV turned off',async()=>{
  let fire,reported;
  const timer=new SleepTimer(()=>{},error=>reported=error,{now:()=>0,set:fn=>(fire=fn,1),clear:()=>{}});
  timer.schedule(5,{ip:'192.168.1.5',name:'TV'},()=>{throw Error('Disconnected');});await fire();assert.match(reported.message,/Disconnected/);
});
