const input=$input.first().json;
const context=$('PostgreSQL Persistent Conversation Store').first().json;
const steps=Array.isArray(input.intermediateSteps)?input.intermediateSteps:[];
const observations=[];
for(const step of steps){
 const value=step.observation;
 try{const parsed=typeof value==='string'?JSON.parse(value):value;if(parsed&&typeof parsed==='object')observations.push(parsed)}catch{}
}
const data=observations.filter(o=>o.tenant===context.business_code&&o.operation);
const failure=data.find(o=>o.status==='DB_UNAVAILABLE'||o.status==='POLICY_DENIED');
let output=String(input.output||'').trim();
let status='NO_DATABASE_CLAIM';
if(failure){output='The database lookup could not be verified right now. Please try again shortly.';status='LOOKUP_FAILED'}
else if(context.business_code==='BISE_EDU'){
 const result=data.findLast(o=>o.operation==='get_student_result');
 if(result?.verified_live&&result.status==='FOUND'&&Array.isArray(result.records)){
  if(result.records.length!==1){output='More than one examination record matches. Please provide the examination year and session.';status='CLARIFICATION_REQUIRED'}
  else{
   const r=result.records[0];
   output=`*Examination result*\nRoll number: ${r.roll_number}\nStudent: ${r.student_name}\nFather: ${r.father_name}\nExam: ${r.exam_title}\nSession: ${r.exam_session} ${r.exam_year}\nMarks: ${r.marks_obtained}/${r.total_marks}\nGrade: ${r.grade}\nStatus: ${r.status}`;
   if(Array.isArray(r.subjects)&&r.subjects.length)output+='\n\n*Subject marks*\n'+r.subjects.map(s=>`${s.subject}: ${s.obtained_marks}/${s.total_marks} (${s.status})`).join('\n');
   output+='\n\nRetrieved from the current examination database.';status='DATABASE_VERIFIED';
  }
 }else if(result?.verified_live&&result.status==='NOT_FOUND'){output='No matching declared examination result was found. Please check the six-digit roll number and examination year.';status='NOT_FOUND'}
 else if(result?.status==='INVALID_INPUT'){output='Please provide your exact six-digit roll number and, if relevant, the examination year.';status='INVALID_INPUT'}
 else if(/\b\d{6}\b|marks|result|roll|fee|fees|نمبر|نتیجہ|فیس/i.test(context.messageText||'')&&!data.some(o=>o.verified_live)){
  output=/\b\d{6}\b/.test(context.messageText||'')?'The database lookup could not be verified right now. Please try again shortly.':'Please provide your exact six-digit roll number for a result lookup, or specify the fee you want to check.';
  status='UNVERIFIED_ANSWER_BLOCKED';
 }
 const fees=data.findLast(o=>o.operation==='get_fees');
 if(fees?.verified_live&&fees.status==='FOUND'){output='*Current board fees*\n'+fees.records.map(r=>`${r.fee_type}: PKR ${r.amount_pkr}`).join('\n');status='DATABASE_VERIFIED'}
 if(fees?.verified_live&&fees.status==='NOT_FOUND'){output='No matching fee category was found in the current database. Please specify the service name.';status='NOT_FOUND'}
}
if(!output)throw Error('No verified response available');
return [{json:{output,validation_guard:{status},retrieval_evidence:data.map(o=>({tenant:o.tenant,operation:o.operation,status:o.status,source_database:o.source_database,verified_live:o.verified_live}))}}];
