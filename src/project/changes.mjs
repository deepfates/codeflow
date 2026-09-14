import { cliRecordMatchesStatus } from './identity.mjs';

export var CLI_WATCH_DIFF_MS=200;

export var CODE_DIFF_LCS_LIMIT=160000;

export function normalizeCliWatchPath(path){
    return String(path||'').replace(/\\/g,'/').replace(/^\/+/,'');
}

export function noteCliWatchPath(prev,path){
    var next=normalizeCliWatchPath(path);
    if(!next)return prev||[];
    var list=prev||[];
    if(list.indexOf(next)>=0)return list;
    return list.concat([next]);
}

export function noteCliWatchPathIfRead(prev,path,readByPath){
    var next=normalizeCliWatchPath(path);
    if(!next)return prev||[];
    if(!(readByPath&&readByPath[next]))return prev||[];
    return noteCliWatchPath(prev,next);
}

export function cliWatchEventRev(value){
    var n=Number(value);
    return Number.isFinite(n)?n:null;
}

export function normalizeCliWatchDuringEvent(item){
    if(typeof item==='string')return{path:normalizeCliWatchPath(item),rev:null};
    var path=normalizeCliWatchPath(item&&item.path);
    if(!path)return null;
    return{path:path,rev:cliWatchEventRev(item.rev)};
}

export function noteCliWatchDuringEvent(prev,path,rev){
    var ev=normalizeCliWatchDuringEvent({path:path,rev:rev});
    if(!ev)return prev||[];
    var list=(prev||[]).slice();
    var idx=-1;
    for(var i=0;i<list.length;i++){
        var cur=normalizeCliWatchDuringEvent(list[i]);
        if(cur&&cur.path===ev.path){idx=i;break;}
    }
    if(idx>=0)list[idx]=ev;
    else list.push(ev);
    return list;
}

export function cliWatchEventIsAfterSnapshot(eventRev,snapRev){
    if(eventRev==null||snapRev==null)return true;
    return Number(eventRev)>Number(snapRev);
}

export function cliWatchSnapRevFromResponse(res){
    if(!res||!res.headers||typeof res.headers.get!=='function')return null;
    return cliWatchEventRev(res.headers.get('x-codeflow-rev'));
}

export function forgetCliWatchPath(prev,path){
    var next=normalizeCliWatchPath(path);
    if(!next)return prev||[];
    return (prev||[]).filter(function(item){return item!==next;});
}

export function analyzedFileForCliWatchPath(files,path){
    var next=normalizeCliWatchPath(path);
    if(!next||!files)return null;
    for(var i=0;i<files.length;i++){
        var file=files[i];
        if(file&&normalizeCliWatchPath(file.path)===next)return file;
    }
    return null;
}

export function cliWatchLiveMatchesBaseline(file,liveContent){
    return !!(fileHasAnalyzedSourceForDiff(file)&&typeof liveContent==='string'&&liveContent===file.content);
}

export function cliWatchLiveClearsDirty(file,liveContent,kind){
    return kind==='ok'&&cliWatchLiveMatchesBaseline(file,liveContent);
}

export function mergeCliLiveContents(prev,updates){
    var next=Object.assign(Object.create(null),prev||{});
    (updates||[]).forEach(function(update){
        if(!update||!update.path)return;
        var path=normalizeCliWatchPath(update.path);
        if(!path)return;
        if(typeof update.content!=='string'){
            delete next[path];
            return;
        }
        next[path]=update.content;
    });
    return next;
}

export function fileHasAnalyzedSourceForDiff(file){
    return !!(file&&!file.analysisSkipped&&typeof file.content==='string');
}

export function cliWatchDiffPaths(files,paths){
    var known=Object.create(null);
    (files||[]).forEach(function(file){
        if(file&&file.path&&fileHasAnalyzedSourceForDiff(file))known[file.path]=true;
    });
    var out=[];
    (paths||[]).forEach(function(path){
        var next=normalizeCliWatchPath(path);
        if(next&&known[next]&&out.indexOf(next)<0)out.push(next);
    });
    return out;
}

export function splitCodeLines(text){
    return String(text==null?'':text).split('\n');
}

export function codeCardDiffClass(row){
    if(!row||row.type==='same')return '';
    if(row.type==='add')return ' diff-add';
    if(row.type==='del')return ' diff-del';
    return '';
}

export function codeCardDiffLineNo(row){
    if(!row)return '';
    if(row.type==='del')return row.oldLine||'';
    return row.newLine||row.oldLine||'';
}

export function codeCardHasDiff(rows){
    if(!rows||!rows.length)return false;
    for(var i=0;i<rows.length;i++){
        if(rows[i]&&rows[i].type&&rows[i].type!=='same')return true;
    }
    return false;
}

export function lcsDiffRows(oldLines,newLines,oldOff,newOff){
    var a=oldLines||[];
    var b=newLines||[];
    var n=a.length,m=b.length;
    var dp=new Array(n+1);
    var i,j;
    for(i=0;i<=n;i++){
        dp[i]=new Array(m+1);
        dp[i][0]=0;
    }
    for(j=1;j<=m;j++)dp[0][j]=0;
    for(i=1;i<=n;i++){
        for(j=1;j<=m;j++){
            dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]+1:Math.max(dp[i-1][j],dp[i][j-1]);
        }
    }
    var out=[];
    i=n;j=m;
    while(i>0&&j>0){
        if(a[i-1]===b[j-1]){
            out.push({type:'same',text:a[i-1],oldLine:oldOff+i,newLine:newOff+j});
            i--;j--;
        }else if(dp[i-1][j]>=dp[i][j-1]){
            out.push({type:'del',text:a[i-1],oldLine:oldOff+i,newLine:null});
            i--;
        }else{
            out.push({type:'add',text:b[j-1],oldLine:null,newLine:newOff+j});
            j--;
        }
    }
    while(i>0){
        out.push({type:'del',text:a[i-1],oldLine:oldOff+i,newLine:null});
        i--;
    }
    while(j>0){
        out.push({type:'add',text:b[j-1],oldLine:null,newLine:newOff+j});
        j--;
    }
    out.reverse();
    return out;
}

export function replaceDiffRows(oldLines,newLines,oldOff,newOff){
    var out=[];
    var i;
    for(i=0;i<(oldLines||[]).length;i++){
        out.push({type:'del',text:oldLines[i],oldLine:oldOff+i+1,newLine:null});
    }
    for(i=0;i<(newLines||[]).length;i++){
        out.push({type:'add',text:newLines[i],oldLine:null,newLine:newOff+i+1});
    }
    return out;
}

export function diffCodeLines(before,after){
    var a=splitCodeLines(before);
    var b=splitCodeLines(after);
    var rows=[];
    var i=0,j=0;
    while(i<a.length&&j<b.length&&a[i]===b[j]){
        rows.push({type:'same',text:a[i],oldLine:i+1,newLine:j+1});
        i++;j++;
    }
    var aEnd=a.length,bEnd=b.length;
    while(aEnd>i&&bEnd>j&&a[aEnd-1]===b[bEnd-1]){
        aEnd--;bEnd--;
    }
    var midA=a.slice(i,aEnd);
    var midB=b.slice(j,bEnd);
    var mid=midA.length*midB.length<=CODE_DIFF_LCS_LIMIT
        ?lcsDiffRows(midA,midB,i,j)
        :replaceDiffRows(midA,midB,i,j);
    for(var k=0;k<mid.length;k++)rows.push(mid[k]);
    for(k=0;k<a.length-aEnd;k++){
        rows.push({type:'same',text:a[aEnd+k],oldLine:aEnd+k+1,newLine:bEnd+k+1});
    }
    return rows;
}

export function codeCardDiffRows(file,liveContent){
    if(!file||typeof file.content!=='string'||typeof liveContent!=='string')return null;
    if(file.content===liveContent)return null;
    if(liveContent===''){
        return splitCodeLines(file.content).map(function(text,i){
            return{type:'del',text:text,oldLine:i+1,newLine:null};
        });
    }
    var rows=diffCodeLines(file.content,liveContent);
    return codeCardHasDiff(rows)?rows:null;
}

export function fileForCodeCardDiff(file,diffRows){
    if(!file||!diffRows||!diffRows.length)return file;
    return Object.assign({},file,{content:diffRows.map(function(row){return row.text;}).join('\n')});
}

export function codeCardDiffLineIndex(diffRows,analyzedLine){
    var n=Math.max(1,Number(analyzedLine)||1);
    if(!diffRows||!diffRows.length)return n;
    var found=-1;
    for(var i=0;i<diffRows.length;i++){
        if(diffRows[i]&&diffRows[i].oldLine===n){
            found=i+1;
            if(diffRows[i].type==='same')return found;
        }
    }
    return found>0?found:n;
}

export function startedCliWatchDiffPaths(pending,gen){
    var out=[];
    (pending||[]).forEach(function(path){
        var next=normalizeCliWatchPath(path);
        if(next&&out.indexOf(next)<0)out.push(next);
    });
    Object.keys(gen||{}).forEach(function(path){
        var next=normalizeCliWatchPath(path);
        if(next&&out.indexOf(next)<0)out.push(next);
    });
    return out;
}

export function bumpCliWatchDiffEpoch(epoch){
    return (Number(epoch)||0)+1;
}

export function cliWatchDiffRequestIsCurrent(epoch,capturedEpoch,genByPath,path,capturedGen){
    if((Number(epoch)||0)!==(Number(capturedEpoch)||0))return false;
    return !!(genByPath&&genByPath[path]===capturedGen);
}

export function retainCliWatchPathsAfterAnalysis(receivedDuring,readByPath,snapRevByPath){
    var read=readByPath||Object.create(null);
    var snaps=snapRevByPath||Object.create(null);
    var out=[];
    (receivedDuring||[]).forEach(function(item){
        var ev=normalizeCliWatchDuringEvent(item);
        if(!ev||!read[ev.path]||out.indexOf(ev.path)>=0)return;
        if(!cliWatchEventIsAfterSnapshot(ev.rev,Object.prototype.hasOwnProperty.call(snaps,ev.path)?snaps[ev.path]:null))return;
        out.push(ev.path);
    });
    return out;
}

export var CLI_WATCH_MAX_BYTES=2*1024*1024;

export function cliWatchLiveRejectsOversized(size){
    var n=Number(size);
    return Number.isFinite(n)&&n>CLI_WATCH_MAX_BYTES;
}

export function cliWatchLiveFromResponse(status,body,ok,contentLength){
    if(cliWatchLiveRejectsOversized(contentLength))return{kind:'error'};
    if(ok){
        var content=typeof body==='string'?body:'';
        if(cliWatchLiveRejectsOversized(content.length))return{kind:'error'};
        return{kind:'ok',content:content};
    }
    if(Number(status)===404)return{kind:'missing',content:''};
    return{kind:'error'};
}

export function shouldApplyCliWatchLive(result){
    return !!(result&&(result.kind==='ok'||result.kind==='missing'));
}

export function pendingCliWatchDiffPaths(dirty,live,inflight){
    var have=live||Object.create(null);
    var wait=inflight||[];
    return (dirty||[]).filter(function(path){
        if(!path)return false;
        if(Object.prototype.hasOwnProperty.call(have,path))return false;
        if(wait.indexOf(path)>=0)return false;
        return true;
    });
}

export function cliWatchAppliesToAnalysis(localSourceKind,cliStatus,analysisSource){
    if(!cliStatus||!cliStatus.ok)return false;
    if(localSourceKind==='folder'||localSourceKind==='zip')return false;
    if(analysisSource&&analysisSource.sourceType&&analysisSource.sourceType!=='cli')return false;
    if(localSourceKind&&localSourceKind!=='cli')return false;
    if(analysisSource&&analysisSource.sourceType==='cli')return cliRecordMatchesStatus(analysisSource,cliStatus);
    return localSourceKind==='cli';
}
