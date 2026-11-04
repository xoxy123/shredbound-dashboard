import {api} from './api.js';
import {allowedOrigin} from './access.js';
import config from './config.js?text';
import html from './index.html';
import css from './style.css';
import client from './client.js?text';
import model from './model.js?text';
import online from './online.js?text';
import icon from './favicon.svg';
const assets={'/':[html,'text/html'],'/index.html':[html,'text/html'],'/style.css':[css,'text/css'],'/client.js':[client,'text/javascript'],'/model.js':[model,'text/javascript'],'/online.js':[online,'text/javascript'],'/favicon.svg':[icon,'image/svg+xml'],'/config.js':[config,'text/javascript']};
export default{async fetch(request,env){
 let response;const path=new URL(request.url).pathname,origin=request.headers.get('Origin'),cors=allowedOrigin(origin);
 if(path.startsWith('/api/')){if(request.method==='OPTIONS')response=new Response(null,{status:cors?204:403});else response=await api(request,env);}
 else if(assets[path]&&['GET','HEAD'].includes(request.method)){const [body,type]=assets[path];response=new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'}});}
 else response=new Response('Not found',{status:404});
 const r=new Response(response.body,response);if(path.startsWith('/api/')){r.headers.set('Vary','Origin');if(cors){r.headers.set('Access-Control-Allow-Origin',origin);r.headers.set('Access-Control-Allow-Methods','GET, HEAD, POST, PATCH, OPTIONS');r.headers.set('Access-Control-Allow-Headers','Content-Type, X-Filename, Range');r.headers.set('Access-Control-Expose-Headers','Content-Range, Content-Length, Content-Disposition');r.headers.set('Access-Control-Max-Age','600');}}r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Referrer-Policy','strict-origin-when-cross-origin');r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob:; media-src 'self' blob: https: http:; connect-src 'self' https://yptfcpxaihfboteltuhq.supabase.co; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://*.chatgpt.com https://chatgpt.com");return r;
}};
