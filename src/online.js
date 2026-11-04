// Players, access codes and store sales from Shredbound's Supabase edge functions.
// The anon key in config.js is public by design. The admin secret is typed into the
// ADMIN field, kept only in this browser's localStorage, and sent only as the
// x-admin-secret header to the two functions below.
import {supabaseUrl,supabaseAnonKey} from './config.js';
const secretKey='shredbound.adminSecret';
export const functionUrl=name=>supabaseUrl.replace(/\/$/,'')+'/functions/v1/'+name;
export function adminSecret(){try{return localStorage.getItem(secretKey)||'';}catch{return '';}}
export function setAdminSecret(value){try{if(value)localStorage.setItem(secretKey,value);else localStorage.removeItem(secretKey);}catch{}}
export const isAdminAction=action=>/^admin\./.test(action);
export function requestInit(action,payload={},secret=''){
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+supabaseAnonKey,apikey:supabaseAnonKey};
 if(isAdminAction(action)){if(!secret)throw Error('Admin-nyckel saknas.');headers['x-admin-secret']=secret;}
 return {method:'POST',headers,body:JSON.stringify({...payload,action})};
}
// The access function answers with short error codes; show them in Swedish.
const errorText={unauthorized:'Fel admin-nyckel.',limited:'För många försök. Vänta en stund och försök igen.',exists:'Koden finns redan. Välj en annan.',bad_code:'Egen kod: 4–40 tecken, bara bokstäver, siffror, - och _.',bad_request:'Ogiltiga uppgifter.',not_found:'Finns inte längre. Uppdatera sidan.',not_revoked:'Återkalla koden först.',server:'Serverfel. Försök igen.'};
export class FunctionError extends Error{constructor(message,status){super(message);this.status=status;}}
export async function call(name,action,payload={},secret=adminSecret(),fetcher=fetch){
 let res;try{res=await fetcher(functionUrl(name),requestInit(action,payload,secret));}catch{throw new FunctionError('Funktionen svarar inte. Den är kanske inte publicerad ännu, eller så saknas anslutning.',0);}
 let body=null;try{body=await res.json();}catch{}
 if(!res.ok||body?.ok===false){const status=res.ok?400:res.status,code=body?.error;const msg=errorText[code]||(status===401||status===403?'Fel admin-nyckel.':status===404?'Funktionen är inte publicerad ännu.':status===429?errorText.limited:typeof code==='string'&&!/^[a-z_]+$/.test(code)?code:'Kunde inte hämta data.');throw new FunctionError(msg,status);}
 return body||{};
}
const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const pick=(o,...keys)=>{for(const k of keys)if(o?.[k]!=null)return o[k];return null;};
// Play time arrives as seconds; a public total may arrive as hours.
function seconds(o){const s=num(pick(o,'playSeconds','seconds','play_seconds'));if(s!=null)return s;const hours=num(pick(o,'playHours','hours','play_hours'));return hours==null?null:hours*3600;}
export function normalizeTotals(input){const t=input?.totals||input||{};return {devices:num(pick(t,'devices','deviceCount')),playSeconds:seconds(t),activeToday:num(pick(t,'activeToday','active_today','active1d')),active7d:num(pick(t,'active7d','active_7d','activeWeek','active7'))};}
export function normalizeCode(c){return {id:String(pick(c,'id')??''),name:String(pick(c,'name','label')??''),created:pick(c,'created','createdAt','created_at'),expires:pick(c,'expires','expiresAt','expires_at'),days:num(pick(c,'days','daysPerDevice','days_per_device')),revoked:!!pick(c,'revoked','revokedAt','revoked_at'),devices:num(pick(c,'devices','deviceCount')),playSeconds:seconds(c),lastSeen:pick(c,'lastSeen','last_seen')};}
export function normalizeDevice(d){return {id:String(pick(d,'device','id','deviceId','device_id')??''),code:String(pick(d,'codeName','code_name','name','codeId','code_id')??''),firstSeen:pick(d,'firstSeen','first_seen','created','createdAt'),lastSeen:pick(d,'lastSeen','last_seen'),expires:pick(d,'accessEndsAt','expires','expiresAt','expires_at'),playSeconds:seconds(d),banned:!!pick(d,'banned','bannedAt','banned_at'),platform:String(pick(d,'platform')??''),version:String(pick(d,'version')??'')};}
export function normalizeAdmin(body){return {totals:normalizeTotals(body),codes:(Array.isArray(body?.codes)?body.codes:[]).map(normalizeCode),devices:(Array.isArray(body?.devices)?body.devices:[]).map(normalizeDevice),daily:(Array.isArray(body?.daily)?body.daily:[]).map(r=>({day:String(pick(r,'day','date')??'').slice(0,10),devices:num(pick(r,'devices')),seconds:seconds(r)})).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.day)).sort((a,b)=>a.day.localeCompare(b.day))};}
export const createdCode=body=>typeof body?.code==='string'?body.code:body?.code?.code||body?.created?.code||'';
export function normalizeStore(body){const games=(Array.isArray(body?.games)?body.games:[]).map(g=>({id:String(g.id??''),title:String(g.title||'Spel'),url:String(g.url||''),downloads:num(g.downloads),views:num(g.views),purchases:num(g.purchases),earnings:Array.isArray(g.earnings)?g.earnings.map(e=>({currency:String(e.currency||''),amount:num(e.amount)})).filter(e=>e.currency&&e.amount!=null):null}));const sum=key=>games.length&&games.every(g=>g[key]!=null)?games.reduce((n,g)=>n+g[key],0):null;const earnings={};let earningsKnown=games.length>0;for(const g of games){if(!g.earnings){earningsKnown=false;continue;}for(const e of g.earnings)earnings[e.currency]=(earnings[e.currency]||0)+e.amount;}return {connected:!!body?.connected,updatedAt:body?.updatedAt||null,error:body?.error||null,games,totals:{downloads:sum('downloads'),views:sum('views'),purchases:sum('purchases')},earnings:earningsKnown?Object.entries(earnings).map(([currency,amount])=>({currency,amount})):null};}
// itch.io reports earnings in cents.
export const formatEarning=e=>new Intl.NumberFormat('sv-SE',{style:'currency',currency:e.currency,maximumFractionDigits:2}).format(e.amount/100);
export const hours=s=>s==null?null:s/3600;
// Last `days` calendar days ending today; days without a row are zero play time.
export function fillDays(rows,days=60,today=new Date()){const by=new Map(rows.map(r=>[r.day,r])),out=[];for(let i=days-1;i>=0;i--){const d=new Date(today.getFullYear(),today.getMonth(),today.getDate()-i),key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,r=by.get(key);out.push({day:key,seconds:r?.seconds??0,devices:r?.devices??0});}return out;}
export function niceMax(v){if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v)),n=v/p;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p;}
// One series (play hours per day): thin columns with 4px rounded tops, square at the
// baseline, hairline grid, one invisible full-height hit target per day for the hover.
export function dailyChart(rows,{width=960,height=220}={}){
 const pad={l:46,r:8,t:12,b:26},w=width-pad.l-pad.r,ht=height-pad.t-pad.b,values=rows.map(r=>r.seconds/3600),max=niceMax(Math.max(...values,0)),slot=w/Math.max(rows.length,1),bar=Math.max(2,Math.min(24,slot-2)),y=v=>pad.t+ht-v/max*ht,fmt=v=>v>=10||v===0?String(Math.round(v)):v.toFixed(1).replace('.',',');
 const tick=v=>String(Math.round(v*100)/100).replace('.',','),ticks=[0,max/2,max].map(v=>`<line x1="${pad.l}" x2="${width-pad.r}" y1="${y(v)}" y2="${y(v)}" class="chart-grid"/><text x="${pad.l-8}" y="${y(v)+4}" text-anchor="end" class="chart-axis">${tick(v)} h</text>`).join('');
 const cols=rows.map((r,i)=>{const v=values[i],x=pad.l+i*slot+(slot-bar)/2,top=y(v),hgt=pad.t+ht-top,rad=Math.min(4,bar/2,hgt),label=`${r.day}: ${fmt(v)} h, ${r.devices} enheter`;const path=hgt>0.5?`<path class="chart-bar" d="M${x} ${pad.t+ht}V${top+rad}Q${x} ${top} ${x+rad} ${top}H${x+bar-rad}Q${x+bar} ${top} ${x+bar} ${top+rad}V${pad.t+ht}Z"/>`:'';return `<g class="chart-col" data-day="${r.day}" data-hours="${fmt(v)}" data-devices="${r.devices}"><rect class="chart-hit" x="${pad.l+i*slot}" y="${pad.t}" width="${slot}" height="${ht}"><title>${label}</title></rect>${path}</g>`;}).join('');
 const labels=rows.map((r,i)=>i%10===0||i===rows.length-1?`<text x="${pad.l+i*slot+slot/2}" y="${height-6}" text-anchor="middle" class="chart-axis">${Number(r.day.slice(8))}/${Number(r.day.slice(5,7))}</text>`:'').join('');
 return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Speltid per dag, ${rows.length} dagar">${ticks}${cols}<line x1="${pad.l}" x2="${width-pad.r}" y1="${pad.t+ht}" y2="${pad.t+ht}" class="chart-base"/>${labels}</svg>`;
}
