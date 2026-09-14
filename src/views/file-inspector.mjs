import {functionKey} from '../project/identity.mjs';

// Inspection owns its disclosure and asynchronous ownership presentation. Source
// navigation and graph impact remain shared with the surrounding investigation.
export function createFileInspector({React,Icon,colors:COLORS}){
    const {useState,useEffect}=React;
    const iconLabel=(name,label)=>React.createElement(React.Fragment,null,React.createElement(Icon,{name,size:'s'}),' ',label);
    return function FileInspector({file:selected,analysis:data,blastRadius,readOwnership,onLocate,onPreview,onBack,children}){
        const [expandedCards,setExpandedCards]=useState(()=>new Set(['blast','fns']));
        const [expandedFns,setExpandedFns]=useState(()=>new Set());
        const [ownership,setOwnership]=useState(null);
        const [ownerLoading,setOwnerLoading]=useState(false);
        useEffect(()=>{setExpandedFns(new Set());},[selected.path]);
        useEffect(()=>{
            let cancelled=false;
            setOwnership(null);setOwnerLoading(Boolean(readOwnership));
            if(readOwnership)Promise.resolve().then(()=>readOwnership(selected.path)).then(owners=>{
                if(!cancelled){setOwnership(owners);setOwnerLoading(false);}
            },()=>{if(!cancelled)setOwnerLoading(false);});
            return ()=>{cancelled=true;};
        },[selected.path,readOwnership]);
        const toggleCard=id=>setExpandedCards(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});
        const toggleFn=id=>setExpandedFns(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next;});
        return React.createElement(React.Fragment,null,
            React.createElement('button',{className:'top-btn',style:{width:'100%',marginBottom:12},onClick:onBack},'← Back to Issues'),
            React.createElement('div',{className:'panel-header',style:{margin:'0 -12px 12px',padding:12}},
                React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}},
                    React.createElement('div',null,
                        React.createElement('div',{className:'panel-title'},React.createElement(Icon,{name:'file',size:'m'}),' ',selected.name),
                        React.createElement('div',{className:'panel-subtitle'},selected.folder||'root',' • ',selected.layer,' • ',selected.lines,' lines',selected.complexity&&selected.complexity.score>0?' • Complexity: '+selected.complexity.score:'')
                    ),
                    React.createElement('button',{className:'view-file-btn',onClick:function(){onPreview(selected.path);}},iconLabel('eye','View Source'))
                )
            ),
            children,
            blastRadius&&React.createElement('div',{className:'card',style:{marginBottom:12}},
                React.createElement('div',{className:'card-header',onClick:function(){toggleCard('blast');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('blast')?' open':'')},'▶'),React.createElement(Icon,{name:'impact',size:'s'}),' Impact Analysis'),React.createElement('span',{className:'badge badge-'+(blastRadius.level==='low'?'success':blastRadius.level==='medium'?'warning':'danger')},blastRadius.level.toUpperCase())),
                expandedCards.has('blast')&&React.createElement('div',{className:'card-body'},
                    React.createElement('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}},
                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--acc)'}},blastRadius.count),
                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Direct Dependents')
                        ),
                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--purple)'}},blastRadius.transitiveCount||0),
                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Transitive')
                        ),
                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--green)'}},blastRadius.fnsUsed||0),
                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Fns Exported')
                        ),
                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--orange)'}},(blastRadius.dependencies||[]).length),
                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Dependencies')
                        )
                    ),
                    (blastRadius.count>0||blastRadius.fnsUsed>0)&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginBottom:8,padding:'6px 8px',background:'var(--bg0)',borderRadius:4}},
                        blastRadius.count>0?blastRadius.count+' file'+(blastRadius.count>1?'s':'')+' directly depend on this file':'',
                        blastRadius.count>0&&blastRadius.fnsUsed>0?' • ':'',
                        blastRadius.fnsUsed>0?blastRadius.fnsUsed+' function'+(blastRadius.fnsUsed>1?'s':'')+' used '+blastRadius.totalCalls+' times':''
                    ),
                    blastRadius.affected.length>0&&React.createElement('div',{className:'blast-detail'},
                        React.createElement('div',{style:{fontSize:9,fontWeight:600,marginBottom:6}},'Files that import from this:'),
                        blastRadius.affected.slice(0,8).map(function(path){return React.createElement('div',{key:path,className:'blast-file',onClick:function(){onLocate(path);}},React.createElement(Icon,{name:'file',size:'s'}),' ',path.split('/').pop());}),
                        blastRadius.affected.length>8&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginTop:4}},'+',blastRadius.affected.length-8,' more')
                    ),
                    (blastRadius.dependencies||[]).length>0&&React.createElement('div',{className:'blast-detail',style:{marginTop:8}},
                        React.createElement('div',{style:{fontSize:9,fontWeight:600,marginBottom:6,color:'var(--orange)'}},'Dependencies (risk if these change):'),
                        blastRadius.dependencies.slice(0,5).map(function(path){return React.createElement('div',{key:path,className:'blast-file',onClick:function(){onLocate(path);}},React.createElement(Icon,{name:'file',size:'s'}),' ',path.split('/').pop());}),
                        blastRadius.dependencies.length>5&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginTop:4}},'+',blastRadius.dependencies.length-5,' more')
                    )
                )
            ),
            (function(){
                var outgoing=[],incoming=[];
                var connByFile={out:{},in:{}};
                data.connections.forEach(function(c){
                    var src=typeof c.source==='object'?c.source.id:c.source;
                    var tgt=typeof c.target==='object'?c.target.id:c.target;
                    if(src===selected.path){
                        if(!connByFile.out[tgt])connByFile.out[tgt]={file:tgt,fns:[]};
                        connByFile.out[tgt].fns.push({name:c.evidence==='mix xref'?c.kind:c.fn,count:c.count,evidence:c.evidence});
                    }
                    if(tgt===selected.path){
                        if(!connByFile.in[src])connByFile.in[src]={file:src,fns:[]};
                        connByFile.in[src].fns.push({name:c.evidence==='mix xref'?c.kind:c.fn,count:c.count,evidence:c.evidence});
                    }
                });
                outgoing=Object.values(connByFile.out).sort(function(a,b){return b.fns.length-a.fns.length;});
                incoming=Object.values(connByFile.in).sort(function(a,b){return b.fns.length-a.fns.length;});
                var totalConns=outgoing.length+incoming.length;
                return totalConns>0&&React.createElement('div',{className:'card',style:{marginBottom:12}},
                    React.createElement('div',{className:'card-header',onClick:function(){toggleCard('conns');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('conns')?' open':'')},'▶'),React.createElement(Icon,{name:'link',size:'s'}),' Connections'),React.createElement('span',{className:'badge badge-default'},totalConns)),
                    expandedCards.has('conns')&&React.createElement('div',{className:'card-body',style:{padding:0}},
                        outgoing.length>0&&React.createElement(React.Fragment,null,
                            React.createElement('div',{style:{fontSize:9,fontWeight:600,color:'var(--t3)',padding:'8px 12px',background:'var(--bg2)',borderBottom:'1px solid var(--border)'}},'Used by (',outgoing.length,' files)'),
                            outgoing.map(function(conn){
                                var isOpen=expandedCards.has('conn-out-'+conn.file);
                                return React.createElement('div',{key:conn.file,className:'conn-item'},
                                    React.createElement('div',{className:'conn-header',onClick:function(e){e.stopPropagation();toggleCard('conn-out-'+conn.file);}},
                                        React.createElement('span',{className:'card-toggle'+(isOpen?' open':''),style:{fontSize:8,marginRight:6}},'▶'),
                                        React.createElement('span',{className:'conn-file-icon'},React.createElement(Icon,{name:'file',size:'s'})),
                                        React.createElement('span',{className:'conn-file-name'},conn.file.split('/').pop()),
                                        React.createElement('span',{className:'badge badge-default',style:{marginLeft:'auto'}},conn.fns.length,' relationship',conn.fns.length!==1?'s':'')
                                    ),
                                    isOpen&&React.createElement('div',{className:'conn-fns'},
                                        conn.fns.map(function(fn,i){return React.createElement('div',{key:i,className:'conn-fn'},
                                            React.createElement('span',{className:'conn-fn-name'},fn.name,fn.evidence==='mix xref'?'':'()'),
                                            React.createElement('span',{className:'conn-fn-count'},fn.evidence==='mix xref'?'mix xref':fn.count+'×')
                                        );}),
                                        React.createElement('div',{className:'conn-goto',onClick:function(){onLocate(conn.file);}},'→ View ',conn.file.split('/').pop())
                                    )
                                );
                            }),
                        ),
                        incoming.length>0&&React.createElement(React.Fragment,null,
                            React.createElement('div',{style:{fontSize:9,fontWeight:600,color:'var(--t3)',padding:'8px 12px',background:'var(--bg2)',borderBottom:'1px solid var(--border)',borderTop:outgoing.length>0?'1px solid var(--border)':'none'}},'Depends on (',incoming.length,' files)'),
                            incoming.map(function(conn){
                                var isOpen=expandedCards.has('conn-in-'+conn.file);
                                return React.createElement('div',{key:conn.file,className:'conn-item'},
                                    React.createElement('div',{className:'conn-header',onClick:function(e){e.stopPropagation();toggleCard('conn-in-'+conn.file);}},
                                        React.createElement('span',{className:'card-toggle'+(isOpen?' open':''),style:{fontSize:8,marginRight:6}},'▶'),
                                        React.createElement('span',{className:'conn-file-icon'},React.createElement(Icon,{name:'file',size:'s'})),
                                        React.createElement('span',{className:'conn-file-name'},conn.file.split('/').pop()),
                                        React.createElement('span',{className:'badge badge-default',style:{marginLeft:'auto'}},conn.fns.length,' relationship',conn.fns.length!==1?'s':'')
                                    ),
                                    isOpen&&React.createElement('div',{className:'conn-fns'},
                                        conn.fns.map(function(fn,i){return React.createElement('div',{key:i,className:'conn-fn'},
                                            React.createElement('span',{className:'conn-fn-name'},fn.name,fn.evidence==='mix xref'?'':'()'),
                                            React.createElement('span',{className:'conn-fn-count'},fn.evidence==='mix xref'?'mix xref':fn.count+'×')
                                        );}),
                                        React.createElement('div',{className:'conn-goto',onClick:function(){onLocate(conn.file);}},'→ View ',conn.file.split('/').pop())
                                    )
                                );
                            }),
                        )
                    )
                );
            })(),
            React.createElement('div',{className:'card',style:{marginBottom:12}},
                React.createElement('div',{className:'card-header',onClick:function(){toggleCard('own');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('own')?' open':'')},'▶'),React.createElement(Icon,{name:'users',size:'s'}),' Ownership')),
                expandedCards.has('own')&&React.createElement('div',{className:'card-body'},
                    ownerLoading?React.createElement('div',{className:'loading-owner'},'Loading ownership data...'):
                    ownership&&ownership.length>0?React.createElement(React.Fragment,null,
                        React.createElement('div',{className:'owner-bar'},ownership.slice(0,5).map(function(o,i){return React.createElement('div',{key:i,className:'owner-segment',style:{width:o.percent+'%',background:COLORS[i%COLORS.length]}});})),
                        React.createElement('div',{className:'owner-list'},ownership.slice(0,5).map(function(o,i){return React.createElement('div',{key:i,className:'owner-item'},React.createElement('div',{className:'owner-avatar',style:{background:COLORS[i%COLORS.length]}},o.name[0].toUpperCase()),React.createElement('span',{className:'owner-name'},o.name),React.createElement('span',{className:'owner-percent'},o.percent,'%'));}))
                    ):React.createElement('div',{style:{fontSize:10,color:'var(--t3)',padding:8}},'No ownership data available')
                )
            ),
            React.createElement('div',{className:'card'},
                React.createElement('div',{className:'card-header',onClick:function(){toggleCard('fns');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('fns')?' open':'')},'▶'),React.createElement(Icon,{name:'bolt',size:'s'}),' Functions (',selected.functions.length,')')),
                expandedCards.has('fns')&&React.createElement('div',{className:'card-body',style:{padding:8}},
                    selected.functions.length===0?React.createElement('div',{style:{fontSize:10,color:'var(--t3)',padding:8,textAlign:'center'}},'No functions detected'):
                    selected.functions.map(function(fn){
                        var statKey=fn.key||functionKey(fn);
                        var st=data.fnStats[statKey]||data.fnStats[fn.name];
                        var expandKey=statKey||fn.name;
                        var isExpanded=expandedFns.has(expandKey);
                        var intCalls=st?st.internal:0,extCalls=st?st.external:0;
                        return React.createElement('div',{key:expandKey,className:'fn-item'},
                            React.createElement('div',{className:'fn-header',onClick:function(){toggleFn(expandKey);}},
                                React.createElement('span',{className:'fn-name'},fn.name,fn.evidence==='mix xref'?'':'()'),
                                React.createElement('span',{style:{display:'flex',alignItems:'center',gap:4}},
                                    React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();onPreview(selected.path,fn.line);},title:'View source'},React.createElement(Icon,{name:'eye',size:'s'})),
                                    React.createElement('span',{className:'fn-line'},'L',fn.line),
                                    React.createElement('span',{className:'badge badge-default',title:'Internal calls (same file)'},intCalls,' int'),
                                    React.createElement('span',{className:'badge '+(extCalls>10?'badge-danger':extCalls>0?'badge-warning':'badge-default'),title:'External calls (other files)'},extCalls,' ext')
                                )
                            ),
                            isExpanded&&React.createElement(React.Fragment,null,
                                fn.code&&React.createElement('div',{className:'fn-code'},fn.code),
                                st&&st.callers&&st.callers.length>0&&React.createElement('div',{className:'fn-callers'},
                                    React.createElement('div',{className:'fn-callers-title'},'External callers:'),
                                    st.callers.map(function(c,i){return React.createElement('div',{key:i,className:'fn-caller',onClick:function(){onLocate(c.file);}},
                                        React.createElement(Icon,{name:'file',size:'s'}),
                                        React.createElement('span',null,c.name),
                                        React.createElement('span',{style:{marginLeft:'auto',color:'var(--t3)'}},c.count,'×')
                                    );})
                                ),
                                intCalls===0&&extCalls===0&&React.createElement('div',{style:{fontSize:9,color:'var(--orange)',padding:8,textAlign:'center',background:'rgba(255,159,67,0.1)',borderRadius:4}},
                                    React.createElement(Icon,{name:'warning',size:'s'}),
                                    st&&st.usageCertainty==='unverified'?' No callers found by source analysis; runtime use is unknown.':' No callers found by source analysis.'
                                )
                            )
                        );
                    })
                )
            )
        );
    };
}
