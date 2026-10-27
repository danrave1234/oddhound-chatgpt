import {createHash} from 'node:crypto';import {runAuthorization,type RunAuthorization,type GuestAuthorization} from '@oddhound/contracts';

type VerifiedSite={id:string;origin:string;revision:number;environment:string;verified_at:unknown;verification_method:string|null};
type Credential={id:string;reference:string;revision:number};
export function canonicalGrantOrigin(raw:string){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.hostname.endsWith('.')||!u.hostname.includes('.')||/(^|\.)(localhost|local|internal|test|invalid|onion)$/.test(u.hostname)||u.hostname.startsWith('[')||/^\d+(\.\d+){3}$/.test(u.hostname))throw new Error('public_https_scope_required');return u.origin;}
export function authorizationHash(snapshot:unknown){const stable=(v:any):string=>Array.isArray(v)?`[${v.map(stable).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')}}`:JSON.stringify(v);return createHash('sha256').update(stable(snapshot)).digest('hex');}
export function compileRunAuthorization(input:{site:VerifiedSite;apis:VerifiedSite[];credentials:Credential[];authorization:RunAuthorization;writes:boolean;registration:boolean}){
  const {site,apis,credentials,writes,registration}=input,g=runAuthorization.parse(input.authorization);
  if(!site.verified_at||!site.verification_method)throw new Error('site_verification_required');
  if(!g.uiMethods.includes('GET'))throw new Error('ui_get_method_required');
  if(site.environment==='production'&&(g.mode!=='mapped'||(writes&&!g.productionWritesAcknowledged)))throw new Error('production_write_policy_required');
  if(g.mode==='isolated_staging'&&(site.environment!=='staging'||!writes))throw new Error('isolated_staging_grant_required');
  if(registration!==Boolean(g.registration)||registration&&!writes)throw new Error('registration_grant_mismatch');
  if(!writes&&(g.capabilities.create||g.capabilities.edit||g.capabilities.cancel))throw new Error('write_grant_required');
  if(!writes&&g.operations.some(o=>!['GET','HEAD'].includes(o.method)&&o.effect!=='authenticate'))throw new Error('write_grant_required');
  const selected=g.apiSites.map(a=>{const row=apis.find(p=>p.id===a.siteId);if(!row||!row.verified_at||!row.verification_method)throw new Error('api_verification_required');if(row.origin===site.origin)throw new Error('api_origin_must_be_separate');if(row.environment==='production'&&a.methods.some(m=>!['GET','HEAD'].includes(m))&&(g.mode!=='mapped'||writes&&!g.productionWritesAcknowledged))throw new Error('production_api_write_policy_required');return{siteId:row.id,origin:canonicalGrantOrigin(row.origin),revision:row.revision,methods:[...new Set(a.methods)]};});
  if(new Set(selected.map(a=>a.origin)).size!==selected.length)throw new Error('duplicate_api_origin');
  const bindings=g.actors.flatMap(actor=>actor.credentialReferences.map(reference=>{const row=credentials.find(c=>c.reference===reference);if(!row)throw new Error('credential_reference_not_found');if(!g.capabilities.authenticate||!actor.identityMarker)throw new Error('actor_identity_marker_required');return{actor:actor.id,reference,id:row.id,revision:row.revision};}));
  const resources=[...new Set(g.resourceOrigins.map(canonicalGrantOrigin))];if(resources.some(o=>o===site.origin||selected.some(a=>a.origin===o)))throw new Error('resource_scope_overlaps_active_origin');
  const operations=g.operations.map(({scope,...operation})=>{const origin=scope==='ui'?site.origin:selected.find(a=>a.siteId===scope)!.origin;const methods=scope==='ui'?g.uiMethods:selected.find(a=>a.siteId===scope)!.methods;if(!methods.includes(operation.method))throw new Error('operation_method_not_granted');if(operation.effect!=='authenticate'&&['GET','HEAD'].includes(operation.method))throw new Error('state_changing_operation_requires_write_method');if(operation.effect==='register'&&operation.body?.match!=='namespace_prefix')throw new Error('registration_body_binding_required');if(g.mode==='mapped'&&['create','edit','cancel'].includes(operation.effect)&&!operation.path.includes(':fixture')&&!operation.body)throw new Error('operation_fixture_binding_required');return{...operation,origin};});
  const guest:GuestAuthorization={version:1,mode:g.mode,actors:g.actors,capabilities:g.capabilities,namespace:g.data.namespace,fixtureIds:g.data.fixtureIds,maxAccounts:g.registration?.maxAccounts??0,uiMethods:g.uiMethods,operations};
  const snapshot={version:1,siteId:site.id,origin:site.origin,revision:site.revision,environment:site.environment,writes,registration,grant:g,apiOrigins:selected,credentialBindings:bindings,resourceOrigins:resources,deniedPaths:g.deniedPaths,guest};
  return{snapshot,hash:authorizationHash(snapshot)};
}
export function assertAuthorizationCurrent(snapshot:ReturnType<typeof compileRunAuthorization>['snapshot'],hash:string,sites:VerifiedSite[],credentials:Credential[]){
  if(authorizationHash(snapshot)!==hash)throw new Error('authorization_snapshot_changed');
  for(const expected of [{siteId:snapshot.siteId,origin:snapshot.origin,revision:snapshot.revision},...snapshot.apiOrigins]){const row=sites.find(s=>s.id===expected.siteId);if(!row||!row.verified_at||!row.verification_method||row.origin!==expected.origin||row.revision!==expected.revision)throw new Error('active_origin_grant_changed');}
  for(const expected of snapshot.credentialBindings){const row=credentials.find(c=>c.id===expected.id);if(!row||row.reference!==expected.reference||row.revision!==expected.revision)throw new Error('credential_grant_changed');}
}
