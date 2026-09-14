import { hydrationRequestIsCurrent, hydratedSourceIsCurrent } from './identity.mjs';

export function asCodeLines(lines){
    if(Array.isArray(lines))return lines.length?lines:[''];
    return[String(lines||'')];
}

export function pathIsFlagged(map,path){
    if(!path||!map)return false;
    if(typeof map.has==='function')return map.has(path);
    return !!map[path];
}

export function nextCodeSourceReads(neededPaths,inFlight,failed){
    inFlight=inFlight||Object.create(null);
    return(neededPaths||[]).filter(function(path){
        return !!path&&!inFlight[path]&&!pathIsFlagged(failed,path);
    });
}

export function fileHasLoadedSource(file){
    return !!(file&&Object.prototype.hasOwnProperty.call(file,'content')&&typeof file.content==='string');
}

export function fileHasPersistedSource(file){
    return fileHasLoadedSource(file);
}

export function analysisFileNeedsSource(file){
    return !!(file&&!file.analysisSkipped&&!fileHasLoadedSource(file));
}

export function recordCodeSourceFailure(prev,path){
    var next=Object.assign(Object.create(null),prev||{});
    if(path)next[path]=true;
    return next;
}

export function clearCodeSourceFailure(prev,path){
    var next=Object.assign(Object.create(null),prev||{});
    if(path)delete next[path];
    return next;
}

export function recordCodeSourceFailureIfCurrent(prev,path,hydrationId,currentId){
    if(!hydrationRequestIsCurrent(hydrationId,currentId))return prev||Object.create(null);
    return recordCodeSourceFailure(prev,path);
}

export function clearCodeSourceFailureIfCurrent(prev,path,hydrationId,currentId){
    if(!hydrationRequestIsCurrent(hydrationId,currentId))return prev||Object.create(null);
    return clearCodeSourceFailure(prev,path);
}

export function fileSourceDisplayState(file,canFetch,failed){
    if(!file)return 'empty';
    if(file.analysisSkipped)return 'skipped';
    if(fileHasLoadedSource(file))return 'ready';
    if(canFetch&&pathIsFlagged(failed,file.path))return 'failed';
    return canFetch?'loading':'unavailable';
}

export function filesNeedingSource(files){
    return (files||[]).filter(analysisFileNeedsSource);
}

export function mergeHydratedFileSources(data,updates,currentId){
    if(!data||!data.files||!updates||!updates.length)return data;
    var byPath=Object.create(null);
    updates.forEach(function(update){
        if(!hydratedSourceIsCurrent(update,currentId))return;
        byPath[update.path]=update.content;
    });
    var changed=false;
    var files=data.files.map(function(file){
        if(byPath[file.path]==null||fileHasLoadedSource(file))return file;
        changed=true;
        return Object.assign({},file,{content:byPath[file.path]});
    });
    return changed?Object.assign({},data,{files:files}):data;
}
