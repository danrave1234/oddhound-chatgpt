import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile,writeFile} from 'node:fs/promises';import {isIP} from 'node:net';
const exec=promisify(execFile);
const v4=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.88.99.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4'];
const v6=['::/128','::1/128','::ffff:0:0/96','64:ff9b:1::/48','100::/64','2001::/23','2001:db8::/32','2002::/16','3fff::/20','fc00::/7','fe80::/10','ff00::/8'];
export function flyNeighborTransport(routes:unknown){
  if(!Array.isArray(routes)||routes.length!==1||routes[0]?.dst!=='default'||routes[0]?.gateway!=='fe80::1'||routes[0]?.dev!=='eth0')throw new Error('unsupported_fly_ipv6_gateway');
  return{
    input:'iifname "eth0" ip6 saddr fe80::1 ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } accept',
    output:'oifname "eth0" ip6 daddr { fe80::1, ff02::1:ff00:1 } ip6 hoplimit 255 icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert } accept',
  };
}
export async function installFirewall(control:string,sources:string[],labDestinations:string[]=[],labDns?:string){
  if(!isIP(control)||!sources.length||sources.some(s=>!isIP(s)))throw new Error('invalid_control_sources');
  // Kernel neighbor discovery is required for the private Fly controller route.
  // UID-specific browser/proxy drops still run before the output exception.
  const neighbor=control.startsWith('fdaa:')?flyNeighborTransport(JSON.parse((await exec('ip',['-j','-6','route','show','default'])).stdout)):null;
  const resolvers=labDns?[labDns]:(await readFile('/etc/resolv.conf','utf8')).split('\n').map(l=>/^nameserver\s+(\S+)/.exec(l)?.[1]).filter((s):s is string=>Boolean(s&&isIP(s)));if(resolvers.some(ip=>!isIP(ip)))throw new Error('invalid_dns_exception');
  const rule=(ip:string,port:number,uid?:number,protocol='tcp')=>`${uid===undefined?'':`meta skuid ${uid} `}${isIP(ip)===4?'ip':'ip6'} daddr ${ip} ${protocol} dport ${port} accept`;
  const input=sources.concat(control).map(ip=>`${isIP(ip)===4?'ip':'ip6'} saddr ${ip} tcp dport { 3001, 3005 } accept`).join('\n');
  const lab=labDestinations.map(a=>{const [host,port]=a.split(':');if(isIP(host)!==4||!/^\d{1,5}$/.test(port))throw new Error('invalid_lab_destination');return `meta skuid 1103 ip daddr ${host} tcp dport ${Number(port)} ct mark set 0x4f`;}).join('\n');
  const config=`table inet oddhound {
    quota received { over 52428800 bytes; }
    quota sent { over 52428800 bytes; }
    counter receive_blocked { }
    counter send_blocked { }
    chain input { type filter hook input priority 0; policy drop;
      ct mark 0x4f quota name received counter name receive_blocked drop
      ct state established,related accept
      iif lo accept
      ${neighbor?.input??''}
      ${input}
    }
    chain output { type filter hook output priority 0; policy drop;
      ct direction reply ct state established,related accept
      meta skuid 1101 ip daddr 127.0.0.1 tcp dport 8080 accept
      meta skuid 1101 drop
      meta skuid 1102 ip daddr 127.0.0.1 tcp dport 4750 accept
      meta skuid 1102 drop
      ${resolvers.map(ip=>rule(ip,53,1103,'udp')+'\n'+rule(ip,53,1103,'tcp')).join('\n')}
      ${lab}
      meta skuid 1103 ct mark != 0x4f ip daddr { ${v4.join(', ')} } drop
      meta skuid 1103 ct mark != 0x4f ip6 daddr { ${v6.join(', ')} } drop
      meta skuid 1103 ip6 daddr != 2000::/3 drop
      meta skuid 1103 meta l4proto tcp ct mark set 0x4f
      ct mark 0x4f quota name sent counter name send_blocked drop
      meta skuid 1103 meta l4proto tcp accept
      meta skuid 1103 drop
      ${neighbor?.output??''}
      ct state established,related accept
      ${rule(control,3005,0)}
      meta skuid 0 ip daddr 127.0.0.1 tcp dport { 8080, 4750 } accept
    }
  }`;
  await writeFile('/run/oddhound/firewall.nft',config,{mode:0o600});await exec('nft',['-f','/run/oddhound/firewall.nft']);
}
export async function quotaExhausted(){const {stdout}=await exec('nft',['-j','list','table','inet','oddhound']);const data=JSON.parse(stdout);return data.nftables.some((row:any)=>row.counter&&['receive_blocked','send_blocked'].includes(row.counter.name)&&row.counter.packets>0);}
