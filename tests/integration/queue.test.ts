import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Queue,Worker,createPostgresBackend} from '../../apps/worker/queue';
test('PostgreSQL-backed BullMQ delivers a durable job and deduplicates outbox redelivery',{timeout:20000},async()=>{
  const connection=process.env.DATABASE_URL;if(!connection||!new URL(connection).pathname.endsWith('_test'))throw new Error('Dedicated _test database required');
  const name=`integration-${randomUUID()}`,id=randomUUID(),queue=new Queue(name,{connection},createPostgresBackend);let calls=0;
  const worker=new Worker(name,async job=>{calls++;assert.equal(job.data.scope,'synthetic');return{recorded:true};},{connection,concurrency:1},createPostgresBackend);
  try{await worker.waitUntilReady();const first=await queue.add('test',{scope:'synthetic'},{jobId:id});const second=await queue.add('test',{scope:'synthetic'},{jobId:id});assert.equal(first.id,second.id);
    for(let i=0;i<100;i++){if(await first.getState()==='completed')break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await first.getState(),'completed');assert.equal(calls,1);const saved=await queue.getJob(id);assert.deepEqual(saved?.returnvalue,{recorded:true});
  }finally{await worker.close();await queue.obliterate({force:true});await queue.close();}
});
