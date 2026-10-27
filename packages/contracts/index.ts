import { z } from 'zod';
export * from './actions';

export const runStatuses = ['queued','provisioning','running','waiting_for_input','stopping','finalizing','completed','stopped','failed','blocked'] as const;
export type RunStatus = typeof runStatuses[number];
export const ACTIVE_STATUSES: RunStatus[] = ['queued','provisioning','running','waiting_for_input','stopping','finalizing'];
export const limits = Object.freeze({ runsPerDay: 3, actions: 250, turns: 60, durationMs: 15*60*1000, runMicros: 2_000_000, publicDailyMicros: 7_000_000, publicLifetimeMicros: 50_000_000, judgeReserveMicros: 15_000_000, requests: 1500, receiveBytes: 50*1024*1024, artifactBytes: 100*1024*1024 });
export const siteInput = z.object({ name: z.string().trim().min(1).max(80), origin: z.string().url().max(2048), environment: z.enum(['staging','production']) });
export const runInput = z.object({ siteId: z.string().uuid(), goal: z.string().trim().min(10).max(3000), writes: z.boolean(), registration: z.boolean().default(false), rules: z.string().trim().max(4000).default(''), testData: z.string().trim().max(2000).default('') });
export type Site = { id:string; name:string; origin:string; environment:'staging'|'production'; verifiedAt:string|null; revision:number; createdAt:string };
export type Run = { id:string; siteId:string|null; siteName:string; origin:string; goal:string; status:RunStatus; stopReason:string|null; createdAt:string; startedAt:string|null; finishedAt:string|null; actions:number; turns:number; spentMicros:number; fundingAccount:'public'|'development'|'judge'; kind:'verified_site'|'demo'; };
export type RunEvent = { id:number; runId:string; kind:string; message:string; createdAt:string; data:Record<string,unknown> };
export type Finding = { id:string; runId:string; title:string; status:'candidate'|'verifying'|'verified'|'inconclusive'|'dismissed'; lifecycle:'open'|'fixed'|'regressed'|null; category:'verified_issue'|'configuration_observation'|'needs_review'|'suggestion'; severity:'high'|'medium'|'low'|'info'; rule:string; observed:string; hypothesis:string|null; evidence:Record<string,unknown>; assertionVersion:string; createdAt:string };
export type Workspace = { identity:{id:string;name:string;local:boolean}|null; sites:Site[]; runs:Run[]; remainingRuns:number; availability:{database:boolean;github:boolean;meta:boolean;browser:boolean;publicLaunch:boolean}; };
export const terminal = (status:RunStatus) => !ACTIVE_STATUSES.includes(status);
export const money = (micros:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(micros/1_000_000);
