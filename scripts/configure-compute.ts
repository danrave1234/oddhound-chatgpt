import {configureBrowserCompute} from '../packages/db/compute';
import {getPool} from '../packages/db';

if(!process.argv.includes('--apply'))throw new Error('explicit_compute_configuration_flag_required');
const micros=(key:string)=>{const value=process.env[key]??'';if(!/^\d+(\.\d{1,6})?$/.test(value))throw new Error('explicit_compute_dollar_amount_required');const [whole,fraction='']=value.split('.');const result=Number(whole)*1_000_000+Number(fraction.padEnd(6,'0'));if(!Number.isSafeInteger(result)||result<=0)throw new Error('invalid_compute_dollar_amount');return result;};
try{
  await configureBrowserCompute({enabled:process.env.ODDHOUND_COMPUTE_ENABLED==='1',region:process.env.ODDHOUND_FLY_REGION??'',hourlyMicros:micros('ODDHOUND_COMPUTE_HOURLY_USD'),overheadMicros:micros('ODDHOUND_COMPUTE_OVERHEAD_USD'),limitMicros:micros('ODDHOUND_COMPUTE_ALLOCATION_USD'),cleanupSeconds:Number(process.env.ODDHOUND_COMPUTE_CLEANUP_SECONDS),rateSource:process.env.ODDHOUND_COMPUTE_RATE_SOURCE??'',rateExpiresAt:new Date(process.env.ODDHOUND_COMPUTE_RATE_EXPIRES_AT??'')});
  console.log('Browser compute policy updated; existing spent and held balances were retained. No Machine was created.');
}finally{await getPool().end();}
