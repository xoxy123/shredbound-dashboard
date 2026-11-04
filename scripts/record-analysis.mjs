// Saves an assistant's verified TikTok or Instagram (and order) report. No tokens are written to disk.
import {validate,platforms} from '../src/model.js';
let input='';for await (const part of process.stdin)input+=part;
// The title starts with the platform, so the deployed Worker keeps it even where it drops the platform field.
const report=JSON.parse(input),platform=platforms.includes(report.platform)?report.platform:'TikTok',data=validate('analysis',{
 ...report,platform,title:`${platform} · ${report.periodStart} – ${report.periodEnd}`,
 author:report.analyst||'Codex',analyst:report.analyst||'Codex',
});
const site=new URL(process.env.SHREDBOUND_SITE||'http://127.0.0.1:4318');
if(!['https:','http:'].includes(site.protocol)||site.username||site.password)throw Error('Invalid Site URL');
const headers={'Content-Type':'application/json'};
if(process.env.SITE_AUTHORIZATION)headers['OAI-Sites-Authorization']=process.env.SITE_AUTHORIZATION;
const response=await fetch(new URL('/api/records',site),{method:'POST',headers,body:JSON.stringify({kind:'analysis',data})});
const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save report');
console.log(JSON.stringify({id:result.record.id,periodStart:data.periodStart,periodEnd:data.periodEnd,saved:true}));
