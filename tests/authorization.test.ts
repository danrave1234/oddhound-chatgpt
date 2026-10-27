import {test} from 'node:test';import assert from 'node:assert/strict';
import {compileRunAuthorization,assertAuthorizationCurrent,authorizationHash} from '../packages/db/run-authorization';import {runAuthorization} from '@oddhound/contracts';import {grant,primaryId,apiId} from './fixtures/authorization';
// These are injected verification/credential rows; no DNS or provider call is made.
const site={id:primaryId,origin:'https://owned.example',revision:1,environment:'staging',verified_at:new Date(),verification_method:'file'},api={...site,id:apiId,origin:'https://api.owned.example'};
const compile=(authorization=grant(),extra:Record<string,unknown>={})=>compileRunAuthorization({site,apis:[],credentials:[],authorization,writes:true,registration:true,...extra});
test('owner contract freezes selected APIs, actors and only their credential revisions',()=>{
  const g=grant();g.apiSites=[{siteId:apiId,methods:['GET','POST']}];g.actors[0].credentialReferences=['test.email','test.password'];g.actors[0].identityMarker='Known test account';
  const credentials=[{id:'c1',reference:'test.email',revision:2},{id:'c2',reference:'test.password',revision:1},{id:'c3',reference:'admin.password',revision:1}];const result=compile(g,{apis:[api],credentials});
  assert.deepEqual(result.snapshot.credentialBindings.map(c=>c.reference),['test.email','test.password']);assert.equal(result.snapshot.apiOrigins[0].revision,1);
  assertAuthorizationCurrent(result.snapshot,result.hash,[site,api],credentials);assert.throws(()=>assertAuthorizationCurrent(result.snapshot,result.hash,[site,{...api,revision:2}],credentials),/active_origin_grant_changed/);
  assert.throws(()=>assertAuthorizationCurrent(result.snapshot,result.hash,[site,api],credentials.map(c=>({...c,revision:3}))),/credential_grant_changed/);
});
test('API proof cannot be borrowed from a UI origin or an absent owner row',()=>{
  const g=grant();g.apiSites=[{siteId:apiId,methods:['POST']}];assert.throws(()=>compile(g),/api_verification_required/);assert.throws(()=>compile(g,{apis:[{...api,verified_at:null}]}),/api_verification_required/);assert.throws(()=>compile(g,{apis:[{...api,origin:site.origin}]}),/api_origin_must_be_separate/);
});
test('production and production API writes require mapped permission and acknowledgement',()=>{
  const g=grant();assert.throws(()=>compile(g,{site:{...site,environment:'production'}}),/production_write_policy_required/);g.apiSites=[{siteId:apiId,methods:['POST']}];assert.throws(()=>compile(g,{apis:[{...api,environment:'production'}]}),/production_api_write_policy_required/);
  g.apiSites=[];g.mode='mapped';g.productionWritesAcknowledged=true;g.operations=[{scope:'ui',method:'POST',path:'/records',effect:'create',body:{encoding:'json',field:'name',match:'namespace_prefix'}},{scope:'ui',method:'POST',path:'/register',effect:'register',body:{encoding:'form',field:'username',match:'namespace_prefix'}}];assert.equal(compile(g,{site:{...site,environment:'production'}}).snapshot.guest.mode,'mapped');
  g.operations[0].body=undefined;assert.throws(()=>compile(g,{site:{...site,environment:'production'}}),/operation_fixture_binding_required/);
  const auth=grant();auth.mode='mapped';auth.registration=undefined;auth.capabilities.create=auth.capabilities.edit=auth.capabilities.cancel=false;auth.apiSites=[{siteId:apiId,methods:['POST']}];auth.operations=[{scope:apiId,method:'POST',path:'/session',effect:'authenticate'}];assert.equal(compile(auth,{apis:[{...api,environment:'production'}],writes:false,registration:false}).snapshot.writes,false);
});
test('invalid capabilities, fixture slots, actor sharing and resource authority are rejected',()=>{
  const narrower=grant();narrower.capabilities.repeat=false;assert.throws(()=>runAuthorization.parse(narrower));narrower.capabilities.repeat=true;narrower.capabilities.authenticate=false;assert.throws(()=>runAuthorization.parse(narrower));
  const g=grant();g.actors=[{id:'primary',label:'A',credentialReferences:['shared']},{id:'secondary',label:'B',credentialReferences:['shared']}];assert.throws(()=>runAuthorization.parse(g));
  const other=grant();other.resourceOrigins=[site.origin];assert.throws(()=>compile(other),/resource_scope_overlaps/);other.resourceOrigins=['http://cdn.example'];assert.throws(()=>compile(other),/public_https_scope_required/);
  other.resourceOrigins=[];other.operations=[{scope:'ui',method:'POST',path:'/records/:fixture',effect:'cancel'}];assert.throws(()=>compile(other));
});
test('snapshot hash survives JSON key reordering but rejects changed authorization',()=>{
  const result=compile(),snapshot=JSON.parse(JSON.stringify(result.snapshot));const reordered=Object.fromEntries(Object.entries(snapshot).reverse());assert.equal(authorizationHash(reordered),result.hash);
  snapshot.guest.uiMethods.push('DELETE');assert.throws(()=>assertAuthorizationCurrent(snapshot,result.hash,[site],[]),/authorization_snapshot_changed/);
});
