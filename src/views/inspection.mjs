import {runtimeAncestors} from '../project/runtime-index.mjs';

export function createInspectionPanels(React){
    const {useRef,useEffect}=React;
    function Symbols({items,path,onOpen,onReferences}){
        return items.map(function(symbol,i){return React.createElement('div',{key:i,style:{paddingLeft:8}},
            React.createElement('div',{style:{display:'flex',gap:6,marginBottom:4}},
                React.createElement('button',{className:'top-btn',style:{flex:1,textAlign:'left',overflowWrap:'anywhere'},onClick:function(){onOpen({path:path,range:symbol.selectionRange||symbol.range});}},symbol.name),
                React.createElement('button',{className:'top-btn',title:'Find references',onClick:function(){onReferences(path,(symbol.selectionRange||symbol.range).start);}},'Refs')),
            symbol.children&&React.createElement(Symbols,{items:symbol.children,path,onOpen,onReferences}));});
    }
    function SourceNavigation({path,symbols,locations,error,onOpen,onReferences}){
        return React.createElement(React.Fragment,null,
            error&&React.createElement('p',{role:'status'},error),
            symbols.length>0&&React.createElement('div',{className:'card'},React.createElement('div',{className:'card-header'},'Outline'),React.createElement('div',{className:'card-body'},React.createElement(Symbols,{items:symbols,path,onOpen,onReferences}))),
            locations&&React.createElement('div',{className:'card'},React.createElement('div',{className:'card-header'},locations.title),React.createElement('div',{className:'card-body'},
                locations.items.length===0?'No locations found.':locations.items.map(function(location,i){return React.createElement('button',{key:i,className:'top-btn',style:{display:'block',width:'100%',textAlign:'left',marginBottom:5},onClick:function(){onOpen(location);}},(location.path||location.uri)+':'+(location.range.start.line+1));}))));
    }
    function AnalysisTools({assessments}){
        return Object.keys(assessments||{}).map(function(id){var tool=assessments[id];
            return React.createElement('details',{key:id,style:{marginBottom:8}},
                React.createElement('summary',null,tool.name+' · '+tool.status),
                tool.reason&&React.createElement('pre',{style:{whiteSpace:'pre-wrap'}},tool.reason));
        });
    }
    function SourceFindings({summary,onOpen}){
        if(!summary?.count)return null;
        // A native assessment can describe several symbols in this file. Keep
        // that explanation once, with each original item as a source link.
        const groups=new Map();
        for(const entry of summary.entries){
            if(!groups.has(entry.issue))groups.set(entry.issue,[]);
            groups.get(entry.issue).push(entry);
        }
        return React.createElement('div',{className:'card','aria-label':'File findings'},
            React.createElement('div',{className:'card-header'},'Findings (',summary.count,')'),
            React.createElement('div',{className:'card-body'},Array.from(groups,([issue,entries],i)=>{
                const grouped=entries[0].kind==='issue'&&!issue.sourceLocation;
                return React.createElement('div',{key:i,style:{marginBottom:10}},
                    grouped&&React.createElement('div',{style:{fontSize:11,color:'var(--t2)',marginBottom:6}},issue.desc||issue.title),
                    entries.map((entry,j)=>{
                        const location=entry.sourceLocation;
                        const line=location.range?location.range.start.line+1:location.line;
                        return React.createElement('button',{key:j,className:'top-btn',style:{display:'block',width:'100%',textAlign:'left',whiteSpace:'normal',marginBottom:6},onClick:()=>onOpen(location)},
                            React.createElement('div',null,grouped?(entry.item?.name||location.path):(issue.title||issue.message||issue.type)),
                            React.createElement('div',{style:{fontSize:10,color:'var(--t3)'}},issue.provider||(entry.kind==='security'?'Security':'Source analysis'),line?' · L'+line:''));
                    }));
            })));
    }
    function SourceProcesses({index,path,onSelect}){
        const processes=index.processesBySource.get(path)||[];
        return processes.length>0&&React.createElement('div',{className:'card'},
            React.createElement('div',{className:'card-header'},'Running processes'),
            React.createElement('div',{className:'card-body'},processes.map(function(process){return React.createElement('button',{key:process.id,className:'top-btn',onClick:function(){onSelect(process.id);}},process.label||process.module, ' ',process.pid);})));
    }
    function RuntimePanel({index,inspection,onOpen}){
        const {snapshot,node,busy,focus}=inspection;
        const processes=index.processesById,focusAncestors=runtimeAncestors(index,focus);
        const panel=useRef(null);
        useEffect(()=>{
            if(!focus)return;
            const frame=requestAnimationFrame(()=>{
                const row=Array.from(panel.current?.querySelectorAll('[data-process-id]')||[]).find(el=>el.dataset.processId===focus);
                row?.scrollIntoView({block:'center'});
            });
            return ()=>cancelAnimationFrame(frame);
        },[focus,index]);
        function processTree(id,seen){
            var process=processes.get(id);if(!process||seen.has(id))return null;
            var next=new Set(seen);next.add(id);
            return React.createElement('details',{key:id,'data-process-id':id,open:process.type==='supervisor'||focusAncestors.has(id),style:{margin:'8px 0 8px 10px',outline:id===focus?'1px solid var(--acc)':undefined}},
                React.createElement('summary',null,process.label||process.module||process.pid),
                React.createElement('div',{style:{color:'var(--t3)',margin:'6px 0'}},process.pid,' · ',process.metrics&&process.metrics.status,' · queue ',process.metrics&&process.metrics.messageQueueLength,' · ',process.metrics&&process.metrics.memory,' B · ',process.metrics&&process.metrics.reductions,' reductions'),
                index.processesBySource.has(process.sourcePath)&&React.createElement('button',{className:'top-btn',onClick:function(){onOpen({path:process.sourcePath});}},'Source'),
                (process.children||[]).map(function(child){return processTree(child,next);}));
        }
        return React.createElement('div',{ref:panel},
            React.createElement('form',{onSubmit:function(event){event.preventDefault();inspection.connect();},style:{display:'flex',gap:6,marginBottom:12}},
                React.createElement('input',{value:node,onChange:function(e){inspection.setNode(e.target.value);},placeholder:'name@hostname','aria-label':'BEAM node',style:{minWidth:0,flex:1}}),
                React.createElement('button',{className:'top-btn',disabled:busy||!node.trim(),type:'submit'},busy?'Connecting…':snapshot&&snapshot.status==='ready'?'Refresh':'Connect')),
            snapshot&&snapshot.status!=='ready'&&React.createElement('p',{role:'status'},snapshot.reason||snapshot.error||(snapshot.warnings||[]).join(' ')||'Runtime unavailable'),
            snapshot&&snapshot.status==='ready'&&React.createElement(React.Fragment,null,
                React.createElement('div',{style:{color:'var(--t3)'}},'Snapshot · '+new Date(snapshot.collectedAt).toLocaleTimeString()),
                index.applications.map(function(app){return React.createElement('details',{key:app.name,open:focusAncestors.has(app.rootId)},React.createElement('summary',{style:{padding:'8px 0'}},app.name),processTree(app.rootId,new Set()));}),
                React.createElement('details',{open:index.roots.some(p=>focusAncestors.has(p.id))},React.createElement('summary',{style:{padding:'8px 0'}},'Other processes'),index.roots.map(function(p){return processTree(p.id,new Set());})),
                (snapshot.warnings||[]).map(function(warning,i){return React.createElement('p',{key:i,role:'status'},warning);})));
    }
    return {SourceNavigation,AnalysisTools,SourceProcesses,SourceFindings,RuntimePanel};
}
