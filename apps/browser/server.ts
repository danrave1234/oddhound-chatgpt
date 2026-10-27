import {createServer} from 'node:http';import {randomUUID,timingSafeEqual} from 'node:crypto';import {mkdir,readFile,writeFile,rename,chmod} from 'node:fs/promises';import {networkInterfaces} from 'node:os';import {isIP} from 'node:net';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';
import {chromium,type BrowserServer,type Browser} from 'playwright';import {z} from 'zod';
import {BrowserTools} from './tools';import {freezeScope} from './policy';import {installFirewall,quotaExhausted} from './firewall';
import {sandboxVerdict} from './sandbox';
const exec=promisify(execFile),base='/run/oddhound';
if(process.getuid?.()!==0)throw new Error('trusted_supervisor_requires_root');
if(['META_API_KEY','DATABASE_URL','FLY_API_TOKEN','GITHUB_CLIENT_SECRET','BETTER_AUTH_SECRET','ODDHOUND_VAULT_KEY'].some(k=>process.env[k]))throw new Error('platform_credentials_refused_in_browser');
const lab=process.env.ODDHOUND_BROWSER_PROFILE==='owned-lab-v1';if(lab&&process.env.FLY_APP_NAME)throw new Error('lab_profile_refused_on_fly');
const profile=lab?'owned-lab-v1':'gateway-sandbox-v1',runId=z.uuid().parse(process.env.ODDHOUND_RUN_ID),path=z.string().regex(/^[a-f0-9]{64}$/).parse(process.env.ODDHOUND_RUN_PATH);
const scope=freezeScope(JSON.parse(process.env.ODDHOUND_SCOPE??'{}'),lab),deadline=Date.parse(scope.expiresAt);
const privateIP=process.env.ODDHOUND_CONTROL_ADDRESS??Object.values(networkInterfaces()).flat().find(a=>a?.family==='IPv6'&&a.address.startsWith('fdaa:'))?.address;
if(!privateIP||!isIP(privateIP)||(!lab&&!privateIP.startsWith('fdaa:')))throw new Error('private_control_address_required');
const sources=(process.env.ODDHOUND_TRUSTED_WEB_IPS??'').split(',').filter(Boolean);if(!sources.length||sources.some(s=>!isIP(s)||(!lab&&!s.startsWith('fdaa:'))))throw new Error('trusted_control_sources_required');
const labDestinations=lab?(process.env.ODDHOUND_LAB_DESTINATIONS??'').split(',').filter(Boolean):[];
await mkdir(base,{recursive:true,mode:0o750});await mkdir('/tmp/gateway',{recursive:true,mode:0o700});await exec('chown',['1102:1102','/tmp/gateway']);
await mkdir('/tmp/browser',{recursive:true,mode:0o700});await exec('chown',['1101:1101','/tmp/browser']);await exec('chown',['root:1102',base]);
await writeFile(base+'/scope.json',JSON.stringify(scope),{mode:0o640});await writeFile(base+'/profile',profile,{mode:0o644});await writeFile(base+'/deadline',String(deadline/1000),{mode:0o644});
await exec('chown',['root:1102',base+'/scope.json']);
const certDir='/tmp/gateway/certs';await mkdir(certDir,{mode:0o700});await exec('chown',['1102:1102',certDir]);
const smokeArgs=['--listen-ip=127.0.0.1','--listen-port=4750','--timeout=5s','--dns-timeout=3s','--max-concurrent-connect-tunnels=6'];
if(lab)smokeArgs.push('--resolver-address=172.30.73.53:53');
for(const a of labDestinations)smokeArgs.push(`--allow-address=${a}`);
const smoke=spawn('setpriv',['--reuid=1103','--regid=1103','--init-groups','--bounding-set=-all','env','-i','PATH=/usr/local/bin:/usr/bin:/bin','/opt/oddhound/smokescreen',...smokeArgs],{stdio:['ignore','ignore','ignore']});
const gateway=spawn('setpriv',['--reuid=1102','--regid=1102','--init-groups','--bounding-set=-all','env','-i','HOME=/tmp/gateway','PATH=/opt/mitmproxy/bin:/usr/local/bin:/usr/bin:/bin','/opt/mitmproxy/bin/mitmdump','--quiet','--listen-host','127.0.0.1','--listen-port','8080','--mode','upstream:http://127.0.0.1:4750','--set',`confdir=${certDir}`,'--set','ssl_insecure=false','--set','upstream_cert=false','--set','body_size_limit=8m','--set','connection_strategy=lazy',...(lab?['--set','ssl_verify_upstream_trusted_ca=/opt/lab-certs/cert.pem']:[]),'-s','/opt/oddhound/gateway.py'],{stdio:['ignore','ignore','inherit']});
for(let i=0;i<60;i++){try{await readFile(certDir+'/mitmproxy-ca-cert.pem');await readFile('/tmp/gateway/state.json');break;}catch{if(i===59)throw new Error('gateway_startup_failed');await new Promise(r=>setTimeout(r,100));}}
await mkdir('/tmp/browser/.pki/nssdb',{recursive:true,mode:0o700});await exec('chown',['-R','1101:1101','/tmp/browser/.pki']);
await exec('setpriv',['--reuid=1101','--regid=1101','--init-groups','certutil','-N','-d','sql:/tmp/browser/.pki/nssdb','--empty-password']);
await chmod(certDir,0o755);await chmod('/tmp/gateway',0o711);await chmod(certDir+'/mitmproxy-ca-cert.pem',0o644);
await exec('setpriv',['--reuid=1101','--regid=1101','--init-groups','certutil','-A','-d','sql:/tmp/browser/.pki/nssdb','-n','Oddhound per-run gateway','-t','C,,','-i',certDir+'/mitmproxy-ca-cert.pem']);
await installFirewall(privateIP,sources,labDestinations,lab?'172.30.73.53':undefined);
let stopped=false,browserServer:BrowserServer|undefined,browser:Browser|undefined,tools:BrowserTools|undefined,busy=false;
async function stop(){if(stopped)return;stopped=true;await writeFile(base+'/stopped','1',{mode:0o644});const killer=setTimeout(()=>{const pid=browserServer?.process().pid;if(pid)try{process.kill(-pid,'SIGKILL');}catch{try{process.kill(pid,'SIGKILL');}catch{}}gateway.kill('SIGKILL');smoke.kill('SIGKILL');},4000);try{await tools?.close();await browser?.close().catch(()=>{});await browserServer?.close().catch(()=>{});}finally{clearTimeout(killer);gateway.kill('SIGTERM');smoke.kill('SIGTERM');}}
async function health(){if(stopped||Date.now()>=deadline)throw new Error('run_expired');if(gateway.exitCode!==null||smoke.exitCode!==null)throw new Error('policy_process_failed');const stats=JSON.parse(await readFile('/tmp/gateway/state.json','utf8'));if(stats.fenced||await quotaExhausted())throw new Error('network_budget_exhausted');}
const permitNavigation=async(url:string)=>{const value={url,id:randomUUID(),expires:Math.min(deadline/1000,Date.now()/1000+10)};await writeFile(base+'/navigation.tmp',JSON.stringify(value),{mode:0o644});await rename(base+'/navigation.tmp',base+'/navigation.json');};
try{browserServer=await chromium.launchServer({host:privateIP,port:3005,wsPath:path,executablePath:'/opt/oddhound/chromium-launcher.sh',chromiumSandbox:true,headless:true,args:['--proxy-server=http://127.0.0.1:8080','--proxy-bypass-list=<-loopback>','--disable-quic','--disable-features=WebRtcHideLocalIpsWithMdns'],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp/browser'}});
  browser=await chromium.connect(browserServer.wsEndpoint());
}catch(error){await writeFile('/tmp/startup-error.txt',String((error as Error).message).replaceAll(path,'[CONTROL CAPABILITY]').slice(0,16000),{mode:0o600});await stop();throw new Error('sandboxed_chromium_launch_failed');}
const probe=await browser.newContext();const sandboxPage=await probe.newPage();await sandboxPage.goto('chrome://sandbox');let sandboxText='';for(let i=0;i<30;i++){sandboxText=await sandboxPage.locator('body').innerText();if(/Seccomp-BPF sandbox/i.test(sandboxText))break;await new Promise(r=>setTimeout(r,100));}await probe.close();
const pid=browserServer.process().pid!,proc=await readFile(`/proc/${pid}/status`,'utf8'),uid=Number(/^Uid:\s+(\d+)/m.exec(proc)?.[1]);
const sandbox=sandboxVerdict(uid,browser.version(),sandboxText);
await writeFile('/tmp/sandbox-verdict.json',JSON.stringify(sandbox,null,2),{mode:0o600});
if(!sandbox.enabled){await stop();throw new Error('chromium_sandbox_verdict_failed');}
tools=new BrowserTools(browser,scope,permitNavigation,health);
const server=createServer((req,res)=>{void(async()=>{
  const remote=req.socket.remoteAddress?.replace(/^::ffff:/,'');if(!remote||!sources.includes(remote)){res.writeHead(403);res.end();return;}
  const [empty,capability,method,...rest]=(req.url??'').split('/');if(empty||rest.length||!capability||capability.length!==path.length||!timingSafeEqual(Buffer.from(capability),Buffer.from(path))){res.writeHead(404);res.end();return;}
  if(req.method!=='POST'){res.writeHead(405);res.end();return;}
  const chunks:Buffer[]=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}const data=bytes?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};
  if(method==='stop'){await stop();res.writeHead(200,{'content-type':'application/json'});res.end('{"closed":true}');clearInterval(timer);server.close();process.exitCode=0;return;}
  await health();if(busy)throw new Error('browser_busy');busy=true;
  try{let result:unknown;if(method==='ready')result={runId,policy:profile,sandbox,releaseEligible:!lab};else if(method==='initialize')result=await tools!.initialize(z.array(z.object({reference:z.string(),value:z.string(),actor:z.enum(['primary','secondary']).optional()})).parse(data.credentials));else if(method==='observe')result=await tools!.observe();else if(method==='inspect_record')result=await tools!.inspectRecord(data);else if(method==='action')result=await tools!.execute(data.action,data.key);else{res.writeHead(404);res.end();return;}const body=JSON.stringify(result);if(Buffer.byteLength(body)>2*1024*1024)throw new Error('control_response_limit');res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(body);}finally{busy=false;}
})().catch(error=>{if(!res.headersSent)res.writeHead(409,{'content-type':'application/json'});res.end(JSON.stringify({error:/^[a-z0-9_]+$/.test(error.message)?error.message:'browser_action_failed'}));});});
server.headersTimeout=10000;server.requestTimeout=20000;server.listen(3001,privateIP,()=>console.log(JSON.stringify({event:'browser.ready',runId,profile,sandbox:{enabled:sandbox.enabled,uid:sandbox.uid,chromiumVersion:sandbox.chromiumVersion}})));
const timer=setInterval(()=>void health().catch(()=>void stop().finally(()=>{clearInterval(timer);server.close();process.exitCode=1;})),500);for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{clearInterval(timer);void stop().finally(()=>server.close());});
