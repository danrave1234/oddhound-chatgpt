import type {FixedAssertion} from '@oddhound/contracts';
export function numericAssertion(origin='https://owned.example'):FixedAssertion{return{
  version:1,template:'numeric_record_create_v1',origin,rule:'Bookings must have an integer from 1 through 8 seats.',actor:'primary',device:'desktop',
  setup:[{name:'prepare_identity'},{name:'navigate',path:'/register'},{name:'credential_fill',target:{role:'textbox',name:'Username'},reference:'primary.registration1.username'},{name:'credential_fill',target:{role:'textbox',name:'Password'},reference:'primary.registration1.password'},{name:'click',target:{role:'button',name:'Create account'}}],
  formPath:'/',readPath:'/',heading:'A space for what’s next.',form:{nameField:{role:'textbox',name:'Booking name'},numberField:{role:'textbox',name:'Seats'},submit:{role:'button',name:'Create booking'}},
  record:{role:'article',valuePrefix:'',valueSuffix:' seats'},bounds:{min:1,max:8,integer:true},control:3,probe:-1,
};}
