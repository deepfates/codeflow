import {calcHealth} from '../analysis/metrics.mjs';
import {functionKey} from './identity.mjs';

// A report is a projection of supplied analysis, independent of browser state.
export function buildAnalysisReport({data,repository,analyzedAt}){
    var repo=repository,h=calcHealth(data);
    var report={
        assessments:data.assessments||{},
        repository:repo,
        analyzedAt:analyzedAt,
        codeflowVersion:'1.0',
        summary:{
            healthScore:h.score,
            healthGrade:h.grade,
            totalFiles:data.stats.files,
            totalFunctions:data.stats.functions,
            totalConnections:data.stats.connections,
            linesOfCode:data.stats.loc,
            unusedFunctions:data.stats.dead,
            securityIssues:data.securityIssues.length,
            patterns:data.patterns.length,
            duplicates:data.stats.duplicates||0,
            layerViolations:data.stats.violations||0,
            highSecurityIssues:data.stats.security||0
        },
        files:data.files.map(function(f){
            var fns=f.functions.map(function(fn){
                var statKey=fn.key||functionKey(fn);
                var st=data.fnStats[statKey]||data.fnStats[fn.name];
                return{
                    key:statKey,
                    name:fn.name,
                    line:fn.line,
                    internalCalls:st?st.internal:0,
                    externalCalls:st?st.external:0,
                    totalCalls:st?(st.internal+st.external):0,
                    isUnused:st&&st.usageCertainty==='unverified'?null:st?(st.internal+st.external===0):null,
                    usageCertainty:st&&st.usageCertainty||'source analysis',
                    isExported:st?st.isExported:false,
                    isClassMethod:st?st.isClassMethod:false,
                    isTopLevel:st?st.isTopLevel:true,
                    type:st?st.type:'function',
                    callers:st&&st.callers?st.callers.map(function(c){return{file:c.file,name:c.name,count:c.count};}):[],
                    code:fn.code
                };
            });
            return{
                path:f.path,
                name:f.name,
                folder:f.folder,
                layer:f.layer,
                lines:f.lines,
                churn:f.churn||0,
                isCode:f.isCode!==false,
                functions:fns,
                functionCount:f.functions.length
            };
        }),
        unusedFunctions:data.deadFunctions.map(function(fn){return{name:fn.name,file:fn.file,folder:fn.folder,line:fn.line,codeLines:fn.codeLines,code:fn.code,extension:fn.ext,certainty:fn.certainty,evidence:fn.evidence};}),
        dependencies:data.connections.map(function(c){
            var src=typeof c.source==='object'?c.source.id:c.source;
            var tgt=typeof c.target==='object'?c.target.id:c.target;
            var kind=c.kind||(c.fn?'call-reference':'reference');
            var isCall=kind==='call-reference';
            return{...c,source:src,target:tgt,from:src,to:tgt,function:isCall?c.fn:null,
                callCount:isCall?c.count:null,referenceCount:c.count,kind:kind,evidence:c.evidence||'source analysis'};
        }),
        architectureIssues:data.issues.map(function(i){return{type:i.type,title:i.title,description:i.desc,provider:i.provider,evidence:i.evidence,certainty:i.certainty,sourceLocation:i.sourceLocation,affectedFiles:i.items?i.items.map(function(x){return x.path||x.file||x.name;}):[],affectedItems:i.items||[]};}),
        patterns:data.patterns.map(function(p){return{name:p.name,description:p.desc,isAntiPattern:p.isAnti||false,severity:p.severity||'info',icon:p.icon||'',files:p.files.map(function(f){return f.path||f.name;}),fileDetails:p.files||[],metrics:p.metrics||{}};}),
        securityIssues:data.securityIssues.map(function(s){return{severity:s.severity,title:s.title,description:s.desc,file:s.file,path:s.path,line:s.line,code:s.code};}),
        duplicates:data.duplicates||[],
        layerViolations:data.layerViolations||[],
        suggestions:data.suggestions||[],
        languageBreakdown:data.stats.languages||[],
        folderStructure:data.folders,
        functionStatistics:Object.keys(data.fnStats||{}).map(function(fnKey){
            var st=data.fnStats[fnKey];
            return{
                key:fnKey,
                name:st.name||fnKey,
                file:st.file,
                folder:st.folder,
                line:st.line,
                internalCalls:st.internal,
                externalCalls:st.external,
                totalCalls:st.count||(st.internal+st.external),
                isExported:st.isExported,
                isClassMethod:st.isClassMethod,
                isTopLevel:st.isTopLevel,
                type:st.type,
                callers:st.callers?st.callers.map(function(c){return{file:c.file,name:c.name,count:c.count};}):[],
                code:st.code
            };
        })
    };
    return report;
}

function affectedLabel(item){
    if(typeof item==='string')return item;
    const path=item.path||item.file||item.sourceLocation?.path;
    const label=item.name||item.title;
    const line=item.line||((item.sourceLocation?.range?.start.line??-1)+1);
    const primary=(path||label||'Unknown source')+(line?':'+line:'')+(path&&label&&label!==path?' · '+label:'');
    const related=Array.isArray(item.files)?item.files.map(affectedLabel):[];
    return primary+(item.toFile?' → '+affectedLabel(item.toFile):'')+(related.length?' ['+related.join(', ')+']':'');
}
function dependencyLabel(edge){
    const count=edge.referenceCount;
    return edge.from+' -> '+edge.to+' ('+edge.kind+'; '+edge.evidence+
        (count==null?'':'; '+count+' reference'+(count===1?'':'s'))+(edge.fn?'; '+edge.fn:'')+')';
}

export function generateAnalysisReport({data,repository,analyzedAt,format}){
    const report=buildAnalysisReport({data,repository,analyzedAt});
    const repo=repository,h={score:report.summary.healthScore,grade:report.summary.healthGrade};
    if(format==='json')return {content:JSON.stringify(report,null,2),mimeType:'application/json',filename:'codeflow-report.json'};
    if(format==='md'){
        var md='# CodeFlow Analysis Report\n\n';
        md+='**Repository:** '+repo+'\n';
        md+='**Analyzed:** '+analyzedAt+'\n\n';
        md+='## Summary\n\n';
        md+='| Metric | Value |\n|--------|-------|\n';
        md+='| Health Score | '+h.score+'/100 ('+h.grade+') |\n';
        md+='| Files | '+data.stats.files+' |\n';
        md+='| Functions | '+data.stats.functions+' |\n';
        md+='| Lines of Code | '+data.stats.loc.toLocaleString()+' |\n';
        md+='| Dependencies | '+data.stats.connections+' |\n';
        md+='| Functions without observed callers | '+data.stats.dead+' |\n';
        md+='| Security Issues | '+data.securityIssues.length+' |\n\n';
        if(data.securityIssues.length>0){
            md+='## Security Issues\n\n';
            data.securityIssues.forEach(function(s){
                md+='### '+s.severity.toUpperCase()+': '+s.title+'\n';
                md+='- **File:** `'+s.path+'`'+(s.line?' (line '+s.line+')':'')+'\n';
                md+='- **Description:** '+s.desc+'\n';
                if(s.code)md+='- **Code:** `'+s.code+'`\n';
                md+='\n';
            });
        }
        if(data.deadFunctions.length>0){
            md+='## Functions Without Observed Callers ('+data.deadFunctions.length+')\n\n';
            md+='Source analysis found no callers; runtime usage is not established:\n\n';
            data.deadFunctions.forEach(function(fn){
                md+='### `'+fn.name+'`\n';
                md+='- **File:** `'+fn.file+'`\n';
                md+='- **Line:** '+fn.line+'\n';
                md+='- **Lines of code:** '+fn.codeLines+'\n';
                if(fn.code)md+='```\n'+fn.code+'\n```\n';
                md+='\n';
            });
        }
        if(data.patterns.length>0){
            md+='## Design Patterns\n\n';
            data.patterns.filter(function(p){return!p.isAnti;}).forEach(function(p){
                md+='### '+p.name+'\n';
                md+=p.desc+'\n\n';
                md+='**Files:** '+p.files.map(function(f){return'`'+(f.path||f.name)+'`';}).join(', ')+'\n\n';
            });
            var antiPatterns=data.patterns.filter(function(p){return p.isAnti;});
            if(antiPatterns.length>0){
                md+='## Anti-Patterns\n\n';
                antiPatterns.forEach(function(p){
                    md+='### '+p.name+'\n';
                    md+=p.desc+'\n\n';
                    md+='**Affected files:** '+p.files.map(function(f){return'`'+(f.path||f.name)+'`';}).join(', ')+'\n\n';
                });
            }
        }
        if(data.issues.length>0){
            md+='## Architecture Issues\n\n';
            data.issues.forEach(function(i){
                md+='### '+i.title+'\n';
                md+=i.desc+'\n\n';
                if(i.items)md+='**Affected:** '+i.items.map(function(x){return'`'+affectedLabel(x)+'`';}).join(', ')+'\n\n';
            });
        }
        md+='## File Details\n\n';
        md+='| File | Folder | Layer | Lines | Functions |\n';
        md+='|------|--------|-------|-------|----------|\n';
        data.files.forEach(function(f){
            md+='| `'+f.path+'` | '+f.folder+' | '+f.layer+' | '+f.lines+' | '+f.functions.length+' |\n';
        });
        md+='\n## Dependencies\n\n';
        report.dependencies.forEach(function(c){md+='- '+dependencyLabel(c)+'\n';});
        return {content:md,mimeType:'text/markdown',filename:'codeflow-report.md'};
    }
    if(format==='txt'){
        var txt='CODEFLOW ANALYSIS REPORT\n';
        txt+='========================\n\n';
        txt+='Repository: '+repo+'\n';
        txt+='Analyzed: '+analyzedAt+'\n\n';
        txt+='SUMMARY\n-------\n';
        txt+='Health Score: '+h.score+'/100 (Grade: '+h.grade+')\n';
        txt+='Files: '+data.stats.files+'\n';
        txt+='Functions: '+data.stats.functions+'\n';
        txt+='Lines of Code: '+data.stats.loc.toLocaleString()+'\n';
        txt+='Dependencies: '+data.stats.connections+'\n';
        txt+='Functions without observed callers: '+data.stats.dead+'\n';
        txt+='Security Issues: '+data.securityIssues.length+'\n\n';
        if(data.securityIssues.length>0){
            txt+='SECURITY ISSUES\n---------------\n';
            data.securityIssues.forEach(function(s,i){
                txt+=(i+1)+'. ['+s.severity.toUpperCase()+'] '+s.title+'\n';
                txt+='   File: '+s.path+(s.line?' (line '+s.line+')':'')+'\n';
                txt+='   '+s.desc+'\n';
                if(s.code)txt+='   Code: '+s.code+'\n';
                txt+='\n';
            });
        }
        if(data.deadFunctions.length>0){
            txt+='FUNCTIONS WITHOUT OBSERVED CALLERS ('+data.deadFunctions.length+')\n'+'-'.repeat(20)+'\n';
            txt+='Source analysis found no callers; runtime usage is not established:\n\n';
            data.deadFunctions.forEach(function(fn,i){
                txt+=(i+1)+'. '+fn.name+'\n';
                txt+='   File: '+fn.file+' (line '+fn.line+')\n';
                txt+='   Lines: '+fn.codeLines+'\n';
                if(fn.code){txt+='   Code:\n';fn.code.split('\n').forEach(function(line){txt+='      '+line+'\n';});}
                txt+='\n';
            });
        }
        if(data.patterns.length>0){
            txt+='PATTERNS DETECTED\n-----------------\n';
            data.patterns.forEach(function(p){
                txt+=(p.isAnti?'[ANTI-PATTERN] ':'')+p.name+'\n';
                txt+='  '+p.desc+'\n';
                txt+='  Files: '+p.files.map(function(f){return f.path||f.name;}).join(', ')+'\n\n';
            });
        }
        if(data.issues.length>0){
            txt+='ARCHITECTURE ISSUES\n-------------------\n';
            data.issues.forEach(function(i){
                txt+='['+i.type.toUpperCase()+'] '+i.title+'\n';
                txt+='  '+i.desc+'\n';
                if(i.items)txt+='  Affected: '+i.items.map(function(x){return affectedLabel(x);}).join(', ')+'\n';
                txt+='\n';
            });
        }
        txt+='FILE LIST\n---------\n';
        data.files.forEach(function(f){
            txt+=f.path+' ('+f.lines+' lines, '+f.functions.length+' functions, '+f.layer+')\n';
        });
        txt+='\nDEPENDENCIES\n------------\n';
        report.dependencies.forEach(function(c){txt+=dependencyLabel(c)+'\n';});
        return {content:txt,mimeType:'text/plain',filename:'codeflow-report.txt'};
    }
    throw new Error('Unsupported report format: '+format);
}
