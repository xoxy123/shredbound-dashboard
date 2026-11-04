import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,cp,rm} from 'node:fs/promises';
import path from 'node:path';
await mkdir('dist/server',{recursive:true});
await build({entryPoints:['src/client.js','src/online.js'],bundle:false,write:false,platform:'browser',target:'es2022',outdir:'dist/check'});
await build({entryPoints:['src/server.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js',loader:{'.html':'text','.css':'text','.svg':'text'},minify:true,plugins:[{name:'raw-js',setup(b){b.onResolve({filter:/\?text$/},a=>({path:path.resolve(a.resolveDir,a.path.slice(0,-5)),namespace:'raw'}));b.onLoad({filter:/.*/,namespace:'raw'},async a=>({contents:await readFile(a.path,'utf8'),loader:'text'}));}}]});
await mkdir('dist/migrations',{recursive:true});
await copyFile('migrations/0001_dashboard.sql','dist/migrations/0001_dashboard.sql');
await rm('dist/.openai',{recursive:true,force:true});
await mkdir('dist/.openai',{recursive:true});
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await cp('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Built Shredbound Worker and migrations.');

// GitHub Pages contains only browser assets; no source metadata, credentials, or data.
await rm('dist/pages',{recursive:true,force:true});
await mkdir('dist/pages',{recursive:true});
for(const name of ['index.html','style.css','client.js','model.js','online.js','favicon.svg'])await copyFile('src/'+name,'dist/pages/'+name);
const config=await readFile('src/config.js','utf8');
if(!/^export const apiBase = '';$/m.test(config))throw Error('src/config.js must keep the same-origin apiBase line');
await writeFile('dist/pages/config.js',config.replace(/^export const apiBase = '';$/m,"export const apiBase = 'https://shredbound-dashboard.gabriel-erikss137086.chatgpt.site';"));
await writeFile('dist/pages/.nojekyll','');
console.log('Built GitHub Pages assets.');
