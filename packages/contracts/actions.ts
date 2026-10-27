import {z} from 'zod';
const target=z.string().min(1).max(200);
export const browserAction=z.discriminatedUnion('name',[
  z.object({name:z.literal('navigate'),url:z.string().url()}),
  z.object({name:z.literal('click'),target}),
  z.object({name:z.literal('fill'),target,value:z.string().max(1000)}),
  z.object({name:z.literal('credential_fill'),target,reference:z.string().regex(/^[a-z0-9_.-]{1,80}$/)}),
  z.object({name:z.literal('select_option'),target,value:z.string().max(300)}),
  z.object({name:z.literal('press'),key:z.enum(['Enter','Tab','Escape','ArrowDown','ArrowUp'])}),
  z.object({name:z.literal('prepare_identity')}),
  z.object({name:z.literal('switch_actor'),actor:z.enum(['primary','secondary'])}),
  z.object({name:z.literal('set_device'),profile:z.enum(['desktop','mobile'])}),
  z.object({name:z.literal('observe')}),
  z.object({name:z.literal('finish_run'),summary:z.string().max(4000),candidates:z.array(z.object({title:z.string().max(180),rule:z.string().max(1000),observation:z.string().max(2000)})).max(20)})
]);
export type BrowserAction=z.infer<typeof browserAction>;
export const browserScope=z.object({
  origin:z.string().url(),writes:z.boolean(),registration:z.boolean(),
  botUrl:z.string().url().default('https://github.com/danrave1234/oddhound-chatgpt'),
  apiOrigins:z.array(z.object({origin:z.string().url(),methods:z.array(z.enum(['GET','HEAD','POST','PUT','PATCH','DELETE'])).max(6)})).max(10).default([]),
  resourceOrigins:z.array(z.string().url()).max(30).default([]),
  deniedPaths:z.array(z.string().regex(/^\//).max(300)).max(100).default([]),
  registrationPrefix:z.string().regex(/^[a-z0-9_-]{3,24}$/).optional(),registrationDomain:z.string().regex(/^[a-z0-9.-]{3,120}$/).optional(),
  expiresAt:z.string().datetime(),
});
export type BrowserScope=z.infer<typeof browserScope>;
export const browserObservation=z.object({
  url:z.string().max(2048),title:z.string().max(300),text:z.string().max(24000),
  controls:z.array(z.object({target:z.string().max(200),role:z.string().max(40),name:z.string().max(180),options:z.array(z.string().max(100)).max(40).optional()})).max(200),
  actor:z.enum(['primary','secondary']).optional(),device:z.enum(['desktop','mobile']).optional(),
  credentialReferences:z.array(z.string().max(80)).max(40).optional(),
  screenshot:z.object({mediaType:z.literal('image/png'),base64:z.string().max(1400000),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),
  screenshotSuppressed:z.string().max(100).optional(),blocked:z.string().max(100).optional(),artifactId:z.string().uuid().optional(),
});
export type BrowserObservation=z.infer<typeof browserObservation>;
