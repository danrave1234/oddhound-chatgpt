import {z} from 'zod';

export const httpMethod=z.enum(['GET','HEAD','POST','PUT','PATCH','DELETE']);
export const actorId=z.enum(['primary','secondary']);
export const credentialReference=z.string().regex(/^[a-z0-9_.-]{1,80}$/);
const path=z.string().min(1).max(300).refine(p=>p.startsWith('/')&&!p.includes('?')&&!p.includes('#')&&!p.includes('\\')&&!p.includes('%')&&!p.includes('//')&&!p.split('/').some(s=>s==='.'||s==='..'),'Use a literal absolute path without encoded or relative segments');
export const effect=z.enum(['authenticate','register','create','edit','cancel']);
const operationShape={scope:z.union([z.literal('ui'),z.string().uuid()]),method:httpMethod,path:path.refine(p=>p.split('/').every(s=>!s.includes(':')||s===':fixture'),'Only :fixture is a supported path slot'),effect,
  body:z.object({encoding:z.enum(['form','json']),field:z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/),match:z.enum(['namespace_prefix','fixture_id'])}).optional()};
export const operationInput=z.object(operationShape).strict();
export const runAuthorization=z.object({
  version:z.literal(1),mode:z.enum(['isolated_staging','mapped']),
  actors:z.array(z.object({id:actorId,label:z.string().trim().min(1).max(80),credentialReferences:z.array(credentialReference).max(12),identityMarker:z.string().trim().min(1).max(120).optional()}).strict()).min(1).max(2),
  capabilities:z.object({authenticate:z.boolean(),create:z.boolean(),edit:z.boolean(),cancel:z.boolean(),boundary:z.boolean(),repeat:z.boolean(),unusualOrder:z.boolean()}).strict(),
  registration:z.object({prefix:z.string().regex(/^[a-z0-9_-]{3,24}$/),domain:z.string().regex(/^[a-z0-9.-]{3,120}$/).optional(),maxAccounts:z.number().int().min(1).max(3)}).strict().optional(),
  data:z.object({namespace:z.string().trim().min(3).max(80),fixtureIds:z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)).max(100),cleanupInstructions:z.string().trim().min(10).max(1200),syntheticOnly:z.literal(true),leastPrivilegeAccounts:z.literal(true),externalEffectsDisabled:z.literal(true)}).strict(),
  uiMethods:z.array(httpMethod).min(1).max(6),
  apiSites:z.array(z.object({siteId:z.string().uuid(),methods:z.array(httpMethod).min(1).max(6)}).strict()).max(10),
  resourceOrigins:z.array(z.string().url().max(2048)).max(30),deniedPaths:z.array(path).max(100),operations:z.array(operationInput).max(100),productionWritesAcknowledged:z.boolean(),
}).strict().superRefine((g,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(g.actors[0].id!=='primary'||new Set(g.actors.map(a=>a.id)).size!==g.actors.length)issue('The primary actor must be first; actor IDs must be unique');
  const references=g.actors.flatMap(a=>a.credentialReferences);if(new Set(references).size!==references.length)issue('A credential reference may belong to only one actor');
  if(new Set(g.apiSites.map(a=>a.siteId)).size!==g.apiSites.length)issue('API site scopes must be unique');
  if(g.registration&&!g.capabilities.authenticate)issue('Registration includes authentication and needs that capability');
  if(!g.capabilities.boundary||!g.capabilities.repeat||!g.capabilities.unusualOrder)issue('This exploratory profile includes boundary, repeat and unusual-order testing; narrower profiles are not implemented');
  if(g.mode==='isolated_staging'&&(!g.capabilities.create||!g.capabilities.edit||!g.capabilities.cancel))issue('Isolated staging grants all synthetic write classes; use mapped mode for narrower effects');
  if(g.operations.some(o=>o.scope!=='ui'&&!g.apiSites.some(a=>a.siteId===o.scope)))issue('Each operation must reference the UI or an explicitly selected API site');
  if(g.operations.some(o=>o.effect!=='register'&&!g.capabilities[o.effect]))issue('An operation cannot enable an ungranted capability');
  if(g.operations.some(o=>o.effect==='register')&&!g.registration)issue('Registration operations need an approved identity namespace');
  if(g.mode==='mapped'&&g.registration&&!g.operations.some(o=>o.effect==='register'))issue('Mapped registration needs a registration operation');
  if(g.operations.some(o=>o.path.includes(':fixture'))&&!g.data.fixtureIds.length)issue('Fixture path slots need explicit test fixture IDs');
});
export type RunAuthorization=z.infer<typeof runAuthorization>;
export const guestAuthorization=z.object({
  version:z.literal(1),mode:z.enum(['isolated_staging','mapped']),actors:runAuthorization.shape.actors,capabilities:runAuthorization.shape.capabilities,
  namespace:z.string().min(3).max(80),fixtureIds:runAuthorization.shape.data.shape.fixtureIds,maxAccounts:z.number().int().min(0).max(3),
  uiMethods:z.array(httpMethod),operations:z.array(operationInput.omit({scope:true}).extend({origin:z.string().url()})),
});
export type GuestAuthorization=z.infer<typeof guestAuthorization>;
