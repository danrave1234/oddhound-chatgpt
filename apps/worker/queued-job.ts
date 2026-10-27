import {DelayedError} from './queue';
import {RunDeferredError} from './claim';

export async function runQueuedJob(job:{data:{runId:string};moveToDelayed:(timestamp:number,token?:string)=>Promise<void>},token:string|undefined,execute:(id:string)=>Promise<void>){
  try{return await execute(job.data.runId);}
  catch(error){if(error instanceof RunDeferredError){await job.moveToDelayed(Date.now()+1500,token);throw new DelayedError();}throw error;}
}
