
export function newLocalSelectionId(){
    return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
}

export function localFolderCacheMeta(options){
    options=options||{};
    var title=String(options.title||'').trim();
    var paths=(options.paths||[]).map(function(p){return String(p||'').replace(/\\/g,'/');}).filter(Boolean).slice().sort();
    if(!title){
        var raw=String(options.rootPrefix||'').replace(/\\/g,'/');
        title=(raw.split('/').filter(Boolean)[0]||'').trim();
    }
    if(!title)title='Local Folder';
    var selectionId=String(options.selectionId||'').trim()||newLocalSelectionId();
    return{sourceKey:title+'|sel:'+selectionId,title:title,selectionId:selectionId};
}

export function cliWatchCacheMeta(status){
    status=status||{};
    var root=String(status.root||'').replace(/\\/g,'/');
    var title=String(status.name||'').trim();
    if(!title&&root)title=(root.split('/').filter(Boolean).pop()||'').trim();
    if(!title)title='Local watch';
    return{sourceKey:root||'cli',title:title};
}

export function zipArchiveCacheMeta(options){
    options=options||{};
    var title=String(options.name||options.title||'').trim()||'ZIP Archive';
    var size=Number(options.size);
    if(!isFinite(size)||size<0)size=0;
    var modified=Number(options.lastModified);
    if(!isFinite(modified)||modified<0)modified=0;
    var paths=(options.paths||[]).map(function(p){return String(p||'').replace(/\\/g,'/');}).filter(Boolean).slice().sort();
    return{sourceKey:title+'|'+size+'|'+modified+'|'+paths.length+'|'+paths.slice(0,12).join('|'),title:title};
}

export function retainedFolderMatchesRecord(record,retained){
    if(!record||!record.sourceKey)return true;
    retained=retained||{};
    return String(retained.sourceKey||'')===String(record.sourceKey);
}

export function normalizeCliRoot(root){
    return String(root||'').replace(/\\/g,'/').replace(/\/+$/,'');
}

export function cliRecordMatchesStatus(record,status){
    if(!record||!record.sourceKey)return true;
    if(!status||!status.ok)return false;
    return normalizeCliRoot(status.root)===normalizeCliRoot(record.sourceKey);
}

export function zipFileIdentity(zipFile){
    if(!zipFile)return'';
    var title=String(zipFile.name||'').trim()||'ZIP Archive';
    var size=Number(zipFile.size);
    if(!isFinite(size)||size<0)size=0;
    var modified=Number(zipFile.lastModified);
    if(!isFinite(modified)||modified<0)modified=0;
    return title+'|'+size+'|'+modified;
}

export function retainedZipMatchesRecord(record,retained){
    if(!record||!record.sourceKey)return true;
    retained=retained||{};
    if(retained.sourceKey&&String(retained.sourceKey)===String(record.sourceKey))return true;
    var identity=String(retained.identity||'');
    return!!identity&&String(record.sourceKey).indexOf(identity+'|')===0;
}

export function normalizeExcludeKey(patterns){
    var list=[];
    (patterns||[]).forEach(function(p){
        var raw=typeof p==='string'?p:(p&&p.raw);
        raw=String(raw||'').trim();
        if(raw&&list.indexOf(raw)<0)list.push(raw);
    });
    list.sort();
    return list.join('\n');
}

export function githubCacheSourceKey(owner,repo,patterns){
    var base=String(owner||'')+'/'+String(repo||'');
    var excl=normalizeExcludeKey(patterns);
    return excl?base+'|excl:'+excl:base;
}

export function githubSourceKeyForLoadedAnalysis(owner,repo,data,pendingPatterns){
    var patterns=data&&data.excludePatterns!=null?data.excludePatterns:pendingPatterns;
    return githubCacheSourceKey(owner,repo,patterns);
}

export function cachedAnalysisMatchesExcludes(record,patterns){
    if(!record)return false;
    var wanted=normalizeExcludeKey(patterns);
    var key=String(record.sourceKey||'');
    var marker=key.indexOf('|excl:');
    if(marker>=0)return key.slice(marker+6)===wanted;
    return normalizeExcludeKey(record.data&&record.data.excludePatterns)===wanted;
}

export function githubZipDownloadUrl(owner,repo){
    return 'https://github.com/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo)+'/archive/HEAD.zip';
}

export function analysisCacheKey(sourceType,sourceKey){
    return String(sourceType||'unknown')+':'+String(sourceKey||'').replace(/\\/g,'/');
}

export function connectionIdentity(connection){
    var src=connection&&(typeof connection.source==='object'?connection.source.id:connection.source);
    var tgt=connection&&(typeof connection.target==='object'?connection.target.id:connection.target);
    var count=connection&&connection.count!=null?connection.count:1;
    return String(src||'')+'\t'+String(tgt||'')+'\t'+String((connection&&connection.fn)||'')+'\t'+String(count);
}

export function fileGraphIdentity(file){
    if(!file)return '';
    var fnCount=file.functions&&file.functions.length?file.functions.length:0;
    return [file.path||'',file.name||'',file.folder||'',file.layer||'',file.churn||0,fnCount].join('\t');
}

export function analysisGraphKey(data){
    if(!data||!data.files)return '';
    var files=data.files.map(fileGraphIdentity).join('\n');
    var connections=(data.connections||[]).map(connectionIdentity).sort().join('\n');
    return files+'\n'+connections;
}

export function graphStructureKey(data,folderFilter){
    var graph=analysisGraphKey(data);
    if(!graph)return '';
    return String(folderFilter||'')+'\n'+graph;
}

export function codeViewSceneKey(data,folderFilter,vizType,source){
    return analysisHydrationId(source,data)+'|'+String(folderFilter||'')+'|'+String(vizType||'');
}

export function analysisHydrationIdFromParts(source,graphKey){
    source=source||{};
    return [source.sourceType||'',source.sourceKey||'',graphKey||''].join('\0');
}

export function analysisHydrationId(source,data){
    return analysisHydrationIdFromParts(source,analysisGraphKey(data));
}

export function loadedAnalysisSourceIdentity(options){
    options=options||{};
    if(options.localSourceKind==='folder')return{sourceType:'folder',sourceKey:options.folderKey||'local-folder'};
    if(options.localSourceKind==='zip')return{sourceType:'zip',sourceKey:options.zipKey||'zip'};
    if(options.localSourceKind==='cli')return{sourceType:'cli',sourceKey:options.cliRoot||'cli'};
    if(options.githubOwner&&options.githubRepo)return{sourceType:'github',sourceKey:options.githubKey||(options.githubOwner+'/'+options.githubRepo)};
    if(options.cliOk)return{sourceType:'cli',sourceKey:options.cliRoot||'cli'};
    return null;
}

export function hydrationRequestIsCurrent(hydrationId,currentId){
    if(hydrationId==null||currentId==null)return true;
    return hydrationId===currentId;
}

export function hydratedSourceIsCurrent(update,currentId){
    if(!update||!update.path||typeof update.content!=='string')return false;
    return hydrationRequestIsCurrent(update.hydrationId,currentId);
}

export function resolveSafeCliPath(root,relPath){
    var rootPath=String(root||'').replace(/\\/g,'/').replace(/\/+$/,'');
    var rel=String(relPath||'').replace(/\\/g,'/');
    if(!rel||rel.charAt(0)==='/'||rel.indexOf('..')>=0)return null;
    return rootPath+'/'+rel;
}
