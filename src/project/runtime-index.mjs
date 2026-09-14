// Runtime observations remain separate from source analysis. Only exact source
// paths in the current project establish a process-to-source relationship.
export function indexRuntime(snapshot, files=[]){
    const processesById=new Map(),processesBySource=new Map();
    if(snapshot?.status!=='ready')return {processesById,processesBySource,applications:[],roots:[]};
    const paths=new Set(files.map(file=>file.path));
    const processes=snapshot.processes||[];
    for(const process of processes){
        processesById.set(process.id,process);
        if(!process.sourcePath||!paths.has(process.sourcePath))continue;
        if(!processesBySource.has(process.sourcePath))processesBySource.set(process.sourcePath,[]);
        processesBySource.get(process.sourcePath).push(process);
    }
    const local=application=>{
        const process=processesById.get(application.rootId);
        return process&&paths.has(process.sourcePath)?1:0;
    };
    const applications=(snapshot.applications||[]).slice().sort((a,b)=>local(b)-local(a)||a.name.localeCompare(b.name));
    return {processesById,processesBySource,applications,roots:processes.filter(process=>!process.parentId&&!process.application)};
}

export function runtimeAncestors(index,id){
    const ancestors=new Set();
    while(id&&!ancestors.has(id)){
        const process=index.processesById.get(id);
        if(!process)break;
        ancestors.add(id);
        id=process.parentId;
    }
    return ancestors;
}
