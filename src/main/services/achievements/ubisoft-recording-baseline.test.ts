import {test} from "node:test";
import assert from "node:assert/strict";
import {advanceUbisoftRecordingBaseline as advance} from "./ubisoft-recording-baseline.js";
const locked={id:"A",title:"First",unlocked:false},unlocked={...locked,unlocked:true};
test("first Ubisoft snapshot is silent; subsequent unlock is detected once",()=>{
 const initial=advance(null,"account:game",[locked],1000);
 assert.deepEqual(initial.newTitles,[]);
 const fresh=advance(initial.baseline,"account:game",[unlocked],11000);
 assert.deepEqual(fresh.newTitles,["First"]);
 const repeated=advance(fresh.baseline,"account:game",[unlocked],21000);
 assert.deepEqual(repeated.newTitles,[]);
 const transient=advance(repeated.baseline,"account:game",[locked],31000);
 assert.deepEqual(advance(transient.baseline,"account:game",[unlocked],41000).newTitles,[]);
});
test("new account, game, or long interruption does not produce a clip",()=>{
 const baseline=advance(null,"account:game",[locked],1000).baseline;
 assert.deepEqual(advance(baseline,"other:game",[unlocked],11000).newTitles,[]);
 assert.deepEqual(advance(baseline,"account:other",[unlocked],11000).newTitles,[]);
 assert.deepEqual(advance(baseline,"account:game",[unlocked],61000).newTitles,[]);
 assert.deepEqual(advance(null,"account:game",[unlocked],11000).newTitles,[]);
});
