import {normalizeExcludePath,shouldIgnoreDirectory,filterAnalyzableLocalFiles,getArchiveRootPrefix} from './exclusions.mjs';
import {isOversized} from './size-policy.mjs';

function descriptor(path,size,read){
    path=normalizeExcludePath(path);
    return {path,name:path.split('/').pop(),folder:path.includes('/')?path.slice(0,path.lastIndexOf('/')):'root',size:size||0,read};
}
function include(file,patterns){return filterAnalyzableLocalFiles([file],patterns).length>0;}

export async function collectDirectory(handle,{patterns=[],signal,progress=()=>{}}={}){
    const files=[];
    async function walk(directory,prefix){
        signal?.throwIfAborted();
        for await(const entry of directory.values()){
            signal?.throwIfAborted();
            const path=prefix?prefix+'/'+entry.name:entry.name;
            if(entry.kind==='directory'){
                if(!shouldIgnoreDirectory(path,entry.name,patterns))await walk(entry,path);
            }else if(entry.kind==='file'){
                const file=descriptor(path,0,async()=>{
                    const source=await entry.getFile();
                    signal?.throwIfAborted();
                    file.size=source.size;
                    return isOversized(file.size)?'':source.text();
                });
                if(include(file,patterns))files.push(file);
            }
            if(files.length&&files.length%50===0)progress('Scanning files... '+files.length+' found');
        }
    }
    await walk(handle,'');signal?.throwIfAborted();
    return {files,rootPrefix:''};
}

function collectEntries(entries,options,make){
    const {patterns=[],signal,progress=()=>{}}=options;
    signal?.throwIfAborted();
    const rootPrefix=getArchiveRootPrefix(entries.map(entry=>entry.path));
    const files=[],entriesByPath=Object.create(null);
    for(const entry of entries){
        signal?.throwIfAborted();
        const raw=normalizeExcludePath(entry.path);
        const path=rootPrefix&&raw.startsWith(rootPrefix)?raw.slice(rootPrefix.length):raw;
        const file=make(entry.value,path);
        if(!include(file,patterns))continue;
        files.push(file);entriesByPath[file.path]=entry.value;
        if(files.length%50===0)progress('Scanning files... '+files.length+' found');
    }
    return {files,rootPrefix,entriesByPath};
}
export async function collectSelectedFiles(fileObjs,options={}){
    const {files,rootPrefix}=collectEntries(Array.from(fileObjs,file=>({path:file.webkitRelativePath||file.name,value:file})),options,
        (file,path)=>descriptor(path,file.size,()=>file.text()));
    return {files,rootPrefix};
}
export async function collectArchive(zip,options={}){
    const entries=Object.keys(zip.files).sort().map(key=>zip.files[key]).filter(entry=>entry&&!entry.dir);
    return collectEntries(entries.map(entry=>({path:entry.name,value:entry})),options,
        (entry,path)=>descriptor(path,entry._data?.uncompressedSize,()=>entry.async('string')));
}
export async function readCollectedFiles(files,{signal,progress=()=>{},yieldFn=()=>Promise.resolve()}={}){
    const records=[];
    for(let i=0;i<files.length;i++){
        signal?.throwIfAborted();
        if(i&&i%50===0){await yieldFn();signal?.throwIfAborted();}
        const file=files[i];
        progress('Reading '+(i+1)+'/'+files.length+': '+file.name);
        const record={path:file.path,name:file.name,folder:file.folder,size:file.size};
        try{
            const result=isOversized(file.size)?'':await file.read();
            signal?.throwIfAborted();
            const content=typeof result==='string'?result:result?.content;
            if(typeof content!=='string')throw new Error('Source read did not return text');
            record.size=result&&typeof result==='object'&&result.size!==undefined?result.size:file.size;
            if(result&&typeof result==='object'&&result.churn!==undefined)record.churn=result.churn;
            if(isOversized(record.size)||isOversized(content.length))record.analysisSkipped='oversized';
            else record.content=content;
        }catch(error){
            if(signal?.aborted||error?.name==='AbortError')throw error;
            record.analysisSkipped='fetch-failed';
        }
        records.push(record);
    }
    signal?.throwIfAborted();return records;
}
