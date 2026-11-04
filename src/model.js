export const categories=['Åkkänsla & carving','Hopp & pop','Rotationer & air control','Grabs & stil','Rails & boxar','Landning & krasch','Switch & butters','Kamera','First Light & banor','Karaktär & animation','Grafik & snö','Kontroller & UI','Prestanda & builds','Ljud','Övrigt'];
export const platforms=['TikTok','Instagram'];
// Reports saved before the platform field existed, or through a Worker that drops it, carry the platform in their title.
export const platformOf=d=>platforms.includes(d?.platform)?d.platform:/instagram/i.test(`${d?.title||''} ${d?.dataSource||''}`)?'Instagram':'TikTok';
export const kinds=['feedback','video','goal','build','playtest','budget','content','analysis','settings'];
const text=(value,max=Infinity)=>typeof value==='string'?value.trim().slice(0,max):'';
const number=(value,min=0,max=1e12)=>{const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw new Error('Ange ett giltigt tal.');return n;};
const choice=(v,values,fallback)=>values.includes(v)?v:fallback;
export function safeUrl(v){if(!v)return '';const u=new URL(v);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('Länken måste börja med https:// eller http://.');return u.href;}
export function validate(kind,input){
 if(!kinds.includes(kind)||!input||typeof input!=='object'||Array.isArray(input))throw new Error('Ogiltig post.');
 const d={title:text(input.title),author:text(input.author,60)||'William',details:text(input.details),category:choice(input.category,categories,'Övrigt')};
 if(kind==='feedback'){if(!d.title&&!d.details&&!input.mediaId)throw new Error('Skriv feedback eller bifoga en bild eller video.');d.title=d.title||d.details.split('\n')[0].slice(0,180)||(String(input.mediaType).startsWith('video/')?'Video':'Bild');}else if(!d.title)throw new Error('Skriv en titel.');
 switch(kind){
 case 'feedback':Object.assign(d,{status:choice(input.status,['open','progress','review','fixed'],'open'),priority:choice(input.priority,['low','normal','high','critical'],'normal'),expected:text(input.expected),steps:text(input.steps),videoId:text(input.videoId,80),buildId:text(input.buildId,80),timestamp:input.timestamp===''||input.timestamp==null?null:number(input.timestamp,0,86400),mediaId:text(input.mediaId,80),mediaType:text(input.mediaType,80)});break;
 case 'video':Object.assign(d,{status:choice(input.status,['new','review','done'],'new'),purpose:choice(input.purpose,['gameplay','reference','edit'],'gameplay'),url:safeUrl(input.url),mediaId:text(input.mediaId,80),buildId:text(input.buildId,80)});if(!d.url&&!d.mediaId)throw new Error('Ladda upp en video eller ange en länk.');break;
 case 'goal':Object.assign(d,{type:choice(input.type,['number','milestone'],'number'),target:number(input.target??1,0.000001),current:number(input.current??0),unit:text(input.unit,40),due:text(input.due,10),status:choice(input.status,['active','done'],'active')});break;
 case 'build':Object.assign(d,{platform:choice(input.platform,['Windows','macOS','Linux'],'Windows'),commit:text(input.commit,40),url:safeUrl(input.url),status:choice(input.status,['untested','testing','passed','failed'],'untested'),passed:input.passed===''||input.passed==null?null:number(input.passed),failed:input.failed===''||input.failed==null?null:number(input.failed),fps:input.fps===''||input.fps==null?null:number(input.fps,0,10000)});break;
 case 'playtest':Object.assign(d,{buildId:text(input.buildId,80),result:choice(input.result,['planned','passed','failed','blocked'],'planned'),attempts:number(input.attempts??1,1,100000),successes:number(input.successes??0,0,100000),fps:input.fps===''||input.fps==null?null:number(input.fps,0,10000),videoId:text(input.videoId,80)});if(d.successes>d.attempts)throw new Error('Godkända försök kan inte vara fler än alla försök.');break;
 case 'budget':Object.assign(d,{type:choice(input.type,['expense','income'],'expense'),amount:number(input.amount??0,0.01),date:text(input.date,10),budgetCategory:choice(input.budgetCategory,['Verktyg','Assets','Ljud','Marknadsföring','Hosting','Övrigt'],'Övrigt')});if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date))throw new Error('Välj datum.');break;
 case 'content':Object.assign(d,{status:choice(input.status,['idea','script','record','edit','published'],'idea'),platform:choice(input.platform,['TikTok','Instagram','YouTube','Steam','Övrigt'],'TikTok'),hook:text(input.hook),script:text(input.script),url:safeUrl(input.url),views:number(input.views??0),likes:number(input.likes??0)});break;
 case 'analysis':{
 const metric=value=>value===''||value==null?null:number(value,0,1e15);
 const periodStart=text(input.periodStart,10),periodEnd=text(input.periodEnd,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)||!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)||periodEnd<periodStart)throw new Error('Välj en giltig statistikperiod.');
 Object.assign(d,{periodStart,periodEnd,platform:choice(input.platform,platforms,platformOf({title:d.title,dataSource:input.dataSource})),account:text(input.account,100),profileUrl:safeUrl(input.profileUrl),conclusion:text(input.conclusion),next:text(input.next),evidence:text(input.evidence),views:metric(input.views),likes:metric(input.likes),comments:metric(input.comments),shares:metric(input.shares),followers:metric(input.followers),newFollowers:input.newFollowers===''||input.newFollowers==null?null:number(input.newFollowers,-1e12),orders:metric(input.orders),revenue:metric(input.revenue),currency:choice(input.currency,['SEK','USD','EUR'],'SEK'),orderSource:text(input.orderSource,200),dataSource:text(input.dataSource,200),takenOn:text(input.takenOn,30)||new Date().toISOString(),analyst:text(input.analyst,80)||'Codex',topVideos:Array.isArray(input.topVideos)?input.topVideos.slice(0,30).map(v=>({title:text(v.title),url:safeUrl(v.url),views:metric(v.views),likes:metric(v.likes)})):[]});break;
 }
 case 'settings':Object.assign(d,{monthlyBudget:number(input.monthlyBudget??0)});break;
 }
 if(d.due&&!/^\d{4}-\d{2}-\d{2}$/.test(d.due))throw new Error('Ogiltigt måldatum.');
 return d;
}
export function summarize(records,now=new Date()){
 const rows=records.filter(r=>!r.archived),of=k=>rows.filter(r=>r.kind===k),feedback=of('feedback'),goals=of('goal'),tests=of('playtest').filter(r=>r.data.result!=='planned'&&r.data.result!=='blocked');
 const month=now.toISOString().slice(0,7),costs=of('budget').filter(r=>r.data.date?.startsWith(month));
 const expense=costs.filter(r=>r.data.type==='expense').reduce((n,r)=>n+r.data.amount,0),income=costs.filter(r=>r.data.type==='income').reduce((n,r)=>n+r.data.amount,0);
 const resolved=feedback.filter(r=>r.data.status==='fixed').length,totalAttempts=tests.reduce((n,r)=>n+r.data.attempts,0),successes=tests.reduce((n,r)=>n+r.data.successes,0);
 return {open:feedback.length-resolved,resolved,totalFeedback:feedback.length,critical:feedback.filter(r=>r.data.priority==='critical'&&r.data.status!=='fixed').length,videos:of('video').length,pendingVideos:of('video').filter(r=>r.data.status!=='done').length,goals:goals.length,goalsDone:goals.filter(r=>r.data.status==='done'||r.data.current>=r.data.target).length,expense,income,net:income-expense,totalAttempts,successes,testRate:totalAttempts?Math.round(successes/totalAttempts*100):null,categoryCounts:categories.map(category=>({category,count:feedback.filter(r=>r.data.category===category&&r.data.status!=='fixed').length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count)};
}
