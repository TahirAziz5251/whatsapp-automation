// n8n ToolCode receives arguments in query, not $input.
let args=typeof query==='undefined'?{}:query;
if(typeof args==='string'){try{args=JSON.parse(args)}catch{return JSON.stringify({status:'INVALID_INPUT'})}}
if(!args||typeof args!=='object'||Array.isArray(args))return JSON.stringify({status:'INVALID_INPUT'});
const context=$('PostgreSQL Persistent Conversation Store').first().json;
const tenant=context.business_code, operation=String(args.operation||'').toLowerCase(), params=args.parameters||{};
const routes={BISE_EDU:{database:'bise_db',operations:['get_student_result','get_fees']},POS_RETAIL:{database:'pos_db',operations:['get_product','get_price','check_inventory']},HOSP_HEALTH:{database:'hospital_db',operations:['get_doctor_schedule','get_doctors_by_specialty','get_departments']}};
const route=routes[tenant];
if(!route||!route.operations.includes(operation)||(args.business_code&&args.business_code!==tenant)||!(context.allowed_tools||[]).includes('query_business_data'))return JSON.stringify({status:'POLICY_DENIED',operation});
let sql,values;
if(operation==='get_student_result'){
 const roll=String(params.roll_number||'').trim();
 if(!/^\d{6}$/.test(roll))return JSON.stringify({status:'INVALID_INPUT',message:'Provide an exact 6-digit roll number.'});
 const year=params.exam_year==null?null:Number(params.exam_year);
 if(year!==null&&(!Number.isInteger(year)||year<1900||year>2200))return JSON.stringify({status:'INVALID_INPUT',message:'Invalid exam year.'});
 sql=`SELECT r.roll_number,s.student_name,s.father_name,e.exam_code,e.title AS exam_title,e.exam_year,e.exam_session,r.marks_obtained,r.total_marks,r.grade,r.status,
 COALESCE((SELECT json_agg(json_build_object('subject',m.subject_name,'obtained_marks',m.obtained_marks,'total_marks',m.total_marks,'grade',m.grade,'status',m.status) ORDER BY m.id) FROM public.result_subject_marks m WHERE m.result_id=r.id),'[]'::json) AS subjects
 FROM public.results r JOIN public.students s ON s.id=r.student_id JOIN public.exams e ON e.id=r.exam_id
 WHERE r.roll_number=$1 AND e.is_declared=true AND ($2::integer IS NULL OR e.exam_year=$2) ORDER BY e.exam_year DESC,e.exam_session LIMIT 5`;
 values=[roll,year];
}else if(operation==='get_fees'){
 sql=`SELECT fee_type,amount_pkr,description FROM public.fees WHERE ($1::text='' OR position(lower($1) in lower(fee_type))>0) ORDER BY id LIMIT 10`;
 values=[String(params.fee_type||'').slice(0,120)];
}else if(tenant==='POS_RETAIL'){
 sql=`SELECT p.sku,p.name,p.description,pr.price_pkr,pr.currency,i.stock_quantity FROM public.products p
 LEFT JOIN LATERAL (SELECT price_pkr,currency FROM public.prices WHERE product_id=p.id AND effective_date<=now() ORDER BY effective_date DESC,id DESC LIMIT 1) pr ON true
 LEFT JOIN public.inventory i ON i.product_id=p.id WHERE p.is_active=true AND ($1::text='' OR lower(p.sku)=lower($1)) AND ($2::text='' OR position(lower($2) in lower(p.name))>0) ORDER BY p.id LIMIT 8`;
 values=[String(params.sku||'').slice(0,100),String(params.product_name||'').slice(0,120)];
}else if(operation==='get_departments'){
 sql='SELECT department_name,location_floor,head_doctor FROM public.departments ORDER BY id LIMIT 12';values=[];
}else{
 sql=`SELECT d.doctor_name,d.specialty,d.qualification,d.opd_fee_pkr,p.department_name,p.location_floor,s.available_days,s.opd_timings,s.max_daily_patients FROM public.doctors d JOIN public.departments p ON p.id=d.department_id LEFT JOIN public.schedules s ON s.doctor_id=d.id WHERE ($1::text='' OR position(lower($1) in lower(d.specialty))>0) AND ($2::text='' OR position(lower($2) in lower(d.doctor_name))>0) ORDER BY d.id LIMIT 8`;
 values=[String(params.specialty||'').slice(0,100),String(params.doctor_name||'').slice(0,120)];
}
let client;
try{
 const {Client}=require('pg');
 client=new Client({connectionString:__DB_CONNECTION_BASE__+'/'+route.database,connectionTimeoutMillis:5000,query_timeout:8000,statement_timeout:7000,options:'-c default_transaction_read_only=on',application_name:'whatsapp_verified_read'});
 await client.connect();const result=await client.query(sql,values);
 return JSON.stringify({status:result.rows.length?'FOUND':'NOT_FOUND',tenant,operation,source_database:route.database,verified_live:true,records:result.rows});
}catch{
 return JSON.stringify({status:'DB_UNAVAILABLE',tenant,operation,verified_live:false,message:'Database could not be checked. Do not invent a record or claim no record exists. Ask the customer to retry later.'});
}finally{if(client)await client.end().catch(()=>{})}
