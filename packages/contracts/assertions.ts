import {z} from 'zod';

const path=z.string().max(500).refine(s=>s.startsWith('/')&&!s.startsWith('//')&&!/[?#\\%\x00-\x20]/.test(s)&&!s.split('/').some(p=>p==='.'||p==='..'),'literal_same_origin_path_required');
const target=z.object({role:z.enum(['link','button','textbox','combobox']),name:z.string().min(1).max(180)}).strict();
export const replayStep=z.discriminatedUnion('name',[
  z.object({name:z.literal('navigate'),path}).strict(),
  z.object({name:z.literal('click'),target}).strict(),
  z.object({name:z.literal('prepare_identity')}).strict(),
  z.object({name:z.literal('credential_fill'),target,reference:z.string().regex(/^[a-z0-9_.-]{1,80}$/)}).strict(),
]);
export const recordInspection=z.object({heading:z.string().min(1).max(180),role:z.enum(['article','row','listitem']),anchor:z.string().min(1).max(180),valuePrefix:z.string().max(80),valueSuffix:z.string().max(80)}).strict();
export const recordSample=z.object({guardObserved:z.boolean(),recordCount:z.number().int().min(0).max(201),value:z.number().finite().nullable(),text:z.string().max(1500),url:z.string().max(2048)}).strict();
export type RecordSample=z.infer<typeof recordSample>;
export const fixedAssertion=z.object({
  version:z.literal(1),template:z.literal('numeric_record_create_v1'),origin:z.string().url().refine(s=>{try{const u=new URL(s);return u.protocol==='https:'&&u.origin===s&&!u.username&&!u.password;}catch{return false;}}),
  rule:z.string().trim().min(10).max(1000),actor:z.literal('primary'),device:z.literal('desktop'),
  setup:z.array(replayStep).min(1).max(24),formPath:path,readPath:path,heading:z.string().min(1).max(180),
  form:z.object({nameField:target,numberField:target,submit:target}).strict(),
  record:z.object({role:z.enum(['article','row','listitem']),valuePrefix:z.string().max(80),valueSuffix:z.string().max(80)}).strict(),
  bounds:z.object({min:z.number().finite(),max:z.number().finite(),integer:z.boolean()}).strict(),control:z.number().finite(),probe:z.number().finite(),
}).strict().superRefine((a,c)=>{
  const valid=(v:number)=>v>=a.bounds.min&&v<=a.bounds.max&&(!a.bounds.integer||Number.isInteger(v));
  if(a.bounds.min>a.bounds.max||!valid(a.control)||valid(a.probe))c.addIssue({code:'custom',message:'valid_control_and_out_of_bounds_probe_required'});
  if(a.form.nameField.role!=='textbox'||a.form.numberField.role!=='textbox'||a.form.submit.role!=='button')c.addIssue({code:'custom',message:'form_control_roles_required'});
  if(!a.record.valuePrefix&&!a.record.valueSuffix)c.addIssue({code:'custom',message:'numeric_value_label_required'});
});
export type FixedAssertion=z.infer<typeof fixedAssertion>;
export type ReplayStep=z.infer<typeof replayStep>;
export type AssertionOutcome='passed'|'failed'|'blocked'|'inconclusive';
export type AssertionResult={status:AssertionOutcome;reason:string;control?:RecordSample;probe?:RecordSample;controlAfter?:RecordSample};
export type AssertionDetail={hash:string;spec:FixedAssertion;approvedAt:string;attempts:{id:string;runId:string|null;status:string;purpose:'verification'|'retest';createdAt:string;evidence:Record<string,unknown>}[]};
