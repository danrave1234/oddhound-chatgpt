import {test} from 'node:test';import assert from 'node:assert/strict';import {guestRunScope} from '../apps/worker/runtime';import {guestGrant} from './fixtures/authorization';
test('database expiry Dates serialize into the guest contract without forwarding controller-only fields',()=>{
  const expiresAt=new Date(Date.now()+60000),scope=guestRunScope({origin:'https://owned.example',writes:true,registration:false,expiresAt,authorization:guestGrant(),authorizationSnapshot:{privateControllerMetadata:true},platformKey:'synthetic-not-a-key'},expiresAt);
  assert.equal(scope.expiresAt,expiresAt.toISOString());assert(!Object.hasOwn(scope,'platformKey'));assert(!Object.hasOwn(scope,'authorizationSnapshot'));
});
