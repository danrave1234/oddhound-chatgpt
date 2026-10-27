import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.FIXTURE_DATABASE_URL}),name=`verify_${randomBytes(6).toString('hex')}`,secret=randomBytes(24).toString('hex');
const outcomes:unknown[]=[];
try{for(const target of [{host:'http://fixture:3002',origin:'http://localhost:3002',corrected:false},{host:'http://fixture-corrected:3002',origin:'http://localhost:3003',corrected:true}]){
  const username=`${name}_${target.corrected?'fixed':'before'}`;let cookie='';
  const post=async(path:string,data:Record<string,string>)=>{const r=await fetch(target.host+path,{method:'POST',headers:{origin:target.origin,'content-type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams(data),redirect:'manual'});if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return r;};
  assert.equal((await fetch(target.host+'/register')).status,200);
  assert.equal((await post('/register',{username,password:secret})).status,303);
  assert.equal((await post('/logout',{})).status,303);assert.equal((await post('/login',{username,password:secret})).status,303);
  const valid=await post('/bookings',{name:'Valid control',seats:'3'});assert.equal(valid.status,303);
  const invalid=await post('/bookings',{name:'Boundary check',seats:'-1'});assert.equal(invalid.status,target.corrected?422:303);
  const rows=(await pool.query('SELECT b.* FROM fixture_bookings b JOIN fixture_accounts a ON a.id=b.account_id WHERE a.username=$1 ORDER BY b.created_at',[username])).rows;
  assert.equal(rows.some(r=>r.seats<1||r.seats>8),!target.corrected);const control=rows.find(r=>r.name==='Valid control');assert.equal(control.seats,3);
  assert.equal((await post(`/bookings/${control.id}`,{seats:'4'})).status,303);assert.equal((await post(`/bookings/${control.id}/cancel`,{})).status,303);
  const final=(await pool.query('SELECT seats,status FROM fixture_bookings WHERE id=$1',[control.id])).rows[0];assert.equal(final.seats,4);assert.equal(final.status,'cancelled');
  outcomes.push({corrected:target.corrected,registration:true,login:true,validControl:true,invalidResponse:invalid.status,negativeSeatPersisted:rows.some(r=>r.seats<1),edit:true,cancel:true});
}}finally{const users=(await pool.query('SELECT id FROM fixture_accounts WHERE username LIKE $1',[`${name}%`])).rows.map(r=>r.id);await pool.query('DELETE FROM fixture_bookings WHERE account_id=ANY($1::uuid[])',[users]);await pool.query('DELETE FROM fixture_sessions WHERE account_id=ANY($1::uuid[])',[users]);await pool.query('DELETE FROM fixture_accounts WHERE id=ANY($1::uuid[])',[users]);await pool.end();}
console.log(JSON.stringify({kind:'scripted_http_and_independent_sql',modelInference:false,assertion:'Persisted bookings have an integer from 1 through 8 seats',version:1,outcomes},null,2));
