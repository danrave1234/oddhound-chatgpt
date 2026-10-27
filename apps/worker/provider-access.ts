import {mkdir,writeFile} from 'node:fs/promises';
const key=process.env.META_API_KEY;if(!key)throw new Error('meta_not_configured');
const endpoint='https://api.meta.ai/v1/models',startedAt=new Date().toISOString();
let evidence:Record<string,unknown>={startedAt,endpoint,inference:false};
try{const response=await fetch(endpoint,{headers:{authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(15000)});evidence.httpStatus=response.status;
  if(response.ok){const text=await response.text();if(text.length>1024*1024)throw new Error('provider_response_limit');const body=JSON.parse(text);evidence.modelIds=(Array.isArray(body.data)?body.data:[]).map((m:{id?:unknown})=>m.id).filter((id:unknown)=>typeof id==='string'&&/^[a-zA-Z0-9_.:/-]{1,160}$/.test(id as string));evidence.authenticated=true;}
  else{evidence.authenticated=false;evidence.reason=response.status===401||response.status===403?'credentials_refused':response.status===429?'rate_limited':'provider_http_error';}
}catch(error){evidence.reason=/^[a-z0-9_]+$/.test((error as Error).message)?(error as Error).message:'network_or_tls_failure';evidence.authenticated=false;}
evidence.finishedAt=new Date().toISOString();await mkdir('docs/evidence',{recursive:true});await writeFile('docs/evidence/meta-access.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
