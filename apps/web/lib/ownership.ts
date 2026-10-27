import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { parse } from 'parse5';

export function canonicalOrigin(input:string){const url=new URL(input);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.hostname.endsWith('.'))throw new Error('enter_public_https_origin');return url.origin;}
export function publicIP(value:string){try{const ip=ipaddr.process(value);if(ip.range()!=='unicast')return false;const blocks=ip.kind()==='ipv4'?['192.0.0.0/24','192.0.2.0/24','198.51.100.0/24','203.0.113.0/24']:['2001::/23','2002::/16','3fff::/20','5f00::/16'];return!blocks.some(block=>ip.match(ipaddr.parseCIDR(block)));}catch{return false;}}
function equal(a:string,b:string){return Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export async function checkOwnership(origin:string,token:string,method:'dns'|'file'|'meta'){
  canonicalOrigin(origin);const host=new URL(origin).hostname.replace(/^\[|\]$/g,'');
  if(/(^|\.)(localhost|local|internal|test|invalid|onion)$/i.test(host))throw new Error('private_or_reserved_target');
  const resolver=new Resolver({timeout:2000,tries:1});
  const query=async(type:'resolve4'|'resolve6')=>{try{return await resolver[type](host);}catch(e){if(['ENODATA','ENOTFOUND'].includes((e as NodeJS.ErrnoException).code??''))return[];throw e;}};
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([(async()=>{
    const addresses=isIP(host)?[host]:(await Promise.all([query('resolve4'),query('resolve6')])).flat();
    if(!addresses.length||addresses.length>32||addresses.some(a=>!publicIP(a)))throw new Error('private_or_invalid_dns_target');
    if(method==='dns'){const records=await resolver.resolveTxt(host);if(records.length>64||records.some(r=>r.join('').length>4096))throw new Error('dns_proof_too_large');if(!records.some(r=>equal(r.join(''),`oddhound-verify=${token}`)))throw new Error('verification_token_not_found');return{address:addresses[0],method};}
    const response=await new Promise<{status:number;type:string;text:string}>((resolve,reject)=>{
      const address=addresses[0];const request=https.request(new URL(method==='file'?'/.well-known/oddhound-verify.txt':'/',origin),{method:'GET',agent:false,servername:host,rejectUnauthorized:true,maxHeaderSize:16384,
        lookup:((_hostname:unknown,options:{all?:boolean},callback:Function)=>callback(null,options.all?[{address,family:isIP(address)}]:address,isIP(address))) as never,
        headers:{accept:method==='file'?'text/plain':'text/html','accept-encoding':'identity','cache-control':'no-cache','user-agent':'Oddhound/1.0 (+https://oddhound.online/bot)'}},res=>{
          if(ipaddr.process(res.socket.remoteAddress??'').toString()!==ipaddr.process(address).toString()){res.destroy();return reject(new Error('dial_pin_mismatch'));}
          if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();return reject(new Error('unsupported_proof_encoding'));}
          let length=0;const chunks:Buffer[]=[];res.on('data',chunk=>{length+=chunk.length;if(length>256*1024){res.destroy();reject(new Error('proof_too_large'));}else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode??0,type:String(res.headers['content-type']??'').split(';')[0],text:Buffer.concat(chunks).toString('utf8')}));
        });const deadline=setTimeout(()=>request.destroy(new Error('verification_timeout')),6000);request.on('close',()=>clearTimeout(deadline));request.on('error',reject);request.end();
    });
    if(response.status!==200)throw new Error('proof_must_return_200_without_redirect');
    let found=false;if(method==='file'){if(response.type!=='text/plain')throw new Error('proof_requires_plain_text');found=equal(response.text.trim(),token);}else{if(response.type!=='text/html')throw new Error('proof_requires_html');const doc=parse(response.text);const html=doc.childNodes.find(n=>'tagName'in n&&n.tagName==='html');const head=html&&'childNodes'in html?html.childNodes.find(n=>'tagName'in n&&n.tagName==='head'):undefined;found=Boolean(head&&'childNodes'in head&&head.childNodes.some(n=>'tagName'in n&&n.tagName==='meta'&&'attrs'in n&&n.attrs.some(a=>a.name==='name'&&a.value==='oddhound-verification')&&n.attrs.some(a=>a.name==='content'&&equal(a.value,token))));}
    if(!found)throw new Error('verification_token_not_found');return{address:addresses[0],method};
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{resolver.cancel();reject(new Error('verification_timeout'));},10000);})]);}finally{clearTimeout(timer);}
}
