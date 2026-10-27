import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalOrigin,publicIP} from '../apps/web/lib/ownership';
test('private, metadata, mapped and non-global addresses are refused',()=>{for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','192.0.2.1'])assert.equal(publicIP(address),false,address);assert.equal(publicIP('8.8.8.8'),true);});
test('scope is an exact HTTPS origin without credentials or ambiguous path',()=>{assert.equal(canonicalOrigin('https://Example.COM:443'),'https://example.com');for(const value of ['http://example.com','https://user:password@example.com','https://example.com/path','https://example.com/?scope=all','https://example.com.'])assert.throws(()=>canonicalOrigin(value));});
