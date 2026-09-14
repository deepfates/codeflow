import policy from './exclusion-policy.cjs';
import {isIncluded} from '../analysis/file-types.mjs';
const {IGNORE,DEFAULT_EXCLUDE_CHIPS,normalizeExcludePath,parseExcludePatterns,globMatches,compileExcludePatterns,matchesExcludePattern,shouldIgnoreDirectory}=policy;
















function shouldExcludeFile(path,name,compiledPatterns){
    return !isIncluded(name)||matchesExcludePattern(compiledPatterns,path,name);
}

function getArchiveRootPrefix(paths){
    var splitPaths=(paths||[]).map(function(path){return normalizeExcludePath(path).split('/').filter(Boolean);}).filter(function(parts){return parts.length>0;});
    if(!splitPaths.length)return'';
    var firstSegment=splitPaths[0][0];
    var hasSingleRoot=splitPaths.every(function(parts){return parts.length>1&&parts[0]===firstSegment;});
    return hasSingleRoot?firstSegment+'/':'';
}

function filterAnalyzableLocalFiles(files,compiledPatterns){
    var patterns=compiledPatterns||[];
    var dirCache=new Map();
    return (files||[]).filter(function(f){
        var entryPath=normalizeExcludePath(f&&f.path);
        if(!entryPath||entryPath.endsWith('/'))return false;
        var name=(f&&f.name)||entryPath.split('/').filter(Boolean).pop()||'';
        if(!name||name==='.DS_Store')return false;
        if(shouldSkipArchivePath(entryPath,patterns,dirCache))return false;
        if(shouldExcludeFile(entryPath,name,patterns))return false;
        return true;
    });
}

function shouldSkipArchivePath(path,compiledPatterns,dirCache){
    var segments=normalizeExcludePath(path).split('/').filter(Boolean);
    var current='';
    for(var i=0;i<segments.length-1;i++){
        current=current?current+'/'+segments[i]:segments[i];
        if(dirCache&&dirCache.has(current)){
            if(dirCache.get(current))return true;
            continue;
        }
        var ignored=shouldIgnoreDirectory(current,segments[i],compiledPatterns);
        if(dirCache)dirCache.set(current,ignored);
        if(ignored)return true;
    }
    return false;
}


export {IGNORE,DEFAULT_EXCLUDE_CHIPS,normalizeExcludePath,parseExcludePatterns,globMatches,compileExcludePatterns,matchesExcludePattern,shouldIgnoreDirectory,shouldExcludeFile,getArchiveRootPrefix,filterAnalyzableLocalFiles,shouldSkipArchivePath};
