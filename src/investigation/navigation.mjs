import { fileHasLoadedSource, pathIsFlagged } from '../project/source.mjs';

export function searchProject(data,query){
    var normalize=function(value){return String(value||'').toLowerCase().replace(/[._/\\-]+/g,' ');};
    var terms=normalize(query).trim().split(/\s+/).filter(Boolean);
    if(!terms.length)return[];
    var results=[];
    function add(item,text){
        var haystack=normalize(text);
        if(!terms.every(function(term){return haystack.includes(term);}))return;
        var title=normalize(item.label),needle=terms.join(' ');
        item.rank=title===needle?0:title.startsWith(needle)?1:2;
        results.push(item);
    }
    (data.files||[]).forEach(function(file){
        add({kind:'file',path:file.path,label:file.name,line:1},file.path);
        (file.functions||[]).forEach(function(fn){add({kind:'symbol',path:file.path,label:fn.name,line:fn.line||1},fn.name+' '+file.path);});
        (file.elixir&&file.elixir.modules||[]).forEach(function(module){
            var name=typeof module==='string'?module:module.name;
            add({kind:'module',path:file.path,label:name,line:module.line||1},name);
        });
    });
    return results.sort(function(a,b){return a.rank-b.rank||(a.kind==='file'?-1:1)-(b.kind==='file'?-1:1)||a.label.localeCompare(b.label)||a.path.localeCompare(b.path);});
}

export function navigationWithCamera(history,camera){
    if(history.index<0||!camera)return history;
    var entries=history.entries.slice();
    entries[history.index]=Object.assign({},entries[history.index],{camera:camera});
    return {entries:entries,index:history.index};
}

export function recordNavigation(history,location,camera){
    var entries=navigationWithCamera(history,camera).entries.slice(0,history.index+1),previous=entries[entries.length-1];
    if(previous&&previous.path===location.path&&previous.scope===location.scope&&previous.view===location.view&&JSON.stringify(previous.range||null)===JSON.stringify(location.range||null)){
        entries[entries.length-1]=location;
    }else entries.push(location);
    return {entries:entries,index:entries.length-1};
}

export function stepNavigation(history,delta,camera){
    var index=history.index+delta;
    if(index<0||index>=history.entries.length)return null;
    return {entries:navigationWithCamera(history,camera).entries,index:index};
}

export function getConnectedFilePaths(path,connections){
    var linked=new Set();
    (connections||[]).forEach(function(c){
        var src=typeof c.source==='object'?c.source.id:c.source;
        var tgt=typeof c.target==='object'?c.target.id:c.target;
        if(src===path&&tgt)linked.add(tgt);
        if(tgt===path&&src)linked.add(src);
    });
    return Array.from(linked);
}

export var CODE_CARD_MAX=12;

export function defaultCodeViewSeed(data,folderFilter){
    if(!data||!data.files||!data.files.length)return null;
    var filtered=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
    if(!filtered.length)return null;
    var byPath=Object.create(null);
    filtered.forEach(function(f){byPath[f.path]=f;});
    var counts=Object.create(null);
    (data.connections||[]).forEach(function(c){
        var src=typeof c.source==='object'?c.source.id:c.source;
        var tgt=typeof c.target==='object'?c.target.id:c.target;
        if(byPath[src])counts[src]=(counts[src]||0)+1;
        if(byPath[tgt])counts[tgt]=(counts[tgt]||0)+1;
    });
    var best=filtered[0];
    var bestN=counts[best.path]||0;
    filtered.forEach(function(file){
        var n=counts[file.path]||0;
        if(n>bestN){best=file;bestN=n;}
    });
    return best.path;
}

export function fileMatchesFolderFilter(file,folderFilter){
    if(!folderFilter)return true;
    if(!file)return false;
    return file.folder===folderFilter||(!!file.folder&&file.folder.startsWith(folderFilter+'/'));
}

export function pathMatchesFolderFilter(path,data,folderFilter){
    if(!folderFilter)return true;
    if(!data||!data.files||!path)return false;
    for(var i=0;i<data.files.length;i++){
        if(data.files[i].path===path)return fileMatchesFolderFilter(data.files[i],folderFilter);
    }
    return false;
}

export function folderFilterAfterCodeNav(path,data,folderFilter){
    if(pathMatchesFolderFilter(path,data,folderFilter))return folderFilter||null;
    return null;
}

export function codeViewSeedPath(selectedPath,data,folderFilter){
    if(!data||!data.files||!data.files.length)return null;
    if(selectedPath){
        var selected=null;
        for(var i=0;i<data.files.length;i++){
            if(data.files[i].path===selectedPath){selected=data.files[i];break;}
        }
        if(selected&&fileMatchesFolderFilter(selected,folderFilter))return selectedPath;
    }
    return defaultCodeViewSeed(data,folderFilter);
}

export function collectVisibleCodeFiles(selectedPath,data,folderFilter,limit){
    if(!data||!data.files)return[];
    var filtered=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
    var byPath=Object.create(null);
    filtered.forEach(function(f){byPath[f.path]=f;});
    var ordered=[];
    function add(path){
        var file=byPath[path];
        if(!file||ordered.some(function(f){return f.path===path;}))return;
        ordered.push(file);
    }
    if(!selectedPath||!byPath[selectedPath])selectedPath=defaultCodeViewSeed(data,folderFilter);
    if(selectedPath)add(selectedPath);
    getConnectedFilePaths(selectedPath,data.connections).slice().sort(function(a,b){
        var loadedA=fileHasLoadedSource(byPath[a])?0:1;
        var loadedB=fileHasLoadedSource(byPath[b])?0:1;
        return loadedA-loadedB;
    }).forEach(add);
    var max=limit==null?CODE_CARD_MAX:Number(limit);
    if(!isFinite(max))return ordered;
    return ordered.slice(0,Math.max(0,max));
}

export function countVisibleCodeFiles(selectedPath,data,folderFilter){
    return collectVisibleCodeFiles(selectedPath,data,folderFilter,Infinity).length;
}

export function hiddenOpenedCodePaths(paths,data,folderFilter){
    var hidden=Object.create(null);
    if(!folderFilter)return hidden;
    var visible=Object.create(null);
    filesForOpenedCodePaths(paths,data,folderFilter).forEach(function(file){
        if(file&&file.path)visible[file.path]=true;
    });
    (paths||[]).forEach(function(path){
        if(path&&!visible[path])hidden[path]=true;
    });
    return hidden;
}

export function codeCardPlacementKeepSet(openedPaths,visibleFiles){
    var keep=Object.create(null);
    (openedPaths||[]).forEach(function(path){if(path)keep[path]=true;});
    (visibleFiles||[]).forEach(function(file){if(file&&file.path)keep[file.path]=true;});
    return keep;
}

export function pruneCodeCardPlacements(placements,keep){
    var departed=Object.create(null);
    Object.keys(placements||{}).forEach(function(path){
        if(keep&&keep[path])return;
        departed[path]=true;
        delete placements[path];
    });
    return departed;
}

export function evictHiddenCodeCards(list,hidden,count){
    var need=Number(count);
    if(!isFinite(need)||need<=0)return (list||[]).slice();
    var removed=0;
    return (list||[]).filter(function(path){
        if(removed>=need)return true;
        if(pathIsFlagged(hidden,path)){
            removed++;
            return false;
        }
        return true;
    });
}

export function openCodeCardPaths(prev,path,limit,replace,hidden){
    var list=(prev||[]).slice();
    if(!path)return list;
    if(list.indexOf(path)>=0)return list;
    var max=limit==null?CODE_CARD_MAX:Number(limit);
    if(isFinite(max)&&list.length>=max){
        var need=list.length-max+1;
        if(hidden)list=evictHiddenCodeCards(list,hidden,need);
        if(list.length>=max){
            if(!replace)return list;
            list=list.slice(Math.max(0,list.length-max+1));
        }
    }
    list.push(path);
    return list;
}

export function resolveOpenCodeCard(prev,path,limit,replace,hidden){
    var before=prev||[];
    var next=openCodeCardPaths(before,path,limit,replace,hidden);
    var already=!!(path&&before.indexOf(path)>=0);
    var inserted=!!(path&&!already&&next.indexOf(path)>=0);
    return{paths:next,already:already,inserted:inserted,opened:already||inserted};
}

export function ensureCodeViewOpenedPaths(openedPaths,selectedPath,data,folderFilter){
    var seed=codeViewSeedPath(selectedPath,data,folderFilter);
    if(!seed)return{paths:openedPaths||[],seed:null,opened:false,inserted:false};
    var resolved=resolveOpenCodeCard(openedPaths,seed,Infinity,false,hiddenOpenedCodePaths(openedPaths,data,folderFilter));
    return{paths:resolved.paths,seed:seed,opened:resolved.opened,inserted:resolved.inserted};
}

export function filesForOpenedCodePaths(paths,data,folderFilter){
    if(!data||!data.files)return[];
    var filtered=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
    var byPath=Object.create(null);
    filtered.forEach(function(file){byPath[file.path]=file;});
    return(paths||[]).map(function(path){return byPath[path];}).filter(Boolean);
}
