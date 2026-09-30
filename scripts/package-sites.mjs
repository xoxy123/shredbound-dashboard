import {access,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
// Sites migrations must travel under dist/.openai; root .openai is source metadata.
for(const file of ['dist/server/index.js','dist/.openai/hosting.json','dist/.openai/drizzle/meta/_journal.json'])await access(file);
const archive=path.resolve(process.argv[2]||'artifacts/shredbound-dashboard.tar.gz');
await mkdir(path.dirname(archive),{recursive:true});
const result=spawnSync('tar',['-czf',archive,'dist'],{stdio:'inherit'});
if(result.status!==0)throw Error('Could not package Site');
console.log(archive);
