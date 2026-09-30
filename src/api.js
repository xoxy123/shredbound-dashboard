import {validate,kinds} from './model.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const maxMedia=50*1024*1024;
const mediaTypes=['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp','image/gif'];
const row=r=>({...r,data:JSON.parse(r.data),archived:!!r.archived});
const validId=s=>/^[a-zA-Z0-9-]{1,80}$/.test(s);
export async function api(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!env.DB||!env.UPLOADS)return json({error:'Lagringen är inte ansluten ännu. Dina uppgifter har inte sparats.'},503);
 if(!['GET','HEAD'].includes(request.method)){
  const origin=request.headers.get('Origin');
  if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Otillåtet ursprung.'},403);
 }
 try{
  if(path==='/api/records'&&request.method==='GET'){
   const {results}=await env.DB.prepare('SELECT * FROM records ORDER BY created_at DESC').all();return json({records:results.map(row)});
  }
  if(path==='/api/export'&&request.method==='GET'){
   const {results}=await env.DB.prepare('SELECT * FROM records ORDER BY created_at').all();return new Response(JSON.stringify({app:'Shredbound Dashboard',version:1,exportedAt:new Date().toISOString(),records:results.map(row)},null,2),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="shredbound-dashboard.json"','Cache-Control':'no-store'}});
  }
  if(path==='/api/records'&&request.method==='POST'){
   if(Number(request.headers.get('Content-Length'))>100000)return json({error:'Posten är för stor.'},413);
   const body=await request.json(),data=validate(body.kind,body.data),id=crypto.randomUUID(),date=new Date().toISOString();
   const relationError=await checkRelations(env,body.kind,data);if(relationError)return json({error:relationError},400);
   await env.DB.prepare('INSERT INTO records (id,kind,data,created_at,updated_at) VALUES (?,?,?,?,?)').bind(id,body.kind,JSON.stringify(data),date,date).run();
   return json({record:{id,kind:body.kind,data,revision:1,created_at:date,updated_at:date,archived:false}},201);
  }
  const match=path.match(/^\/api\/records\/([a-zA-Z0-9-]+)$/);
  if(match&&request.method==='PATCH'){
   const existing=await env.DB.prepare('SELECT * FROM records WHERE id=?').bind(match[1]).first();if(!existing)return json({error:'Posten finns inte.'},404);
   const body=await request.json();if(body.revision!==existing.revision)return json({error:'Posten har ändrats i en annan flik. Uppdatera och försök igen.'},409);
   const data=body.data?validate(existing.kind,body.data):JSON.parse(existing.data),archived=typeof body.archived==='boolean'?Number(body.archived):existing.archived;
   const relationError=await checkRelations(env,existing.kind,data);if(relationError)return json({error:relationError},400);
   const date=new Date().toISOString(),result=await env.DB.prepare('UPDATE records SET data=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(data),archived,date,existing.id,body.revision).run();
   if(!result.meta.changes)return json({error:'Posten ändrades nyss. Uppdatera och försök igen.'},409);
   return json({record:{...existing,data,archived:!!archived,revision:existing.revision+1,updated_at:date}});
  }
  if(path==='/api/media'&&request.method==='POST'){
   const mime=request.headers.get('Content-Type')?.split(';')[0],length=Number(request.headers.get('Content-Length'));
   if(!mediaTypes.includes(mime))return json({error:'Välj MP4, WebM, MOV, JPG, PNG, WebP eller GIF.'},415);
   if(!length||length>maxMedia)return json({error:'Filen får vara högst 50 MB och kan inte vara tom.'},413);
   const bytes=await request.arrayBuffer();if(bytes.byteLength>maxMedia)return json({error:'Filen får vara högst 50 MB.'},413);
   const id=crypto.randomUUID(),filename=(request.headers.get('X-Filename')||'media').slice(0,200),date=new Date().toISOString();
   await env.UPLOADS.put(id,bytes,{httpMetadata:{contentType:mime},customMetadata:{filename}});
   try{await env.DB.prepare('INSERT INTO media (id,filename,mime,size,created_at) VALUES (?,?,?,?,?)').bind(id,filename,mime,bytes.byteLength,date).run();}catch(e){await env.UPLOADS.delete(id);throw e;}
   return json({id,filename,mime,size:bytes.byteLength,url:'/api/media/'+id},201);
  }
  const mediaMatch=path.match(/^\/api\/media\/([a-zA-Z0-9-]+)$/);
  if(mediaMatch&&['GET','HEAD'].includes(request.method)){
   const info=await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(mediaMatch[1]).first();if(!info)return json({error:'Filen finns inte.'},404);
   const range=request.headers.get('Range');let bounds;
   if(range){const r=range.match(/^bytes=(\d*)-(\d*)$/);if(!r||(!r[1]&&!r[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});let start=r[1]?Number(r[1]):Math.max(0,info.size-Number(r[2])),end=r[1]?(r[2]?Math.min(Number(r[2]),info.size-1):info.size-1):info.size-1;if(start>end||start>=info.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});bounds={offset:start,length:end-start+1};}
   const object=await env.UPLOADS.get(mediaMatch[1],bounds?{range:bounds}:undefined);if(!object)return json({error:'Filen kunde inte hittas.'},404);
   const headers={'Content-Type':info.mime,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=300','Content-Length':String(bounds?.length??info.size),'X-Content-Type-Options':'nosniff'};
   if(bounds)headers['Content-Range']=`bytes ${bounds.offset}-${bounds.offset+bounds.length-1}/${info.size}`;
   return new Response(request.method==='HEAD'?null:object.body,{status:bounds?206:200,headers});
  }
  return json({error:'Sidan finns inte.'},404);
 }catch(e){console.error('Dashboard API:',e.message);if(e.message?.includes('no such table'))return json({error:'Databasen förbereds. Försök snart igen.'},503);return json({error:e instanceof SyntaxError?'Ogiltigt innehåll.':/Ange|Skriv|Välj|Ladda|kan inte|måldatum|Länken|Ogiltig/.test(e.message)?e.message:'Kunde inte spara. Försök igen; formuläret finns kvar.'},400);}
}
async function checkRelations(env,kind,data){
 for(const [field,target] of [['videoId','video'],['buildId','build']])if(data[field]){if(!validId(data[field]))return 'Ogiltig koppling.';const r=await env.DB.prepare('SELECT kind FROM records WHERE id=?').bind(data[field]).first();if(r?.kind!==target)return 'Den länkade posten finns inte längre.';}
 if(data.mediaId){if(!validId(data.mediaId))return 'Ogiltig fil.';const r=await env.DB.prepare('SELECT mime FROM media WHERE id=?').bind(data.mediaId).first();if(!r)return 'Den bifogade filen finns inte.';if(kind==='feedback')data.mediaType=r.mime;if(kind==='video'&&!r.mime.startsWith('video/'))return 'Välj en videofil för videobiblioteket.';}
 return null;
}
