import {buildTree} from '../project/tree.mjs';
import { analysisCacheKey } from '../project/identity.mjs';

export var ANALYSIS_CACHE_DB='codeflow-recents';

export var ANALYSIS_CACHE_STORE='analyses';

export var ANALYSIS_CACHE_VERSION=2;

export var ANALYSIS_CACHE_MAX=12;

export var ANALYSIS_CACHE_MAX_BYTES=18*1024*1024;

export function formatRecentTime(ts){
    var value=Number(ts);
    if(!isFinite(value)||value<=0)return'';
    var delta=Date.now()-value;
    if(delta<60000)return'just now';
    if(delta<3600000)return Math.floor(delta/60000)+'m ago';
    if(delta<86400000)return Math.floor(delta/3600000)+'h ago';
    return new Date(value).toLocaleDateString();
}

export function armRecentDelete(armedId,clickedId){
    clickedId=clickedId||null;
    if(clickedId&&armedId===clickedId)return{confirm:true,armedId:null};
    return{confirm:false,armedId:clickedId};
}

export function buildRecentAnalysisRecord(options){
    options=options||{};
    var sourceType=options.sourceType||'unknown';
    var sourceKey=options.sourceKey||'untitled';
    return{
        id:analysisCacheKey(sourceType,sourceKey),
        title:options.title||sourceKey,
        sourceType:sourceType,
        sourceKey:sourceKey,
        repoUrl:options.repoUrl||'',
        fileCount:options.data&&options.data.files?options.data.files.length:0,
        savedAt:options.savedAt||Date.now(),
        data:options.data||null,
        repoInfo:options.repoInfo||null,
        localSourceKind:options.localSourceKind||null
    };
}

export function estimateAnalysisRecordBytes(record){
    try{
        return JSON.stringify(record).length;
    }catch(e){
        return ANALYSIS_CACHE_MAX_BYTES+1;
    }
}

export function omitSnippetCode(item){
    if(!item||typeof item!=='object'||Array.isArray(item))return item;
    if(!Object.prototype.hasOwnProperty.call(item,'code'))return item;
    var copy=Object.assign({},item);
    delete copy.code;
    return copy;
}

export function compactAnalysisForCache(data){
    if(!data||typeof data!=='object')return data;
    var copy=Object.assign({},data);
    if(Array.isArray(copy.files)){
        copy.files=copy.files.map(function(file){
            var next=Object.assign({},file);
            delete next.content;
            if(next.elixir)next.elixir={...next.elixir,functions:(next.elixir.functions||[]).map(omitSnippetCode)};
            if(Array.isArray(next.functions))next.functions=next.functions.map(omitSnippetCode);
            if(Array.isArray(next.deadFunctions))next.deadFunctions=next.deadFunctions.map(omitSnippetCode);
            if(Array.isArray(next.securityIssues))next.securityIssues=next.securityIssues.map(omitSnippetCode);
            return next;
        });
    }
    // Tree and pattern members reference the same files in the live model.
    // Reconnect those references to the compact projection, not raw source.
    if(Array.isArray(copy.files)){
        const byPath=new Map(copy.files.map(file=>[file.path,file]));
        if(copy.tree)copy.tree=buildTree(copy.files);
        if(copy.patterns)copy.patterns=copy.patterns.map(pattern=>({...pattern,
            files:(pattern.files||[]).map(file=>byPath.get(file.path)||file)}));
    }
    if(Array.isArray(copy.functions))copy.functions=copy.functions.map(omitSnippetCode);
    if(Array.isArray(copy.deadFunctions))copy.deadFunctions=copy.deadFunctions.map(omitSnippetCode);
    if(Array.isArray(copy.securityIssues))copy.securityIssues=copy.securityIssues.map(omitSnippetCode);
    if(Array.isArray(copy.issues)){
        copy.issues=copy.issues.map(function(issue){
            var next=Object.assign({},issue);
            if(Array.isArray(next.items))next.items=next.items.map(omitSnippetCode);
            return next;
        });
    }
    if(copy.fnStats&&typeof copy.fnStats==='object'){
        var stats=Object.create(null);
        Object.keys(copy.fnStats).forEach(function(key){
            stats[key]=omitSnippetCode(copy.fnStats[key]);
        });
        copy.fnStats=stats;
    }
    return copy;
}

export function openAnalysisCacheDb(){
    if(typeof indexedDB==='undefined')return Promise.reject(new Error('IndexedDB is not available'));
    return new Promise(function(resolve,reject){
        var req=indexedDB.open(ANALYSIS_CACHE_DB,ANALYSIS_CACHE_VERSION);
        req.onupgradeneeded=function(){
            var db=req.result;
            if(db.objectStoreNames.contains(ANALYSIS_CACHE_STORE))db.deleteObjectStore(ANALYSIS_CACHE_STORE);
            var store=db.createObjectStore(ANALYSIS_CACHE_STORE,{keyPath:'id'});
            store.createIndex('savedAt','savedAt');
        };
        req.onsuccess=function(){resolve(req.result);};
        req.onerror=function(){reject(req.error||new Error('Failed to open analysis cache'));};
    });
}

export function listRecentAnalyses(){
    return openAnalysisCacheDb().then(function(db){
        return new Promise(function(resolve,reject){
            var tx=db.transaction(ANALYSIS_CACHE_STORE,'readonly');
            var req=tx.objectStore(ANALYSIS_CACHE_STORE).getAll();
            req.onsuccess=function(){
                var rows=(req.result||[]).slice().sort(function(a,b){return (b.savedAt||0)-(a.savedAt||0);});
                resolve(rows);
            };
            req.onerror=function(){reject(req.error);};
        });
    }).catch(function(){return[];});
}

export function getRecentAnalysis(id){
    return openAnalysisCacheDb().then(function(db){
        return new Promise(function(resolve,reject){
            var tx=db.transaction(ANALYSIS_CACHE_STORE,'readonly');
            var req=tx.objectStore(ANALYSIS_CACHE_STORE).get(id);
            req.onsuccess=function(){resolve(req.result||null);};
            req.onerror=function(){reject(req.error);};
        });
    });
}

export function deleteRecentAnalysis(id){
    return openAnalysisCacheDb().then(function(db){
        return new Promise(function(resolve,reject){
            var tx=db.transaction(ANALYSIS_CACHE_STORE,'readwrite');
            tx.objectStore(ANALYSIS_CACHE_STORE).delete(id);
            tx.oncomplete=function(){resolve(true);};
            tx.onerror=function(){reject(tx.error);};
        });
    });
}

export function saveRecentAnalysis(record){
    if(!record||!record.id||!record.data)return Promise.resolve(false);
    if(estimateAnalysisRecordBytes(record)>ANALYSIS_CACHE_MAX_BYTES)return Promise.resolve(false);
    return openAnalysisCacheDb().then(function(db){
        return new Promise(function(resolve,reject){
            var tx=db.transaction(ANALYSIS_CACHE_STORE,'readwrite');
            var store=tx.objectStore(ANALYSIS_CACHE_STORE);
            store.put(record);
            var allReq=store.getAll();
            allReq.onsuccess=function(){
                var rows=(allReq.result||[]).slice().sort(function(a,b){return (b.savedAt||0)-(a.savedAt||0);});
                rows.slice(ANALYSIS_CACHE_MAX).forEach(function(old){store.delete(old.id);});
            };
            tx.oncomplete=function(){resolve(true);};
            tx.onerror=function(){reject(tx.error);};
        });
    }).catch(function(){return false;});
}
