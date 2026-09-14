function calcBlast(fileId,conns,files){
    // Comprehensive impact analysis for a file
    // Connection format: {source: fileDefiningFn, target: fileCallingFn, fn: fnName, count: callCount}

    // Build adjacency lists for fast lookups
    var exportedTo={};// fileId -> Set of files that import from it
    var importedFrom={};// fileId -> Set of files it imports from
    var exportedFns={};// fileId -> Map of fn -> count of external calls

    conns.forEach(function(c){
        var src=typeof c.source==='object'?c.source.id:c.source;
        var tgt=typeof c.target==='object'?c.target.id:c.target;
        // src exports, tgt imports
        if(!exportedTo[src])exportedTo[src]=new Set();
        exportedTo[src].add(tgt);
        if(!importedFrom[tgt])importedFrom[tgt]=new Set();
        importedFrom[tgt].add(src);
        if(c.evidence==='mix xref')return; // File references are not function calls.
        if(!exportedFns[src])exportedFns[src]=new Map();
        var fnMap=exportedFns[src];
        fnMap.set(c.fn,(fnMap.get(c.fn)||0)+(c.count||1));
    });

    // 1. Direct dependents (files that directly import from this file)
    var directDeps=exportedTo[fileId]?Array.from(exportedTo[fileId]):[];

    // 2. Transitive dependents (BFS with depth tracking)
    var transitive=new Map();// fileId -> depth
    var queue=directDeps.map(function(f){return{file:f,depth:1};});
    var visited=new Set([fileId].concat(directDeps));
    while(queue.length>0){
        var item=queue.shift();
        if(item.depth>3)continue;// Limit depth to 3 for transitive
        transitive.set(item.file,item.depth);
        var nextDeps=exportedTo[item.file]||new Set();
        nextDeps.forEach(function(f){
            if(!visited.has(f)){
                visited.add(f);
                queue.push({file:f,depth:item.depth+1});
            }
        });
    }

    // 3. Functions exported (how many of this file's functions are used)
    var fnUsage=exportedFns[fileId]||new Map();
    var fnsUsed=fnUsage.size;
    var totalCalls=0;
    fnUsage.forEach(function(cnt){totalCalls+=cnt;});

    // 4. Dependencies (files this file imports from - its risk)
    var dependencies=importedFrom[fileId]?Array.from(importedFrom[fileId]):[];

    // 5. Calculate weighted impact score
    // Direct deps count fully, transitive count with decay
    var impactScore=directDeps.length;
    transitive.forEach(function(depth,f){
        if(depth>1)impactScore+=1/depth;// 0.5 for depth 2, 0.33 for depth 3
    });

    // 6. Calculate centrality (how connected is this file)
    var centrality=directDeps.length+dependencies.length+fnsUsed;

    // Determine level based on direct dependents and functions used
    var level='low';
    var connectedFiles=files.filter(function(f){return exportedTo[f.path]||importedFrom[f.path];}).length;
    var relativePct=connectedFiles>0?Math.round(directDeps.length/connectedFiles*100):0;

    if(directDeps.length>=8||fnsUsed>=5)level='critical';
    else if(directDeps.length>=4||fnsUsed>=3)level='high';
    else if(directDeps.length>=2||fnsUsed>=1)level='medium';

    return{
        affected:directDeps,
        transitive:Array.from(transitive.keys()),
        count:directDeps.length,
        transitiveCount:transitive.size,
        percent:relativePct,
        level:level,
        depth:transitive.size>0?Math.max.apply(null,Array.from(transitive.values())):0,
        fnsUsed:fnsUsed,
        totalCalls:totalCalls,
        dependencies:dependencies,
        impactScore:Math.round(impactScore*10)/10,
        centrality:centrality
    };
}

function calcHealth(data){
    if(!data)return{score:0,grade:'F'};
    var score=100;
    var assessedDead=data.deadFunctions?data.deadFunctions.filter(function(f){return f.certainty!=='unverified';}).length:data.stats.dead;
    var deadPct=data.stats.functions>0?(assessedDead/data.stats.functions*100):0;
    score-=Math.min(20,deadPct);
    var circular=data.issues.filter(function(i){return i.title.includes('Circular');}).length;
    score-=Math.min(20,circular*5);
    var god=data.issues.filter(function(i){return i.title.includes('Large');}).length;
    score-=Math.min(15,god*3);
    var avgCoup=data.stats.files>0?(data.stats.connections/data.stats.files):0;
    score-=Math.min(15,Math.max(0,avgCoup-3)*2);
    var sec=data.securityIssues?data.securityIssues.filter(function(i){return i.severity==='high';}).length:0;
    score-=Math.min(20,sec*5);
    score=Math.max(0,Math.round(score));
    var grade='F';
    if(score>=90)grade='A';else if(score>=80)grade='B';else if(score>=70)grade='C';else if(score>=60)grade='D';
    return{score:score,grade:grade};
}


export {calcBlast,calcHealth};
