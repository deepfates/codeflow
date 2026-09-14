import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const options={absWorkingDir:root,bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',loader:{'.wasm':'binary'},external:['fs','path'],legalComments:'inline',logLevel:'warning'};
const worker=await build({...options,entryPoints:['src/worker/analysis-worker.mjs']});
const workerSource=worker.outputFiles[0].text;
const browser=await build({...options,entryPoints:['src/browser/app.mjs'],plugins:[{
    name:'analysis-worker',setup(builder){
        builder.onResolve({filter:/^codeflow:analysis-worker$/},()=>({path:'worker',namespace:'codeflow'}));
        builder.onLoad({filter:/.*/,namespace:'codeflow'},()=>({contents:JSON.stringify(workerSource),loader:'json'}));
    }
}]});
const nodeBabel=await build({absWorkingDir:root,entryPoints:['src/node/babel.mjs'],bundle:true,write:false,platform:'node',format:'cjs',target:'node18',legalComments:'inline',logLevel:'warning'});
// Checked-in artifacts preserve Codeflow's no-build, offline HTML entry point.
// --check proves a cold checkout matches the canonical modules without editing it.
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
for(const [name,content] of [['analysis-worker.js',workerSource],['app.js',browser.outputFiles[0].text],['node-babel.cjs',nodeBabel.outputFiles[0].text]]){
    const path=new URL('../dist/'+name,import.meta.url);
    if(process.argv.includes('--check')){
        if(await readFile(path,'utf8')!==content)throw new Error(name+' is stale; run npm run build');
    }else await writeFile(path,content);
}
