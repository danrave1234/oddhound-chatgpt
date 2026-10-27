import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Queue,Worker,createPostgresBackend,DelayedError} from '../../apps/worker/queue';
test('PostgreSQL-backed BullMQ delivers a durable job and deduplicates outbox redelivery',{timeout:20000},async()=>{
  const connection=process.env.DATABASE_URL;if(!connection||!new URL(connection).pathname.endsWith('_test'))throw new Error('Dedicated _test database required');
  const name=`integration-${randomUUID()}`,id=randomUUID(),queue=new Queue(name,{connection},createPostgresBackend);let calls=0;
  const worker=new Worker(name,async job=>{calls++;assert.equal(job.data.scope,'synthetic');return{recorded:true};},{connection,concurrency:1},createPostgresBackend);
  try{await worker.waitUntilReady();const first=await queue.add('test',{scope:'synthetic'},{jobId:id});const second=await queue.add('test',{scope:'synthetic'},{jobId:id});assert.equal(first.id,second.id);
    for(let i=0;i<100;i++){if(await first.getState()==='completed')break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await first.getState(),'completed');assert.equal(calls,1);const saved=await queue.getJob(id);assert.deepEqual(saved?.returnvalue,{recorded:true});
  }finally{await worker.close();await queue.obliterate({force:true});await queue.close();}
});

test('PostgreSQL-backed BullMQ defers the same locked job without consuming its one execution attempt',{timeout:20000},async()=>{
  const connection=process.env.DATABASE_URL;if(!connection||!new URL(connection).pathname.endsWith('_test'))throw new Error('Dedicated _test database required');
  const name=`deferred-${randomUUID()}`,queue=new Queue(name,{connection},createPostgresBackend);let visits=0,writes=0;
  const worker=new Worker(name,async(job,token)=>{visits++;if(visits===1){assert(token);await job.moveToDelayed(Date.now()+250,token);throw new DelayedError();}writes++;return{executed:true};},{connection,concurrency:1},createPostgresBackend);
  try{
    await worker.waitUntilReady();const job=await queue.add('wait-for-slot',{synthetic:true},{jobId:randomUUID(),attempts:1});
    for(let i=0;i<100;i++){if(await job.getState()==='completed')break;await new Promise(r=>setTimeout(r,50));}
    const saved=await queue.getJob(job.id!);assert.equal(await saved?.getState(),'completed');assert.equal(visits,2);assert.equal(writes,1);assert.equal(saved?.attemptsMade,1);assert.deepEqual(saved?.returnvalue,{executed:true});
  }finally{await worker.close();await queue.obliterate({force:true});await queue.close();}
});
