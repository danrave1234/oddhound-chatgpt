import type {IncomingMessage,ServerResponse} from 'node:http';import type {Pool} from 'pg';import {randomBytes} from 'node:crypto';
export async function policyCanary(req:IncomingMessage,res:ServerResponse,url:URL,pool:Pool,origin:string){
  if(process.env.FIXTURE_LAB_CANARY!=='1'||!url.pathname.startsWith('/_lab/'))return false;
  const ui='https://fixture-lab:3002',api='https://fixture-corrected-lab:3002';
  if(req.method==='GET'&&url.pathname==='/_lab/controls'){
    const nonce=url.searchParams.get('nonce')??'',namespace=url.searchParams.get('namespace')??'';
    if(!/^[a-f0-9-]{36}$/.test(nonce)||!/^lab_[a-f0-9]{10}$/.test(namespace)){res.writeHead(400);res.end();return true;}
    const form=(name:string,action:string,kind:string,field:string,value:string)=>`<form method="post" action="${action}"><input type="hidden" name="nonce" value="${nonce}_${kind}"><input type="hidden" name="${field}" value="${value}"><button>${name}</button></form>`;
    const scriptNonce=randomBytes(16).toString('base64');res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','content-security-policy':`default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src ${api}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`});
    res.end(`<!doctype html><html><head><title>Owned permission canary</title></head><body><h1>Owned permission canary</h1>
${form('Allowed create','/_lab/create','create','label',namespace+'_control')}
${form('Foreign namespace','/_lab/create','foreign','label','customer_record')}
${form('Unmapped operation','/_lab/unmapped','unmapped','label',namespace+'_control')}
${form('Owned cancel','/_lab/records/owned-1/cancel','cancel','label',namespace+'_control')}
${form('Foreign cancel','/_lab/records/foreign-1/cancel','foreign-cancel','label',namespace+'_control')}
${form('First registration','/_lab/register','register-one','username',namespace+'_first')}
${form('Second registration','/_lab/register','register-two','username',namespace+'_second')}
<button id="api-good">Allowed API create</button><button id="api-foreign">Foreign API namespace</button><button id="api-delete">Unapproved API method</button><p id="result"></p>
<script nonce="${scriptNonce}">for(const [id,kind,label,method] of [['api-good','api-good',${JSON.stringify(namespace+'_api')},'POST'],['api-foreign','api-foreign','customer_record','POST'],['api-delete','api-delete',${JSON.stringify(namespace+'_api')},'DELETE']])document.getElementById(id).onclick=async()=>{try{const r=await fetch(${JSON.stringify(api+'/_lab/create?nonce='+nonce+'_')}+kind,{method,headers:{'content-type':'application/json'},body:JSON.stringify({nonce:${JSON.stringify(nonce+'_')}+kind,label})});document.getElementById('result').textContent='API result '+r.status;}catch{document.getElementById('result').textContent='API request refused';}};</script></body></html>`);return true;
  }
  if(req.method==='OPTIONS'){
    const nonce=url.searchParams.get('nonce')??'';if(req.headers.origin!==ui||!/[a-f0-9-]{36}_[a-z-]+/.test(nonce)){res.writeHead(403);res.end();return true;}
    await pool.query('INSERT INTO fixture_policy_requests(nonce,origin,path,method) VALUES($1,$2,$3,$4)',[nonce+'_preflight',origin,url.pathname,'OPTIONS']);
    res.writeHead(204,{'access-control-allow-origin':ui,'access-control-allow-methods':'POST, DELETE','access-control-allow-headers':'content-type','access-control-max-age':'0'});res.end();return true;
  }
  if(['POST','DELETE'].includes(req.method??'')){
    if(req.headers.origin!==ui){res.writeHead(403);res.end();return true;}
    const chunks:Buffer[]=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>8192){res.writeHead(413);res.end();return true;}chunks.push(chunk);}
    const raw=Buffer.concat(chunks).toString('utf8');const nonce=req.headers['content-type']?.startsWith('application/json')?JSON.parse(raw).nonce:new URLSearchParams(raw).get('nonce')??'';
    if(!/^[a-f0-9-]{36}_[a-z-]+$/.test(nonce)){res.writeHead(400);res.end();return true;}
    await pool.query('INSERT INTO fixture_policy_requests(nonce,origin,path,method) VALUES($1,$2,$3,$4)',[nonce,origin,url.pathname,req.method]);
    res.writeHead(201,{'content-type':'text/html','access-control-allow-origin':ui,'cache-control':'no-store'});res.end('<!doctype html><html><head><title>Canary received</title></head><body>Canary request reached the owned fixture.</body></html>');return true;
  }
  res.writeHead(404);res.end();return true;
}
