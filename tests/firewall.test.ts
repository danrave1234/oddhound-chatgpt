import {test} from 'node:test';import assert from 'node:assert/strict';
import {flyNeighborTransport} from '../apps/browser/firewall';

test('Fly neighbor transport requires the observed exact interface and link-local gateway',()=>{
  const rules=flyNeighborTransport([{dst:'default',gateway:'fe80::1',dev:'eth0'}]);
  assert.match(rules.input,/saddr fe80::1 ip6 hoplimit 255/);
  assert.match(rules.output,/daddr \{ fe80::1, ff02::1:ff00:1 \}/);
  for(const routes of [null,[],[{dst:'default',gateway:'fe80::2',dev:'eth0'}],[{dst:'default',gateway:'fe80::1',dev:'eth1'}],[{dst:'default',gateway:'fd00::1',dev:'eth0'}],[{dst:'default',gateway:'fe80::1',dev:'eth0'},{dst:'default',gateway:'fe80::2',dev:'eth1'}]])assert.throws(()=>flyNeighborTransport(routes),/unsupported_fly_ipv6_gateway/);
});
