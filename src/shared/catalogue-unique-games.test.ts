import assert from "node:assert/strict";
import { test } from "node:test";
import { uniqueCatalogueGames } from "./catalogue-unique-games.js";
test("deduplicates game identities without merging shops",()=>{
 const a={shop:"steam",objectId:"42",title:"A"};
 const b={shop:"epic",objectId:"42",title:"B"};
 assert.deepEqual(uniqueCatalogueGames([a,{...a,title:"duplicate"},b]),[a,b]);
});
test("preserves order and caps results",()=>{
 const a={shop:"steam",objectId:"1"}; const b={shop:"steam",objectId:"2"};
 assert.deepEqual(uniqueCatalogueGames([a,a,b],1),[a]);
 assert.deepEqual(uniqueCatalogueGames([a,b],0),[]);
});
