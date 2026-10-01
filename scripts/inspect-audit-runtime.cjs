const fs=require('fs');const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/home/node/.n8n/database.sqlite',{readOnly:true});
console.log('api tables',db.prepare("select name from sqlite_master where name like '%api%'").all());
try{console.log('api keys',db.prepare('select label,scopes from user_api_keys').all())}catch(e){console.log(e.message)}
for(const name of ['pg','ioredis','redis']){try{console.log('module',name,require.resolve('/usr/local/lib/node_modules/n8n/node_modules/'+name))}catch{console.log('module',name,'unavailable')}}
const base='/usr/local/lib/node_modules/n8n/node_modules/@n8n/n8n-nodes-langchain/dist/nodes/llms';
console.log('llms',fs.readdirSync(base).filter(s=>/groq/i.test(s)));
for(const d of fs.readdirSync(base).filter(s=>/groq/i.test(s))){const p=base+'/'+d+'/'+d+'.node.js';if(fs.existsSync(p))console.log(fs.readFileSync(p,'utf8').split('\n').filter(l=>/maxTokens|maxRetries|timeout|options\./.test(l)).join('\n'))}
db.close();
