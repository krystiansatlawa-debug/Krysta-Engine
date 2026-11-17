import assert from "node:assert/strict";
import {test} from "node:test";
import {runBoundedGameUpdateScan} from "./game-update-scan.js";

test("checks multiple game versions concurrently without exceeding three provider requests",async()=>{
 const started:number[]=[];
 let active=0,maximum=0;
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 const task=runBoundedGameUpdateScan(
  Array.from({length:10},(_,index)=>index),
  async game=>{started.push(game);active++;maximum=Math.max(maximum,active);await gate;active--;},
  async()=>true,
 );
 // Every worker starts one request before waiting for the next game.
 await new Promise<void>(resolve=>setImmediate(resolve));
 assert.deepEqual(started,[0,1,2]);
 assert.equal(maximum,3);
 release();
 assert.equal(await task,true);
 assert.equal(started.length,10);
 assert.equal(new Set(started).size,10);
 assert.equal(maximum,3);
});

test("pauses pending checks when a game starts, without losing completed work",async()=>{
 let permitted=0;
 const processed:number[]=[];
 const completed=await runBoundedGameUpdateScan(
  [1,2,3,4,5,6],
  async id=>{processed.push(id);},
  async()=>permitted++<2,
 );
 assert.equal(completed,false);
 assert.equal(processed.length,2);
 assert.deepEqual([...processed].sort(),[1,2]);
});

test("empty library does not attempt provider requests",async()=>{
 let called=false;
 const result=await runBoundedGameUpdateScan([],async()=>{called=true;},async()=>{called=true;});
 assert.equal(called,false);
 assert.equal(result,true);
});
