import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {createTtlCache, TTL}=await import(pathToFileURL(process.argv[2]).href);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const flush=async()=>{await Promise.resolve();await Promise.resolve()};
const checks=[];
const test=(name,fn)=>checks.push([name,fn]);

test('normal concurrency shares one load and caches result',async()=>{
 const c=createTtlCache();const d=deferred();let calls=0;
 const a=c.cached('k',100,()=>{calls++;return d.promise});
 const b=c.cached('k',100,()=>{calls++;return 'wrong'});await flush();assert.equal(calls,1);
 d.resolve('A');assert.deepEqual(await Promise.all([a,b]),['A','A']);assert.equal(c.get('k'),'A');assert.equal(c.stats().inflight,0);
});
test('synchronous throw clears pending state and permits next loader',async()=>{
 const c=createTtlCache();const e=new Error('synthetic sync failure');
 await assert.rejects(c.cached('k',100,()=>{throw e}),x=>x===e);
 assert.equal(c.stats().inflight,0);assert.equal(c.get('k'),undefined);
 assert.equal(await c.cached('k',100,()=> 'B'),'B');
});
test('asynchronous rejection clears pending state and permits next loader',async()=>{
 const c=createTtlCache();const e=new Error('synthetic async failure');
 await assert.rejects(c.cached('k',100,()=>Promise.reject(e)),x=>x===e);
 assert.equal(c.stats().inflight,0);assert.equal(c.get('k'),undefined);
 assert.equal(await c.cached('k',100,()=>Promise.resolve('B')),'B');
});
test('clear prevents old completion from repopulating empty cache',async()=>{
 const c=createTtlCache();const d=deferred();const a=c.cached('k',100,()=>d.promise);await flush();
 c.clear();d.resolve('A');assert.equal(await a,'A');assert.equal(c.get('k'),undefined);assert.equal(c.stats().inflight,0);
});
test('clear then explicit set preserves newer value',async()=>{
 const c=createTtlCache();const d=deferred();const a=c.cached('k',100,()=>d.promise);await flush();
 c.clear();c.set('k','B',100);d.resolve('A');assert.equal(await a,'A');assert.equal(c.get('k'),'B');
});
test('clear old completion cannot delete replacement inflight entry',async()=>{
 const c=createTtlCache();const old=deferred(),fresh=deferred();
 const a=c.cached('k',100,()=>old.promise);await flush();c.clear();
 const b=c.cached('k',100,()=>fresh.promise);await flush();old.resolve('A');assert.equal(await a,'A');
 assert.equal(c.get('k'),undefined);assert.equal(c.stats().inflight,1);
 let extra=0;const joined=c.cached('k',100,()=>{extra++;return 'wrong'});await flush();assert.equal(extra,0);
 fresh.resolve('B');assert.deepEqual(await Promise.all([b,joined]),['B','B']);assert.equal(c.get('k'),'B');assert.equal(c.stats().inflight,0);
});
test('explicit set invalidates old result only for that key',async()=>{
 const c=createTtlCache();const x=deferred(),y=deferred();
 const a=c.cached('x',100,()=>x.promise),b=c.cached('y',100,()=>y.promise);await flush();
 c.set('x','B',100);x.resolve('A');y.resolve('Y');assert.deepEqual(await Promise.all([a,b]),['A','Y']);
 assert.equal(c.get('x'),'B');assert.equal(c.get('y'),'Y');assert.equal(c.stats().inflight,0);
});
test('expired replacement still bars an older loader from publishing',async()=>{
 const c=createTtlCache();const d=deferred();const a=c.cached('k',100,()=>d.promise);await flush();
 c.set('k','B',0);assert.equal(c.get('k'),undefined);d.resolve('A');assert.equal(await a,'A');assert.equal(c.get('k'),undefined);
});
test('old completion after replacement completes cannot overwrite it',async()=>{
 const c=createTtlCache();const old=deferred(),fresh=deferred();const a=c.cached('k',100,()=>old.promise);await flush();c.clear();
 const b=c.cached('k',100,()=>fresh.promise);await flush();fresh.resolve('B');assert.equal(await b,'B');
 old.resolve('A');assert.equal(await a,'A');assert.equal(c.get('k'),'B');assert.equal(c.stats().inflight,0);
});
test('superseded rejection does not delete replacement pending loader',async()=>{
 const c=createTtlCache();const old=deferred(),fresh=deferred();const e=new Error('old failure');
 const a=c.cached('k',100,()=>old.promise);const failed=assert.rejects(a,x=>x===e);await flush();c.clear();
 const b=c.cached('k',100,()=>fresh.promise);await flush();old.reject(e);await failed;assert.equal(c.stats().inflight,1);
 fresh.resolve('B');assert.equal(await b,'B');assert.equal(c.get('k'),'B');
});
test('TTL equality, zero, negative and stale metadata unchanged',async()=>{
 const c=createTtlCache();let now=1000;const saved=Date.now;Date.now=()=>now;
 try{
  c.set('k','A',10);assert.deepEqual(c.peek('k'),{value:'A',expired:false,expiresAt:1010,cachedAt:1000,staleForMs:0});
  now=1009;assert.equal(c.get('k'),'A');now=1010;assert.equal(c.peek('k'),undefined);
  assert.deepEqual(c.peek('k',{allowExpired:true}),{value:'A',expired:true,expiresAt:1010,cachedAt:1000,staleForMs:10});assert.equal(c.get('k'),undefined);
  for(const ttl of [0,-1]){c.set('z','Z',ttl);assert.equal(c.get('z'),undefined)}
 }finally{Date.now=saved}
});
test('LRU get refreshes recency; peek does not',async()=>{
 const c=createTtlCache({maxEntries:2});c.set('a',1,100);c.set('b',2,100);c.get('a');c.set('c',3,100);
 assert.equal(c.get('b'),undefined);assert.equal(c.peek('a').value,1);c.set('d',4,100);assert.equal(c.get('a'),undefined);assert.equal(c.get('c'),3);assert.equal(c.get('d'),4);
});
test('falsey values and undefined miss behavior preserved',async()=>{
 for(const value of [null,false,0,'']){const c=createTtlCache();c.set('k',value,100);assert.equal(await c.cached('k',100,()=>{throw Error('unexpected load')}),value)}
 const c=createTtlCache();c.set('k',undefined,100);assert.equal(await c.cached('k',100,()=>42),42);
});
test('exports, stats accounting and clear counter retention unchanged',async()=>{
 assert.deepEqual(TTL,{CHART_DAILY:21600000,CHART_INTRADAY:300000,PROFILE:86400000});
 const c=createTtlCache({name:'probe'});assert.deepEqual(Object.keys(c).sort(),['cached','clear','get','peek','set','stats']);
 assert.deepEqual(c.stats(),{name:'probe',size:0,hits:0,misses:0,inflight:0});
 await c.cached('k',100,()=> 'A');await c.cached('k',100,()=> 'wrong');c.clear();
 assert.deepEqual(c.stats(),{name:'probe',size:0,hits:1,misses:1,inflight:0});
});
const realNow=Date.now;Date.now=()=>1000;
let failed=0;
for(const [name,fn] of checks){try{await fn();console.log('PASS',name)}catch(e){failed++;console.log('FAIL',name,e.message)}}
Date.now=realNow;
console.log(JSON.stringify({checks:checks.length,passed:checks.length-failed,failed}));if(failed)process.exitCode=1;
