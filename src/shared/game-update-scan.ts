/** Use only a few parallel provider requests. A stalled network feed must not
 * block checks of all other installed games, and new checks stop when gaming
 * begins. Already running checks are allowed to settle naturally.
 */
export async function runBoundedGameUpdateScan<T>(
  targets: readonly T[],
  processItem: (target:T)=>Promise<void>,
  mayContinue: ()=>Promise<boolean>,
  concurrency=3
):Promise<boolean>{
  const lanes=Math.min(targets.length,Math.max(1,Math.min(4,Math.floor(concurrency)||1)));
  let cursor=0;
  let interrupted=false;
  await Promise.all(Array.from({length:lanes},async()=>{
    while(!interrupted){
      if(!(await mayContinue())){interrupted=true;return;}
      const index=cursor++;
      if(index>=targets.length)return;
      await processItem(targets[index]);
    }
  }));
  return !interrupted;
}
