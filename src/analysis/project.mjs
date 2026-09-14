import {buildTree} from '../project/tree.mjs';
import {buildArchitectureDiagram} from './architecture.mjs';

// The project model assembles evidence; scheduling and syntax belong to its callers.
export function createProjectAnalyzer(Parser){
async function buildAnalysisData(options){
    var analyzed=(options.analyzed||[]).map(file=>({...file}));
    var allFns=options.allFns||[];
    var excludePatterns=options.excludePatterns||[];
    var progress=typeof options.progress==='function'?options.progress:function(){};
    var yieldFn=options.yieldFn||(()=>Promise.resolve());
    var CALL_BATCH=30;

    progress('Building dependency graph (1/6)...');
    await yieldFn();
    await Parser.prepareTreeSitter(analyzed);
    var elixirReparsed=new Set();
    analyzed.forEach(function(file){
        if(!Parser.isElixir(file.path)||!file.content||file.analysisSkipped)return;
        file.elixir=Parser.analyzeElixir(file.content,file.path);
        if(file.elixir.status!=='unavailable'){
            elixirReparsed.add(file.path);
            file.functions=file.elixir.functions;
            file.parserProvenance=file.elixir.provenance;
        }
    });
    allFns=allFns.filter(function(fn){return !elixirReparsed.has(fn.file);}).concat(analyzed.filter(function(file){return elixirReparsed.has(file.path);}).flatMap(function(file){return file.functions.map(function(fn){return Object.assign({},fn,{folder:file.folder,layer:file.layer});});}));
    var fnDefIndex=Parser.buildFunctionDefinitionIndex(allFns);
    var fnNames=Object.keys(fnDefIndex.byName);
    var fnNameIndex=Parser.buildFunctionNameIndex(fnNames);
    var fnDefLineIndex=Parser.buildFunctionDefLineIndex(allFns);
    var callGraphPathIndex=Parser.buildCallGraphPathIndex(analyzed);
    var fileImportInfo=Object.create(null);
    analyzed.forEach(function(file){
        fileImportInfo[file.path]=file.isCode===false
            ?{locals:Object.create(null),targets:new Set()}
            :Parser.extractCallGraphImportMap(file.content||'',file.path,callGraphPathIndex);
    });
    var conns=[];
    var fnStats=Object.create(null);

    function createFunctionStat(fn){
        return{
            key:fn.key,
            name:fn.name,
            internal:0,
            external:0,
            callers:new Map(),
            file:fn.file,
            folder:fn.folder,
            line:fn.line,
            code:fn.code,
            isTopLevel:fn.isTopLevel!==false,
            isExported:fn.isExported||false,
            isClassMethod:fn.isClassMethod||false,
            type:fn.type||'function',
            decorators:fn.decorators||null,
            className:fn.className||null
        };
    }

    function firstDefinitionFromOneFile(defs){
        if(!defs.length)return null;
        var file=defs[0].file;
        for(var i=1;i<defs.length;i++){
            if(defs[i].file!==file)return null;
        }
        return defs[0];
    }

    function resolveCallDefinitions(fnName,file){
        var isPascalCall=Parser.isPascal(file.path);
        var pascalParts=isPascalCall?fnName.toLowerCase().split('.'):[];
        var pascalBaseName=isPascalCall?pascalParts.pop():fnName;
        var pascalQualifier=isPascalCall?pascalParts.join('.'):'';
        var defs=isPascalCall
            ?fnDefIndex.byPascalName[pascalBaseName]||[]
            :fnDefIndex.byName[fnName]||[];
        if(!defs.length)return[];
        var imports=fileImportInfo[file.path]||{locals:Object.create(null),targets:new Set()};
        var hasUnresolvedPascalQualifier=false;
        if(pascalQualifier){
            var qualifiedImports=(imports.locals&&imports.locals[pascalQualifier])||[];
            if(qualifiedImports.length){
                var qualifiedMatches=defs.filter(function(def){return qualifiedImports.indexOf(def.file)>=0;});
                var qualifiedDef=firstDefinitionFromOneFile(qualifiedMatches);
                return qualifiedDef?[qualifiedDef]:[];
            }
            hasUnresolvedPascalQualifier=true;
        }
        var sameFile=defs.filter(function(def){return def.file===file.path;});
        var sameFileDef=firstDefinitionFromOneFile(sameFile);
        if(sameFileDef)return[sameFileDef];
        if(hasUnresolvedPascalQualifier)return[];
        if(defs.length===1)return[defs[0]];

        var directImports=(imports.locals&&imports.locals[fnName])||[];
        var matches=[];
        if(directImports.length){
            matches=defs.filter(function(def){return directImports.indexOf(def.file)>=0;});
            var directDef=firstDefinitionFromOneFile(matches);
            if(directDef)return[directDef];
        }

        if(imports.targets&&typeof imports.targets.has==='function'){
            if(isPascalCall){
                var orderedTargets=Array.from(imports.targets);
                for(var targetIndex=orderedTargets.length-1;targetIndex>=0;targetIndex--){
                    matches=defs.filter(function(def){return def.file===orderedTargets[targetIndex];});
                    var precedenceDef=firstDefinitionFromOneFile(matches);
                    if(precedenceDef)return[precedenceDef];
                }
                return[];
            }
            matches=defs.filter(function(def){return imports.targets.has(def.file);});
            var importedDef=firstDefinitionFromOneFile(matches);
            if(importedDef)return[importedDef];
        }
        return[];
    }

    Object.keys(fnDefIndex.byKey).forEach(function(key){
        fnStats[key]=createFunctionStat(fnDefIndex.byKey[key]);
    });

    for(var bi=0;bi<analyzed.length;bi+=CALL_BATCH){
        var batchEnd=Math.min(bi+CALL_BATCH,analyzed.length);
        progress('Analyzing dependencies (2/6)... '+batchEnd+'/'+analyzed.length+' files');
        for(var fi=bi;fi<batchEnd;fi++){
            var file=analyzed[fi];
            if(!file.content||file.isCode===false)continue;
            if(file.elixir&&file.elixir.status!=='unavailable'){
                file.elixir.calls.forEach(function(call){
                    var signature=call.function+'/'+call.arity;
                    var defs=[];
                    if(call.module)defs=fnDefIndex.byElixirMFA[call.module+'.'+signature]||[];
                    else{
                        defs=fnDefIndex.byElixirMFA[call.callerModule+'.'+signature]||[];
                        if(!defs.length)call.imports.forEach(function(imp){
                            if(imp.only&&imp.only.indexOf(signature)<0||imp.except&&imp.except.indexOf(signature)>=0)return;
                            defs=defs.concat(fnDefIndex.byElixirMFA[imp.module+'.'+signature]||[]);
                        });
                    }
                    defs=defs.filter(function(def){return def.visibility!=='private'||!call.module&&def.module===call.callerModule;});
                    if(defs.length!==1){file.elixir.unresolved.push(Object.assign({},call,{reason:defs.length?'Ambiguous import or module definition':'Definition outside indexed source or dynamic invocation'}));return;}
                    var def=defs[0],stat=fnStats[def.key];call.resolved=def.name;call.definition={file:def.file,line:def.line};
                    if(def.file===file.path)stat.internal++;
                    else{
                        var existing=conns.find(function(c){return c.source===def.file&&c.target===file.path&&c.functionKey===def.key;});
                        if(existing)existing.count++;
                        else conns.push({source:def.file,target:file.path,fn:def.name,count:1,functionKey:def.key,evidence:'tree-sitter:elixir',kind:def.type==='macro'?'macro-reference':'call-reference'});
                        var caller=stat.callers.get(file.path);if(caller)caller.count++;else stat.callers.set(file.path,{file:file.path,name:file.name,count:1});stat.external++;
                    }
                });
                continue;
            }
            var calls=Parser.findCalls(file.content,fnNames,file.path,fnDefLineIndex,fnNameIndex);
            Object.entries(calls).forEach(function(entry){
                var fn=entry[0],cnt=entry[1];
                if(cnt<=0)return;
                var defs=resolveCallDefinitions(fn,file);
                if(!defs.length){
                    // The name IS called somewhere but the receiver's type (or
                    // import) could not be resolved to a single definition.
                    // For a dead-code report a false negative is far cheaper
                    // than a false positive, so mark every same-named
                    // definition as possibly called instead of dropping the
                    // call on the floor (polymorphic Ruby/duck-typed dispatch,
                    // multi-file JS globals).
                    var ambiguous=Parser.isPascal(file.path)
                        ?fnDefIndex.byPascalName[fn.toLowerCase().split('.').pop()]||[]
                        :fnDefIndex.byName[fn]||[];
                    ambiguous.forEach(function(def){
                        var st=fnStats[def.key];
                        if(st)st.possiblyCalled=true;
                    });
                    return;
                }
                defs.forEach(function(def){
                    var stat=fnStats[def.key];
                    if(!stat)return;
                    if(def.file===file.path){
                        stat.internal+=cnt;
                    }else{
                        conns.push({source:def.file,target:file.path,fn:def.name,count:cnt,functionKey:def.key});
                        var ex=stat.callers.get(file.path);
                        if(ex)ex.count+=cnt;
                        else stat.callers.set(file.path,{file:file.path,name:file.name,count:cnt});
                        stat.external+=cnt;
                    }
                });
            });
        }
        await yieldFn();
    }
    Object.values(fnStats).forEach(function(s){s.callers=Array.from(s.callers.values());s.count=s.internal+s.external;});

    progress('Resolving markdown links...');
    await yieldFn();
    var mdAllPaths=analyzed.map(function(f){return f.path;});
    var mdPathIndex=Parser.buildMarkdownPathIndex(mdAllPaths);
    analyzed.forEach(function(file){
        if(!Parser.isMarkdown(file.name))return;
        file.layer='note';
        if(!file.content)return;
        var links=Parser.extractMarkdownLinks(file.content);
        var deps=[];
        links.forEach(function(link){
            var resolved=Parser.resolveMarkdownLink(link.target,file.path,mdPathIndex,link.kind);
            deps.push({kind:link.kind,raw:link.raw,target:link.target,resolved:resolved});
            if(resolved&&resolved!==file.path){
                conns.push({source:file.path,target:resolved,fn:link.raw,count:1,kind:link.kind});
            }
        });
        file.dependencies=deps;
    });
    analyzed.forEach(function(f){if(!f.dependencies)f.dependencies=[];});

    var issues=[];
    var oversizedFiles=analyzed.filter(function(file){return file.analysisSkipped==='oversized';});
    if(oversizedFiles.length)issues.push({
        type:'warning',
        title:oversizedFiles.length+' Oversized Files Skipped',
        desc:'Files larger than 2 MB are listed but their contents are not parsed',
        items:oversizedFiles.map(function(file){return{name:file.name,file:file.path,size:file.size||0};})
    });
    var fetchFailedFiles=analyzed.filter(function(file){return file.analysisSkipped==='fetch-failed';});
    if(fetchFailedFiles.length)issues.push({
        type:'critical',
        title:fetchFailedFiles.length+' Files Not Fetched — Partial Analysis',
        desc:'GitHub API requests failed (usually the unauthenticated rate limit of 60/hour). Every metric below is computed WITHOUT these files. Add a token, or use Open ZIP for a complete analysis.',
        items:fetchFailedFiles.map(function(file){return{name:file.name,file:file.path,size:file.size||0};})
    });
    var deadFns=Object.entries(fnStats).filter(function(x){
        var stats=x[1],name=stats.name;
        if(stats.internal>0||stats.external>0)return false;
        if(stats.possiblyCalled)return false;
        if(stats.isClassMethod)return false;
        if(!stats.isTopLevel)return false;
        if(stats.decorators&&stats.decorators.length>0)return false;
        if(stats.type==='class'||stats.type==='dataclass'||stats.type==='abstract_class')return false;
        var baseName=name.includes('.')?name.split('.').pop():name;
        if(baseName.startsWith('__')&&baseName.endsWith('__'))return false;
        if(baseName.startsWith('test_')||baseName==='setUp'||baseName==='tearDown'||baseName==='setUpClass'||baseName==='tearDownClass')return false;
        // Ruby constructors are invoked via Class.new, never by name; module/class
        // lifecycle hooks and test hooks are invoked by the runtime.
        if(stats.file&&/\.(rb|rake)$/.test(stats.file)&&['initialize','included','extended','inherited','prepended','method_missing','respond_to_missing?','setup','teardown'].indexOf(baseName)>=0)return false;
        if(stats.file&&(stats.file.includes('test_')||stats.file.includes('_test.')||stats.file.includes('/tests/')||Parser.isTestFile(stats.file)))return false;
        if((baseName==='upgrade'||baseName==='downgrade')&&stats.file&&(stats.file.includes('migration')||stats.file.includes('alembic')||stats.file.includes('versions')))return false;
        if(['main','create_app','make_app','get_app','setup','configure','register','on_startup','on_shutdown','lifespan'].indexOf(baseName)>=0)return false;
        if(stats.isExported&&stats.file&&/\.[jt]sx?$/.test(stats.file))return false;
        if(stats.file&&(/\.(?:spec|test)\.[jt]sx?$/.test(stats.file)||stats.file.includes('__tests__')))return false;
        return true;
    });
    if(deadFns.length)issues.push({type:'warning',title:deadFns.length+' Unused Functions',desc:'Functions not called from other files',items:deadFns.map(function(x){return{name:x[1].name,file:x[1].file,line:x[1].line,code:x[1].code};})});

    var godFiles=analyzed.filter(function(f){return f.functions.length>15;});
    if(godFiles.length)issues.push({type:'critical',title:godFiles.length+' Large Files',desc:'Files with 15+ functions',items:godFiles.map(function(f){return{name:f.name+' ('+f.functions.length+' fns)',file:f.path,fns:f.functions.length,lines:f.lines};})});

    var coupling=Object.create(null);
    conns.forEach(function(c){coupling[c.target]=(coupling[c.target]||0)+1;});
    var highCoup=Object.entries(coupling).filter(function(x){return x[1]>8;}).sort(function(a,b){return b[1]-a[1];});
    if(highCoup.length)issues.push({type:'warning',title:highCoup.length+' Highly Coupled',desc:'Files that import 8+ other files',items:highCoup.map(function(x){return{name:x[0].split('/').pop()+' ('+x[1]+' imports)',file:x[0],imports:x[1]};})});

    // Circular dependencies = actual import statements in BOTH directions.
    // Mutual call-graph edges or markdown cross-links are not import cycles
    // (a README linking to a guide that links back is working documentation,
    // and a registry module calling back into its hosts is a deliberate design).
    var circular=[];
    var circularSeen=new Set();
    analyzed.forEach(function(file){
        var info=fileImportInfo[file.path];
        if(!info||!info.targets||typeof info.targets.forEach!=='function')return;
        info.targets.forEach(function(target){
            if(!target||target===file.path)return;
            var other=fileImportInfo[target];
            if(other&&other.targets&&typeof other.targets.has==='function'&&other.targets.has(file.path)){
                var key=[file.path,target].sort().join('|');
                if(!circularSeen.has(key)){circularSeen.add(key);circular.push(key);}
            }
        });
    });
    if(circular.length)issues.push({type:'critical',title:circular.length+' Circular Dependencies',desc:'Files that import each other',items:circular.map(function(p){var parts=p.split('|');return{name:parts.map(function(x){return x.split('/').pop();}).join(' ↔ '),files:parts};})});

    progress('Detecting patterns (3/6)...');
    await yieldFn();
    var patterns=Parser.detectPatterns(analyzed);
    var securityIssues=Parser.detectSecurity(analyzed);

    progress('Analyzing code quality (4/6)...');
    await yieldFn();
    var duplicates=Parser.detectDuplicates(analyzed,allFns);
    var layerViolations=Parser.detectLayerViolations(analyzed,conns);
    for(var ci=0;ci<analyzed.length;ci+=CALL_BATCH){
        var cEnd=Math.min(ci+CALL_BATCH,analyzed.length);
        for(var cj=ci;cj<cEnd;cj++){
            analyzed[cj].complexity=analyzed[cj].isCode!==false?Parser.calcComplexity(analyzed[cj].content,analyzed[cj].path):{score:0,level:'low'};
        }
        if(ci+CALL_BATCH<analyzed.length)await yieldFn();
    }

    progress('Building architecture diagram (5/6)...');
    await yieldFn();
    var architectureDiagram=buildArchitectureDiagram(analyzed);

    progress('Finalizing (6/6)...');
    await yieldFn();

    var folders=[...new Set(analyzed.map(function(f){return f.folder;}))].sort();
    var tree=buildTree(analyzed);
    var totalLoc=analyzed.reduce(function(s,f){return s+f.lines;},0);
    var langStats=Object.create(null);
    var parserStats=Object.create(null);
    analyzed.forEach(function(f){
        var ext=f.name.split('.').pop().toLowerCase();
        langStats[ext]=(langStats[ext]||0)+f.lines;
        var provenance=f.parserProvenance||Parser.getParserProvenance(f.path||f.name);
        f.parserProvenance=provenance;
        parserStats[provenance]=(parserStats[provenance]||0)+1;
    });
    var langArray=Object.entries(langStats).sort(function(a,b){return b[1]-a[1];}).map(function(e){return{ext:e[0],lines:e[1],pct:totalLoc?Math.round(e[1]/totalLoc*100):0};});
    var parserArray=Object.entries(parserStats).sort(function(a,b){return b[1]-a[1];}).map(function(e){return{mode:e[0],files:e[1]};});

    if(duplicates.length>0){
        var nameDups=duplicates.filter(function(d){return d.type==='name';});
        var codeDups=duplicates.filter(function(d){return d.type==='code';});
        if(nameDups.length)issues.push({type:'warning',title:nameDups.length+' Duplicate Function Names',desc:'Same function name in multiple files',items:nameDups.map(function(d){return{name:d.name+' ('+d.count+' files)',suggestion:d.suggestion,files:d.files,count:d.count};})});
        if(codeDups.length)issues.push({type:'warning',title:codeDups.length+' Similar Code Blocks',desc:'Copy-paste code detected',items:codeDups.map(function(d){return{name:d.name,suggestion:d.suggestion,files:d.files};})});
    }
    if(layerViolations.length>0){
        issues.push({type:'critical',title:layerViolations.length+' Architecture Violations',desc:'Lower layers importing from higher layers',items:layerViolations.map(function(v){return{name:v.fromLayer+' → '+v.toLayer,file:v.from,toFile:v.to,fn:v.fn,suggestion:v.suggestion};})});
    }
    var highComplexity=analyzed.filter(function(f){return f.complexity&&f.complexity.level==='critical';}).sort(function(a,b){return b.complexity.score-a.complexity.score;});
    if(highComplexity.length)issues.push({type:'warning',title:highComplexity.length+' High Complexity Files',desc:'Approximate cyclomatic complexity >30 (counts branch keywords and boolean operators per file)',items:highComplexity.map(function(f){return{name:f.name+' ('+f.complexity.score+')',file:f.path,score:f.complexity.score,lines:f.lines};})});

    var dataObj={
        files:analyzed,
        functions:allFns,
        connections:conns,
        fnStats:fnStats,
        folders:folders,
        tree:tree,
        issues:issues,
        patterns:patterns,
        securityIssues:securityIssues,
        duplicates:duplicates,
        layerViolations:layerViolations,
        architectureDiagram:architectureDiagram,
        deadFunctions:deadFns.map(function(x){var codeLines=x[1].code?x[1].code.split('\n').length:0;return{name:x[1].name,file:x[1].file,folder:x[1].folder,line:x[1].line,code:x[1].code,codeLines:codeLines,ext:x[1].file.split('.').pop()};}),
        excludePatterns:excludePatterns,
        stats:{files:analyzed.length,functions:allFns.length,connections:conns.length,dead:deadFns.length,patterns:patterns.length,security:securityIssues.filter(function(i){return i.severity==='high';}).length,duplicates:duplicates.length,violations:layerViolations.length,skipped:oversizedFiles.length,loc:totalLoc,languages:langArray,parserModes:parserArray}
    };
    dataObj.suggestions=Parser.generateSuggestions(dataObj);
    return qualifySourceCallerEvidence(dataObj);
}
return {buildAnalysisData};
}

// Missing static callers are not proof of dead Elixir code: callbacks, macros
// and dynamic dispatch remain possible whether optional compiler data exists or not.
function qualifySourceCallerEvidence(data){
    var isElixir=function(f){return /\.exs?$/.test(f.file||f.path||'');};
    var deadFunctions=data.deadFunctions.map(function(f){return isElixir(f)?Object.assign({},f,{certainty:'unverified',evidence:'source analysis'}):f;});
    var fnStats=Object.assign({},data.fnStats);
    Object.keys(fnStats).forEach(function(key){
        var stat=fnStats[key];
        if(isElixir(stat)&&stat.internal===0&&stat.external===0)fnStats[key]=Object.assign({},stat,{usageCertainty:'unverified'});
    });
    var issues=data.issues.map(function(issue){
        if(!/ Unused Functions$/.test(issue.title)&&issue.evidence!=='elixir-callers')return issue;
        if(!issue.items.some(isElixir))return issue;
        return Object.assign({},issue,{title:issue.items.length+' Functions Without Observed Callers',
            desc:'Source analysis found no callers. Elixir callbacks, macros and dynamic dispatch may invoke these functions; this is not evidence that they are unused.',
            evidence:'elixir-callers',certainty:'unverified',items:issue.items.map(function(f){return isElixir(f)?Object.assign({},f,{certainty:'unverified',evidence:'source analysis'}):f;})});
    });
    var suggestions=data.suggestions.map(function(suggestion){
        if(suggestion.title!=='Remove Dead Code'||!deadFunctions.some(function(f){return f.certainty==='unverified';}))return suggestion;
        return Object.assign({},suggestion,{title:'Review Functions Without Observed Callers',
            desc:'Source analysis did not find callers for these functions. Check callbacks and dynamic invocation before deciding whether any can be removed.',
            action:'Review caller evidence in the Issues panel',impact:'Identify candidates for further investigation',certainty:'unverified'});
    });
    return Object.assign({},data,{deadFunctions:deadFunctions,fnStats:fnStats,issues:issues,suggestions:suggestions});
}
