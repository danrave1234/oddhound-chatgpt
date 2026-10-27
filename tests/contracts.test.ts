import {test} from 'node:test';import assert from 'node:assert/strict';import {runInput} from '@oddhound/contracts';
test('public run input cannot select development funding, judging funds or priority',()=>{
  const parsed=runInput.parse({siteId:'88829b47-afb5-4e13-9875-7a7bec8c4723',goal:'Explore my synthetic site',writes:true,registration:true,rules:'Synthetic data only',testData:'test namespace',fundingAccount:'judge',funding_account:'development',priority:'judge'});
  assert(!Object.hasOwn(parsed,'fundingAccount'));assert(!Object.hasOwn(parsed,'funding_account'));assert(!Object.hasOwn(parsed,'priority'));
});
