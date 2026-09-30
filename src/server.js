import {api} from './api.js';
import html from './index.html';
import css from './style.css';
import client from './client.js?text';
import model from './model.js?text';
import icon from './favicon.svg';
const assets={'/':[html,'text/html'],'/index.html':[html,'text/html'],'/style.css':[css,'text/css'],'/client.js':[client,'text/javascript'],'/model.js':[model,'text/javascript'],'/favicon.svg':[icon,'image/svg+xml']};
export default{async fetch(request,env){
 let response;const path=new URL(request.url).pathname;
 if(path.startsWith('/api/'))response=await api(request,env);
 else if(assets[path]&&['GET','HEAD'].includes(request.method)){const [body,type]=assets[path];response=new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'}});}
 else response=new Response('Not found',{status:404});
 const r=new Response(response.body,response);r.headers.set('X-Content-Type-Options','nosniff');r.headers.set('Referrer-Policy','strict-origin-when-cross-origin');r.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob:; media-src 'self' blob: https: http:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://*.chatgpt.com https://chatgpt.com");return r;
}};
