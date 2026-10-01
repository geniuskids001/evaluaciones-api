#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise'),crypto=require('crypto');
const API=String(process.env.API_BASE_URL||'').replace(/\/$/,'');
const EMAIL=process.env.ADMIN_EMAIL||'', PASS=process.env.ADMIN_PASSWORD||'';
const USERS=Number(process.env.USERS||550), POLL=Number(process.env.POLL_SECONDS||10), TIMEOUT=Number(process.env.REQUEST_TIMEOUT_MS||30000);
const DB_CLEAN=String(process.env.LOAD_TEST_DB_CLEANUP||'true').toLowerCase()==='true';
if(!API||!EMAIL||!PASS) throw new Error('Missing API_BASE_URL, ADMIN_EMAIL or ADMIN_PASSWORD');
if(!Number.isInteger(USERS)||USERS<1||USERS>5000) throw new Error('Invalid USERS');

const reports=path.join(__dirname,'reports'); fs.mkdirSync(reports,{recursive:true});
const rid=crypto.randomBytes(4).toString('hex'), started=new Date();
const sessionName='LOAD TEST AUTO - '+USERS+' - '+started.toISOString()+' - '+rid;
const metrics={}, errors=[]; let adminToken=null, session=null, db=null;
let cleanup={requested:DB_CLEAN,physical_delete:false,session_remaining:null,applications_remaining:null,error:null};

function pct(a,p){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),i=Math.min(s.length-1,Math.ceil(p/100*s.length)-1);return +s[i].toFixed(2)}
function summary(a,ok,fail){return{requests:a.length,success:ok,failed:fail,error_rate_pct:a.length?+((fail/a.length)*100).toFixed(4):0,p50_ms:pct(a,50),p95_ms:pct(a,95),p99_ms:pct(a,99),max_ms:a.length?+Math.max(...a).toFixed(2):null}}
async function api(method,route,opt={}){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),TIMEOUT),t0=performance.now();
 try{
  const r=await fetch(API+route,{method,headers:{...(opt.body!==undefined?{'Content-Type':'application/json'}:{}),...(opt.token?{Authorization:'Bearer '+opt.token}:{})},body:opt.body!==undefined?JSON.stringify(opt.body):undefined,signal:c.signal});
  let payload=null;if(r.status!==204){const t=await r.text();payload=t?JSON.parse(t):null}
  const accept=opt.accept||[200];if(!accept.includes(r.status)){const e=new Error((payload?.error?.code||'HTTP_ERROR')+': '+(payload?.error?.message||('HTTP '+r.status)));e.status=r.status;throw e}
  return{status:r.status,data:payload?.data??payload,elapsed:performance.now()-t0}
 }finally{clearTimeout(timer)}
}
async function batch(name,items,fn){
 const times=[];let ok=0,fail=0;
 const rows=await Promise.all(items.map(async(x,i)=>{const t=performance.now();try{const v=await fn(x,i);times.push(performance.now()-t);ok++;return{ok:true,v}}catch(e){times.push(performance.now()-t);fail++;errors.push({phase:name,index:i,message:e.message,status:e.status||null});return{ok:false,e}}}));
 metrics[name]=summary(times,ok,fail);return rows
}
function answer(q){
 const o=q.opciones||[];
 if(q.tipo==='single_choice')return Number(o[0]?.id_opcion);
 if(q.tipo==='multiple_choice'){const n=Number(q.configuracion?.min_selecciones??1);return o.slice(0,n).map(x=>Number(x.id_opcion))}
 if(q.tipo==='ranking')return o.map(x=>Number(x.id_opcion));
 throw new Error('Unsupported question type '+q.tipo)
}
async function login(){
 const r=await api('POST','/auth/login',{body:{email:EMAIL,password:PASS}});
 adminToken=r.data?.token||r.data?.access_token||r.data?.jwt;if(!adminToken)throw new Error('Admin token missing')
}
async function createSession(){
 const r=await api('GET','/sesiones/opciones-evaluaciones',{token:adminToken});
 const list=r.data?.evaluaciones||[];if(!list.length)throw new Error('No published evaluation');
 const e=list.find(x=>x.id_evaluacion_version&&(x.status==='published'||x.version_status==='published'))||list[0];
 const idE=Number(e.id_evaluacion),idV=Number(e.id_evaluacion_version||e.id_version_activa);if(!idE||!idV)throw new Error('Evaluation/version unresolved');
 const s=await api('POST','/sesiones',{token:adminToken,accept:[201],body:{id_evaluacion:idE,id_evaluacion_version:idV,nombre:sessionName,descripcion:'Autonomous load test '+rid+'; safe to delete',imagen_url:null,tipo_sesion:'individual',programar_sesion:false,timezone:'America/Mexico_City',aceptar_ingresos:true,aceptar_respuestas:true,configuracion:{permitir_regresar:true,mostrar_resultados:true,permitir_reinicio:false}}});
 session=s.data?.sesion||s.data;session.id_sesion_evaluacion=Number(session?.id_sesion_evaluacion);session.codigo_acceso=String(session?.codigo_acceso||'');
 if(!session.id_sesion_evaluacion||!/^\d{6}$/.test(session.codigo_acceso))throw new Error('Session id/code missing')
}
async function join(){
 const users=Array.from({length:USERS},(_,i)=>i+1);
 const rows=await batch('join',users,async n=>{const r=await api('POST','/sesiones/join/'+session.codigo_acceso,{accept:[200,201],body:{nombre:'LOADTEST-'+rid+'-'+String(n).padStart(4,'0')}});if(!r.data?.access_token||!r.data?.aplicacion?.id_aplicacion)throw new Error('Join payload incomplete');return{token:r.data.access_token,id:Number(r.data.aplicacion.id_aplicacion)}});
 const p=rows.filter(x=>x.ok).map(x=>x.v);if(p.length!==USERS)throw new Error('Only '+p.length+'/'+USERS+' joined');return p
}
async function polling(p){
 const times=[];let ok=0,fail=0,end=Date.now()+POLL*1000;
 while(Date.now()<end){const tick=Date.now();await Promise.all(p.map(async(x,i)=>{const t=performance.now();try{await api('GET','/sesiones/participacion/estado',{token:x.token});ok++}catch(e){fail++;errors.push({phase:'polling',index:i,message:e.message,status:e.status||null})}finally{times.push(performance.now()-t)}}));const wait=1000-(Date.now()-tick);if(wait>0)await new Promise(r=>setTimeout(r,wait))}
 metrics.polling=summary(times,ok,fail)
}
async function answerAll(p){
 const f=await api('GET','/sesiones/participacion/pregunta?orden=1',{token:p[0].token});const total=Number(f.data?.total_preguntas||0);if(!total)throw new Error('No questions');metrics.questions={total};
 for(let order=1;order<=total;order++){
  const q=await batch('question_'+order,p,async x=>{const r=await api('GET','/sesiones/participacion/pregunta?orden='+order,{token:x.token});if(!r.data?.pregunta?.id_pregunta)throw new Error('Question missing');return{p:x,q:r.data.pregunta}});
  const prepared=q.filter(x=>x.ok).map(x=>x.v);if(prepared.length!==USERS)throw new Error('Question '+order+' load incomplete');
  await batch('answer_'+order,prepared,async x=>api('PUT','/sesiones/participacion/respuestas/'+x.q.id_pregunta,{token:x.p.token,body:{valor:answer(x.q)}}));
  if(metrics['answer_'+order].failed)throw new Error('Question '+order+' answer failures')
 }
}
async function finish(p){
 const r=await batch('finish',p,async x=>{const z=await api('POST','/sesiones/participacion/finalizar',{token:x.token});if(!z.data?.completada)throw new Error('Not completed')});
 if(r.filter(x=>x.ok).length!==USERS)throw new Error('Finish incomplete')
}
async function apiIntegrity(){
 const r=await api('GET','/sesiones/'+session.id_sesion_evaluacion+'/resultados',{token:adminToken});
 const a=r.data?.aplicaciones||r.data?.applications||[];return{applications_seen:a.length,completed_seen:a.filter(x=>x.status==='completada').length}
}
async function openDb(){
 if(!DB_CLEAN)return null;const c={user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'evaluations_app_bd',waitForConnections:true,connectionLimit:2,queueLimit:0};
 if(process.env.DB_SOCKET_PATH)c.socketPath=process.env.DB_SOCKET_PATH;else{c.host=process.env.DB_HOST||'127.0.0.1';c.port=Number(process.env.DB_PORT||3306)}
 if(!c.user||!c.password)throw new Error('DB_USER/DB_PASSWORD required for physical cleanup');db=mysql.createPool(c);await db.query('SELECT 1')
}
async function sqlIntegrity(){
 const id=session.id_sesion_evaluacion;
 const [[a]]=await db.execute("SELECT COUNT(*) total,SUM(status='completada') completed FROM evaluacion_aplicaciones WHERE id_sesion_evaluacion=?",[id]);
 const [[r]]=await db.execute("SELECT COUNT(*) total FROM respuestas r JOIN evaluacion_aplicaciones a ON a.id_aplicacion=r.id_aplicacion WHERE a.id_sesion_evaluacion=?",[id]);
 const [[z]]=await db.execute("SELECT COUNT(*) total FROM resultados r JOIN evaluacion_aplicaciones a ON a.id_aplicacion=r.id_aplicacion WHERE a.id_sesion_evaluacion=?",[id]);
 const [[d]]=await db.execute("SELECT COUNT(*) total FROM (SELECT r.id_aplicacion,r.id_pregunta,COUNT(*) c FROM respuestas r JOIN evaluacion_aplicaciones a ON a.id_aplicacion=r.id_aplicacion WHERE a.id_sesion_evaluacion=? GROUP BY r.id_aplicacion,r.id_pregunta HAVING COUNT(*)>1)x",[id]);
 return{applications:+a.total,completed:+(a.completed||0),answers:+r.total,results:+z.total,duplicate_answer_pairs:+d.total}
}
async function clean(){
 if(!session?.id_sesion_evaluacion)return;
 try{
  if(!DB_CLEAN){await api('DELETE','/sesiones/'+session.id_sesion_evaluacion,{token:adminToken,accept:[204]});cleanup.error='Only API soft delete executed';return}
  if(!db)await openDb();const id=session.id_sesion_evaluacion;await db.execute('DELETE FROM sesiones_evaluacion WHERE id_sesion_evaluacion=?',[id]);
  const [[s]]=await db.execute('SELECT COUNT(*) total FROM sesiones_evaluacion WHERE id_sesion_evaluacion=?',[id]);const [[a]]=await db.execute('SELECT COUNT(*) total FROM evaluacion_aplicaciones WHERE id_sesion_evaluacion=?',[id]);
  cleanup={requested:true,physical_delete:+s.total===0,session_remaining:+s.total,applications_remaining:+a.total,error:null}
 }catch(e){cleanup.error=e.message}
}
function merged(prefix){
 const ks=Object.keys(metrics).filter(k=>k.startsWith(prefix+'_'));if(!ks.length)return null;
 const avg=f=>{const a=ks.map(k=>metrics[k][f]).filter(v=>v!=null);return a.length?+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(2):null};
 return{requests:ks.reduce((s,k)=>s+metrics[k].requests,0),success:ks.reduce((s,k)=>s+metrics[k].success,0),failed:ks.reduce((s,k)=>s+metrics[k].failed,0),p50_ms_avg:avg('p50_ms'),p95_ms_avg:avg('p95_ms'),p99_ms_avg:avg('p99_ms')}
}
function md(x){
 const m=x.metrics,a=x.aggregate;return [
 '# Genius Quiz — Latest Load Test','',
 '**Result:** '+x.result,'**Participants:** '+x.participants,'**Run ID:** '+x.run_id,'**Session:** '+x.session_name,'**Started:** '+x.started_at,'**Finished:** '+x.finished_at,'**Duration:** '+x.duration_seconds+'s','',
 '## Performance','','| Phase | Requests | Success | Failed | p50 | p95 | p99 | Max |','|---|---:|---:|---:|---:|---:|---:|---:|',
 '| Join | '+(m.join?.requests??'-')+' | '+(m.join?.success??'-')+' | '+(m.join?.failed??'-')+' | '+(m.join?.p50_ms??'-')+' ms | '+(m.join?.p95_ms??'-')+' ms | '+(m.join?.p99_ms??'-')+' ms | '+(m.join?.max_ms??'-')+' ms |',
 '| Polling | '+(m.polling?.requests??'-')+' | '+(m.polling?.success??'-')+' | '+(m.polling?.failed??'-')+' | '+(m.polling?.p50_ms??'-')+' ms | '+(m.polling?.p95_ms??'-')+' ms | '+(m.polling?.p99_ms??'-')+' ms | '+(m.polling?.max_ms??'-')+' ms |',
 '| Finish | '+(m.finish?.requests??'-')+' | '+(m.finish?.success??'-')+' | '+(m.finish?.failed??'-')+' | '+(m.finish?.p50_ms??'-')+' ms | '+(m.finish?.p95_ms??'-')+' ms | '+(m.finish?.p99_ms??'-')+' ms | '+(m.finish?.max_ms??'-')+' ms |','',
 'Questions: '+(m.questions?.total??'-'),'Question-load requests: '+(a.questions?.requests??'-')+'; avg burst p95: '+(a.questions?.p95_ms_avg??'-')+' ms','Answer requests: '+(a.answers?.requests??'-')+'; avg burst p95: '+(a.answers?.p95_ms_avg??'-')+' ms','',
 '## Integrity','','    '+JSON.stringify(x.integrity,null,2).replace(/\n/g,'\n    '),'','## Cleanup','','    '+JSON.stringify(x.cleanup,null,2).replace(/\n/g,'\n    '),'','Errors captured: '+x.errors.length,''
 ].join('\n')
}
async function report(result,integrity,failure){
 const end=new Date(),x={result,participants:USERS,run_id:rid,session_name:sessionName,session_id:session?.id_sesion_evaluacion||null,api_base_url:API,started_at:started.toISOString(),finished_at:end.toISOString(),duration_seconds:+((end-started)/1000).toFixed(2),metrics,aggregate:{questions:merged('question'),answers:merged('answer')},integrity,cleanup,failure,errors:errors.slice(0,100)};
 fs.writeFileSync(path.join(reports,'latest.json'),JSON.stringify(x,null,2)+'\n');fs.writeFileSync(path.join(reports,'latest.md'),md(x)+'\n');return x
}
(async()=>{
 let integrity=null,result='FAIL',failure=null;
 try{
  console.log('[load-test] '+sessionName);await login();await createSession();console.log('[load-test] session #'+session.id_sesion_evaluacion+' code '+session.codigo_acceso);
  const p=await join();await polling(p);await answerAll(p);await finish(p);const ai=await apiIntegrity();
  if(DB_CLEAN){await openDb();const si=await sqlIntegrity();integrity={api:ai,sql:si};const expected=USERS*Number(metrics.questions?.total||0);result=si.applications===USERS&&si.completed===USERS&&si.results===USERS&&si.answers===expected&&si.duplicate_answer_pairs===0&&errors.length===0?'PASS':'FAIL'}
  else{integrity={api:ai,sql:null};result=ai.completed_seen===USERS&&errors.length===0?'PASS_WITHOUT_SQL_VERIFICATION':'FAIL'}
 }catch(e){failure=e.stack||e.message;errors.push({phase:'fatal',message:e.message,status:e.status||null})}
 finally{await clean();if(DB_CLEAN&&!cleanup.physical_delete)result='FAIL_CLEANUP';const x=await report(result,integrity,failure);if(db)await db.end().catch(()=>{});console.log('[load-test] result '+x.result);console.log('[load-test] cleanup '+JSON.stringify(cleanup));process.exit(x.result==='PASS'?0:1)}
})();