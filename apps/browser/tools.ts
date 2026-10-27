import {createHash,randomBytes} from 'node:crypto';
import type {Browser,BrowserContext,Page,ElementHandle} from 'playwright';
import {browserAction,browserObservation,type BrowserAction,type BrowserObservation,type BrowserScope} from '@oddhound/contracts';
import {toolDestination,displayUrl} from './policy';
type Actor='primary'|'secondary';type Profile='desktop'|'mobile';
type Role={context:BrowserContext;page:Page;profile:Profile;sensitive:boolean};
type Credential={reference:string;value:string;actor?:Actor};
export class BrowserTools{
  private actor:Actor='primary';private roles=new Map<Actor,Role>();private credentials=new Map<string,Credential>();private targets=new Map<string,ElementHandle<HTMLElement|SVGElement>>();private revision=0;private prepared=0;private actions=0;private seen=new Set<string>();private lastAction=0;private initialized=false;private stopped=false;private secretState=false;
  constructor(private browser:Browser,private scope:BrowserScope,private permitNavigation:(url:string)=>Promise<void>,private health:()=>Promise<void>){ }
  private async fence(){if(this.stopped||Date.now()>=Date.parse(this.scope.expiresAt))throw new Error('run_expired');await this.health();}
  private async createRole(actor:Actor,profile:Profile){
    const context=await this.browser.newContext({viewport:profile==='desktop'?{width:1440,height:900}:{width:390,height:844},isMobile:profile==='mobile',hasTouch:profile==='mobile',serviceWorkers:'block',acceptDownloads:false,userAgent:`Oddhound/1.0 (+${this.scope.botUrl})`,ignoreHTTPSErrors:false});
    context.setDefaultTimeout(7000);
    const page=await context.newPage();page.on('dialog',d=>void d.dismiss());
    context.on('page',popup=>{if(context.pages().length>2){void popup.close();return;}popup.on('dialog',d=>void d.dismiss());void popup.waitForLoadState('domcontentloaded',{timeout:7000}).then(()=>{if(new URL(popup.url()).origin!==this.scope.origin)return popup.close();this.roles.get(actor)!.page=popup;}).catch(()=>void popup.close());});
    const role={context,page,profile,sensitive:[...this.credentials.values()].some(c=>c.actor===actor)};this.roles.set(actor,role);return role;
  }
  async initialize(credentials:Credential[]){if(this.initialized)throw new Error('already_initialized');await this.fence();if(credentials.length>24)throw new Error('credential_limit');for(const c of credentials){if(!/^[a-z0-9_.-]{1,80}$/.test(c.reference)||typeof c.value!=='string'||c.value.length>2000)throw new Error('invalid_credential');this.credentials.set(c.reference,{...c,actor:c.actor??(c.reference.startsWith('secondary.')?'secondary':'primary')});}this.initialized=true;const role=await this.createRole('primary','desktop');await this.permitNavigation(this.scope.origin+'/');await role.page.goto(this.scope.origin+'/',{waitUntil:'domcontentloaded',timeout:15000});return this.observe();}
  private clean(text:string){for(const {value} of [...this.credentials.values()].sort((a,b)=>b.value.length-a.value.length))if(value)for(const form of new Set([value,encodeURIComponent(value),Buffer.from(value).toString('base64')]))text=text.replaceAll(form,'[REDACTED]');return text;}
  private role(){const role=this.roles.get(this.actor);if(!this.initialized||!role)throw new Error('browser_not_initialized');return role;}
  private async clearTargets(){await Promise.all([...this.targets.values()].map(h=>h.dispose().catch(()=>{})));this.targets.clear();}
  async observe():Promise<BrowserObservation>{await this.fence();const role=this.role(),page=role.page;toolDestination(this.scope,page.url());while(this.targets.size>600){const first=this.targets.keys().next().value!;await this.targets.get(first)!.dispose().catch(()=>{});this.targets.delete(first);}this.revision++;const controls:BrowserObservation['controls']=[];
    const elements=page.locator('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]');const count=Math.min(await elements.count(),400);
    for(let i=0;i<count&&controls.length<200;i++){const item=elements.nth(i);if(!await item.isVisible().catch(()=>false))continue;const handle=await item.elementHandle();if(!handle)continue;
      const info=await handle.evaluate(el=>{const input=el as HTMLInputElement;const labelled=(input.labels?Array.from(input.labels).map(l=>l.textContent??'').join(' '):'');const ids=(el.getAttribute('aria-labelledby')??'').split(' ').filter(Boolean);const name=el.getAttribute('aria-label')||ids.map(id=>document.getElementById(id)?.textContent??'').join(' ')||labelled||el.getAttribute('placeholder')||(el.tagName==='INPUT'?el.getAttribute('name'):'')||el.textContent||el.tagName;return{role:el.getAttribute('role')||({A:'link',BUTTON:'button',INPUT:input.type==='checkbox'?'checkbox':input.type==='radio'?'radio':'textbox',TEXTAREA:'textbox',SELECT:'combobox'} as Record<string,string>)[el.tagName]||'control',name:name.trim().slice(0,180),options:el.tagName==='SELECT'?Array.from((el as HTMLSelectElement).options).slice(0,40).map(o=>o.textContent?.trim().slice(0,100)??''):undefined};});
      const target=`s${this.revision}-c${controls.length+1}`;this.targets.set(target,handle);controls.push({...info,target,name:this.clean(info.name),options:info.options?.map(o=>this.clean(o))});
    }
    const raw=await page.locator('body').evaluate(el=>(el as HTMLElement).innerText.slice(0,24000),undefined,{timeout:5000});const title=await page.locator('title').first().evaluate(el=>(el.textContent??'').slice(0,300)).catch(()=>'');const observation:BrowserObservation={url:this.clean(displayUrl(page.url())),title:this.clean(title),text:this.clean(raw),controls,actor:this.actor,device:role.profile,credentialReferences:[...this.credentials.values()].filter(c=>c.actor===this.actor).map(c=>c.reference)};
    // Generic pages may draw credentials into canvas or other uninspectable pixels.
    // Suppress authenticated captures until a target-specific safe mask is established.
    const authForm=await page.locator('input[type=password],input[autocomplete=one-time-code]').count();
    if(this.secretState||this.credentials.size||role.sensitive||authForm)observation.screenshotSuppressed='credential_state';else{const bytes=await page.screenshot({type:'png',fullPage:false,timeout:5000});if(bytes.length<=1024*1024)observation.screenshot={mediaType:'image/png',base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')};else observation.screenshotSuppressed='artifact_size_limit';}
    return browserObservation.parse(observation);
  }
  async execute(raw:unknown,key:string){await this.fence();const action=browserAction.parse(raw);if(action.name==='finish_run')throw new Error('unsupported_browser_action');if(!/^[a-zA-Z0-9-]{1,80}$/.test(key)||this.seen.has(key))throw new Error('action_replay_refused');if(this.actions>=250)throw new Error('action_limit_reached');if(Date.now()-this.lastAction<1000)throw new Error('action_rate_limited');this.seen.add(key);this.actions++;this.lastAction=Date.now();
    let role=this.role();toolDestination(this.scope,role.page.url());
    if(action.name==='navigate'){const url=toolDestination(this.scope,action.url);await this.permitNavigation(url);await role.page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});}
    else if(action.name==='prepare_identity'){if(!this.scope.registration||!this.scope.registrationPrefix)throw new Error('registration_namespace_required');if(this.prepared>=3)throw new Error('registration_identity_limit');this.prepared++;role.sensitive=true;const prefix=`${this.actor}.registration${this.prepared}`,username=`${this.scope.registrationPrefix}_${randomBytes(5).toString('hex')}`;for(const [part,value] of [['username',username],['email',this.scope.registrationDomain?`${username}@${this.scope.registrationDomain}`:username],['password',randomBytes(24).toString('base64url')]])this.credentials.set(`${prefix}.${part}`,{reference:`${prefix}.${part}`,value,actor:this.actor});}
    else if(action.name==='switch_actor'||action.name==='set_device'){const actor=action.name==='switch_actor'?action.actor:this.actor,profile=action.name==='set_device'?action.profile:'desktop';if(action.name==='set_device'&&this.roles.has(actor)){await this.roles.get(actor)!.context.close();this.roles.delete(actor);}this.actor=actor;role=this.roles.get(actor)??await this.createRole(actor,profile);if(role.page.url()==='about:blank'){await this.permitNavigation(this.scope.origin+'/');await role.page.goto(this.scope.origin+'/',{waitUntil:'domcontentloaded',timeout:15000});}}
    else if(action.name==='press'){await role.page.keyboard.press(action.key);}
    else if(action.name!=='observe'){const handle=this.targets.get(action.target);if(!handle)throw new Error('stale_or_unknown_target');const frame=await handle.ownerFrame();if(!frame||frame.page()!==role.page||new URL(frame.url()).origin!==this.scope.origin)throw new Error('frame_action_refused');
      if(action.name==='click')await handle.click({timeout:7000});
      else if(action.name==='select_option')await handle.selectOption({label:action.value},{timeout:7000});
      else{const isSecret=await handle.evaluate(el=>el.getAttribute('type')==='password'||/(password|secret|token|one-time-code)/i.test([el.getAttribute('name'),el.getAttribute('autocomplete')].join(' ')));
        if(action.name==='fill'){if(isSecret)throw new Error('credential_reference_required');await handle.fill(action.value,{timeout:7000});}
        else{const credential=this.credentials.get(action.reference);if(!credential||credential.actor!==this.actor)throw new Error('credential_scope_refused');role.sensitive=true;await handle.fill(credential.value,{timeout:7000});}
      }
    }
    await this.fence();await role.page.waitForLoadState('domcontentloaded',{timeout:3000}).catch(()=>{});return this.observe();
  }
  async close(){this.stopped=true;await this.clearTargets();await Promise.all([...this.roles.values()].map(r=>r.context.close().catch(()=>{})));this.credentials.clear();}
}
