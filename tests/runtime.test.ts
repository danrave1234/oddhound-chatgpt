import {test} from 'node:test';import assert from 'node:assert/strict';import {guestRunScope,trustedControlSources,cleanupConfigured} from '../apps/worker/runtime';import {guestGrant} from './fixtures/authorization';
test('database expiry Dates serialize into the guest contract without forwarding controller-only fields',()=>{
  const expiresAt=new Date(Date.now()+60000),scope=guestRunScope({origin:'https://owned.example',writes:true,registration:false,expiresAt,authorization:guestGrant(),authorizationSnapshot:{privateControllerMetadata:true},platformKey:'synthetic-not-a-key'},expiresAt);
  assert.equal(scope.expiresAt,expiresAt.toISOString());assert(!Object.hasOwn(scope,'platformKey'));assert(!Object.hasOwn(scope,'authorizationSnapshot'));
});
test('orphan cleanup stays configured when the admission gate or image configuration is absent',()=>{
  assert.equal(cleanupConfigured({FLY_API_TOKEN:'synthetic-controller-token',ODDHOUND_BROWSER_APP:'separate-browser',FLY_APP_NAME:'trusted-worker'}),true);
  assert.equal(cleanupConfigured({ODDHOUND_BROWSER_APP:'separate-browser',FLY_APP_NAME:'trusted-worker'}),false);
  assert.equal(cleanupConfigured({FLY_API_TOKEN:'synthetic-controller-token',ODDHOUND_BROWSER_APP:'same-app',FLY_APP_NAME:'same-app'}),false);
});
test('a Fly worker binds control to its own exact private address and rejects public, missing or browser-app sources',()=>{
  const privateIP='fdaa:1:2:3:4:5:6:2';assert.deepEqual(trustedControlSources({FLY_APP_NAME:'trusted-worker',ODDHOUND_BROWSER_APP:'separate-browser',FLY_PRIVATE_IP:privateIP}),[privateIP]);
  assert.deepEqual(trustedControlSources({ODDHOUND_TRUSTED_WEB_IPS:privateIP}),[privateIP]);
  for(const env of [{},{FLY_PRIVATE_IP:privateIP},{FLY_APP_NAME:'browser',ODDHOUND_BROWSER_APP:'browser',FLY_PRIVATE_IP:privateIP},{ODDHOUND_TRUSTED_WEB_IPS:'::1'},{ODDHOUND_TRUSTED_WEB_IPS:'2606:4700:4700::1111'},{ODDHOUND_TRUSTED_WEB_IPS:privateIP+',127.0.0.1'}])assert.throws(()=>trustedControlSources(env),/trusted_control_sources_required/);
});
