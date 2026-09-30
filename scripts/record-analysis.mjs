// Saves an assistant's verified TikTok/order report. No tokens are written to disk.
import {validate} from '../src/model.js';
let input='';for await (const part of process.stdin)input+=part;
const report=JSON.parse(input),data=validate('analysis',{
 ...report,title:report.title||`TikTok · ${report.periodStart} – ${report.periodEnd}`,
 author:'Codex',analyst:'Codex',
});
const site=new URL(process.env.SHREDBOUND_SITE||'http://127.0.0.1:4318');
if(!['https:','http:'].includes(site.protocol)||site.username||site.password)throw Error('Invalid Site URL');
const headers={'Content-Type':'application/json'};
if(process.env.SITE_AUTHORIZATION)headers['OAI-Sites-Authorization']=process.env.SITE_AUTHORIZATION;
const response=await fetch(new URL('/api/records',site),{method:'POST',headers,body:JSON.stringify({kind:'analysis',data})});
const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save report');
console.log(JSON.stringify({id:result.record.id,periodStart:data.periodStart,periodEnd:data.periodEnd,saved:true}));
