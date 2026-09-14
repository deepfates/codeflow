// Shared browser/CLI/Action path policy; CommonJS also supports the Node 18 Action.
'use strict';
const IGNORE=new Set(['node_modules','deps','_build','.elixir_ls','.git','vendor','dist','build','out','coverage','.next','.nuxt','.cache','.parcel-cache','.turbo','.vercel','.local','.artifacts','.playwright-cli','playwright-report','test-results','.claude','.codex','.idea','.vscode','.pnpm-store','.yarn','tmp','temp','target','bin','obj','__pycache__','.venv','venv','env','.env','.tox','.mypy_cache','.pytest_cache','.ruff_cache','__pypackages__','.eggs','__macosx']);

const DEFAULT_EXCLUDE_CHIPS=['.git','node_modules','deps','_build','.elixir_ls','dist','build','coverage','.next','.turbo','.local','.venv','venv','.tox'];

function normalizeExcludePath(value){
    return (value||'').replace(/\\/g,'/').replace(/^\/+/,'').replace(/\/{2,}/g,'/');
}

function parseExcludePatterns(input){
    var seen=new Set();
    return (input||'').split(/\r?\n|,/).map(function(item){
        return normalizeExcludePath(item.trim()).replace(/\/$/,'');
    }).filter(function(item){
        if(!item||seen.has(item.toLowerCase()))return false;
        seen.add(item.toLowerCase());
        return true;
    });
}

function globMatches(pattern,value){
    var glob=normalizeExcludePath(pattern).toLowerCase();
    var candidate=normalizeExcludePath(value).toLowerCase();
    var memo=new Map();
    function match(globIndex,valueIndex){
        var key=globIndex+':'+valueIndex;
        if(memo.has(key))return memo.get(key);
        var result;
        if(globIndex===glob.length){
            result=valueIndex===candidate.length;
        }else if(glob[globIndex]==='*'){
            if(glob[globIndex+1]==='*'){
                if(glob[globIndex+2]==='/'){
                    result=match(globIndex+3,valueIndex);
                    if(!result){
                        var slashIndex=candidate.indexOf('/',valueIndex);
                        result=slashIndex>valueIndex&&match(globIndex,slashIndex+1);
                    }
                }else{
                    result=match(globIndex+2,valueIndex)||(valueIndex<candidate.length&&match(globIndex,valueIndex+1));
                }
            }else{
                result=match(globIndex+1,valueIndex)||(valueIndex<candidate.length&&candidate[valueIndex]!=='/'&&match(globIndex,valueIndex+1));
            }
        }else if(glob[globIndex]==='?'){
            result=valueIndex<candidate.length&&candidate[valueIndex]!=='/'&&match(globIndex+1,valueIndex+1);
        }else{
            result=valueIndex<candidate.length&&glob[globIndex]===candidate[valueIndex]&&match(globIndex+1,valueIndex+1);
        }
        memo.set(key,result);
        return result;
    }
    return match(0,0);
}

function compileExcludePatterns(input){
    return parseExcludePatterns(input).map(function(pattern){
        var lower=pattern.toLowerCase();
        var hasGlob=pattern.includes('*')||pattern.includes('?');
        var hasPath=pattern.includes('/');
        return{
            raw:pattern,
            lower:lower,
            useGlob:hasGlob||hasPath
        };
    });
}

function matchesExcludePattern(compiledPatterns,path,name){
    if(!compiledPatterns||!compiledPatterns.length)return false;
    var normalizedPath=normalizeExcludePath(path||name).replace(/\/$/,'');
    var lowerPath=normalizedPath.toLowerCase();
    var lowerName=(name||normalizedPath.split('/').pop()||'').toLowerCase();
    var lowerPathWithSlash=lowerPath?lowerPath+'/':'';
    var segments=lowerPath.split('/').filter(Boolean);
    return compiledPatterns.some(function(pattern){
        if(!pattern.useGlob){
            return lowerName===pattern.lower||segments.includes(pattern.lower);
        }
        return globMatches(pattern.lower,lowerPath)||globMatches(pattern.lower,lowerPathWithSlash)||globMatches(pattern.lower,lowerName);
    });
}

function shouldIgnoreDirectory(path,name,compiledPatterns){
    var lowerName=(name||'').toLowerCase();
    return IGNORE.has(lowerName)||lowerName.endsWith('.egg-info')||matchesExcludePattern(compiledPatterns,path,name);
}
module.exports={IGNORE,DEFAULT_EXCLUDE_CHIPS,normalizeExcludePath,parseExcludePatterns,globMatches,compileExcludePatterns,matchesExcludePattern,shouldIgnoreDirectory};
