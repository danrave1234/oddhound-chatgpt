export function sandboxVerdict(uid:number,chromiumVersion:string,details:string){
  const namespace=/(?:Namespace sandbox\s+Yes|Layer 1 Sandbox\s+Namespace)\b/i.test(details);
  const enabled=uid===1101&&namespace&&/PID namespaces\s+Yes/i.test(details)&&/Network namespaces\s+Yes/i.test(details)&&/Seccomp-BPF sandbox\s+Yes/i.test(details);
  return{enabled,uid,chromiumVersion,details:details.slice(0,3000)};
}
