const incoming=$input.first().json;
const name=String(incoming.instance_name||'').trim();
if(!name)return [];
const {Client}=require('pg');
const client=new Client({connectionString:__DB_CONNECTION_BASE__+'/platform_db',connectionTimeoutMillis:5000,
  statement_timeout:5000,query_timeout:6000,options:'-c default_transaction_read_only=on'});
try{
 await client.connect();
 const result=await client.query(`SELECT b.id AS business_id,b.business_code,b.name AS business_name,m.target_db_name
 FROM public.platform_whatsapp_instances i JOIN public.platform_businesses b ON b.business_code=i.business_code
 JOIN public.platform_database_mappings m ON m.business_code=b.business_code
 WHERE i.instance_name=$1 AND b.status='ACTIVE'`,[name]);
 if(result.rows.length!==1)return [];
 const row=result.rows[0];
 if(!['BISE_EDU','POS_RETAIL','HOSP_HEALTH'].includes(row.business_code))return [];
 return [{json:{...incoming,...row,session_id:row.business_code+':'+name+':'+incoming.user_id}}];
}finally{await client.end().catch(()=>{})}
