const incoming=$input.first().json;
if(!incoming.instance_name||!incoming.message_id||!incoming.session_id)return [];
const Redis=require('ioredis');
const redis=new Redis({host:'evolution-redis',port:6379,lazyConnect:true,connectTimeout:4000,maxRetriesPerRequest:0,retryStrategy:()=>null,enableOfflineQueue:false});
redis.on('error',()=>{});
try{
 await redis.connect();
 const key='wa:dedup:v2:'+encodeURIComponent(incoming.instance_name)+':'+encodeURIComponent(incoming.message_id);
 const accepted=await redis.set(key,'accepted','EX',86400,'NX');
 if(accepted!=='OK')return [];
 return [{json:{...incoming,redis_transient_state:{storage:'Redis',dedup_claimed:true,ttl_seconds:86400}}}];
}finally{redis.disconnect()}
