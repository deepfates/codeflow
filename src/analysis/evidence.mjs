import {findBlockByFile,getVisibleArchitectureBlocks,computeArchitectureStats,generateMermaidBlockDiagram} from './architecture.mjs';

function buildBeamAnalysisData(options){
    var data=options.data;
    var snapshot=options.snapshot||{schemaVersion:1,status:'unavailable',nodes:[],edges:[],warnings:['Compiler evidence unavailable']};
    var compiled=new Set((snapshot.nodes||[]).map(function(n){return n.path;}));
    var files=data.files.map(function(f){return Object.assign({},f,{compiled:compiled.has(f.path)});});
    var included=new Set(files.map(function(f){return f.path;}));
    var connections=data.connections.filter(function(c){return c.evidence!=='mix xref';}).map(function(c){return Object.assign({},c,{evidence:c.evidence||'source analysis'});});
    var seen=new Set();
    (snapshot.status==='ready'?snapshot.edges||[]:[]).forEach(function(e){
        if(!included.has(e.source)||!included.has(e.target))return;
        var key=JSON.stringify([e.source,e.target,e.kind]);
        if(seen.has(key))return;
        seen.add(key);
        // Native arrows run from provider to consumer; Mix uses the reverse.
        connections.push({source:e.target,target:e.source,kind:e.kind,evidence:'mix xref',fn:null,count:1});
    });
    var architectureDiagram=data.architectureDiagram;
    if(architectureDiagram){
        var dependencies=architectureDiagram.dependencies.filter(function(dep){return dep.evidence!=='mix xref';});
        connections.filter(function(c){return c.evidence==='mix xref';}).forEach(function(c){
            // Architecture arrows describe the consumer depending on a provider.
            var from=findBlockByFile(architectureDiagram.blocks,c.target);
            var to=findBlockByFile(architectureDiagram.blocks,c.source);
            if(from&&to&&from.id!==to.id)dependencies.push({from:from.id,to:to.id,kind:c.kind,label:c.kind+' reference',confidence:'high',evidence:'mix xref'});
        });
        var dependencyKeys=new Set();
        dependencies=dependencies.filter(function(dep){var key=JSON.stringify([dep.from,dep.to,dep.kind,dep.label,dep.evidence||'source analysis']);if(dependencyKeys.has(key))return false;dependencyKeys.add(key);return true;});
        architectureDiagram=Object.assign({},architectureDiagram,{dependencies:dependencies});
        var visibleBlocks=getVisibleArchitectureBlocks(architectureDiagram.blocks,false,false);
        var visibleIds=new Set(visibleBlocks.map(function(block){return block.id;}));
        architectureDiagram.stats=Object.assign({},architectureDiagram.stats,computeArchitectureStats(visibleBlocks,dependencies.filter(function(dep){return visibleIds.has(dep.from)&&visibleIds.has(dep.to);})));
        architectureDiagram.mermaid=generateMermaidBlockDiagram(architectureDiagram,false,false);
    }
    return Object.assign({},data,{files:files,connections:connections,architectureDiagram:architectureDiagram,
        beam:Object.assign({},snapshot,{coverage:{compiled:(snapshot.nodes||[]).length,included:files.filter(function(f){return f.compiled;}).length}}),
        stats:Object.assign({},data.stats,{connections:connections.length})});
}

function enrichAnalysisFindings(data,providers){
    var ids=new Set(providers.map(function(p){return p.id;}));
    var issues=data.issues.filter(function(issue){return !ids.has(issue.provider);});
    var assessments=Object.assign({},data.assessments);
    providers.forEach(function(provider){
        assessments[provider.id]={name:provider.name,status:provider.status,reason:provider.reason||null};
        var seen=new Set();
        (provider.findings||[]).forEach(function(finding){
            var location={path:finding.path||null,range:finding.range||null};
            var key=JSON.stringify([location,finding.message,finding.check||finding.code]);
            if(seen.has(key))return;seen.add(key);
            // LSP information and hints are not warnings. Keep the original
            // diagnostic alongside the application's existing severity groups.
            var type=({1:'critical',2:'warning',3:'info',4:'info'})[finding.severity]||'warning';
            issues.push({provider:provider.id,evidence:provider.name,type:type,
                title:finding.message,desc:provider.name+(finding.check?' · '+finding.check:''),
                sourceLocation:location,finding:finding,
                items:[{name:finding.message,file:location.path,line:location.range?location.range.start.line+1:null}]});
        });
    });
    return Object.assign({},data,{issues:issues,assessments:assessments});
}
export {buildBeamAnalysisData,enrichAnalysisFindings};
