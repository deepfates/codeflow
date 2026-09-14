import {generateMermaidBlockDiagram} from '../analysis/architecture.mjs';
import {escapeHtml} from '../browser/html.mjs';

// The view owns Mermaid and its viewport; project selection belongs to the app.
export function createArchitectureView({React,mermaid}){
 const {useState,useRef,useEffect,useLayoutEffect,useImperativeHandle}=React;
 return React.forwardRef(function ArchitectureView({diagram,theme,includeTests=false,includeBuildOutput=false,selectedBlock,onSelect},ref){
    const architectureRenderRef=useRef(null),architectureDragRef=useRef(null);
    const [architectureViewport,setArchitectureViewport]=useState({scale:1,x:0,y:0});
    const [architectureDragging,setArchitectureDragging]=useState(false);
    const selectionRef=useRef(selectedBlock),onSelectRef=useRef(onSelect);
    selectionRef.current=selectedBlock;onSelectRef.current=onSelect;
    useImperativeHandle(ref,()=>({getSvg:()=>architectureRenderRef.current?.querySelector('svg')||null}),[]);
    function selectArchitectureBlock(id){
        focusArchitectureBlock(id);updateArchitectureHighlight(id);onSelectRef.current(id);
    }
    useEffect(function(){
        var container=architectureRenderRef.current;
        if(!container)return;
        var mermaidText=diagram?generateMermaidBlockDiagram(diagram,includeTests,includeBuildOutput,true):'';
        if(!mermaidText){
            container.innerHTML='<div class="empty-state"><div class="empty-title">No architecture diagram</div><div class="empty-desc">Analyze a repository to generate a block diagram.</div></div>';
            return;
        }
        if(!mermaid){
            container.innerHTML='<div class="empty-state"><div class="empty-title">Mermaid unavailable</div><div class="empty-desc">The Mermaid renderer did not load. You can still export the raw Mermaid source.</div></div>';
            return;
        }
        var cancelled=false;
        var renderId='codeflow-architecture-'+Date.now();
        container.innerHTML='<div class="loading"><div class="spinner"></div><div class="loading-text">Rendering block diagram...</div></div>';
        try{
            mermaid.initialize({
                startOnLoad:false,
                securityLevel:'strict',
                theme:theme==='light'?'default':'dark',
                flowchart:{htmlLabels:true,curve:'basis'}
            });
            mermaid.render(renderId,mermaidText).then(function(result){
                if(cancelled||!architectureRenderRef.current)return;
                architectureRenderRef.current.innerHTML='<div class="architecture-pan">'+result.svg+'</div>';
                var svg=architectureRenderRef.current.querySelector('.architecture-pan svg');
                if(!svg){
                    architectureRenderRef.current.innerHTML='<div class="empty-state"><div class="empty-title">Mermaid render failed</div><div class="empty-desc">The renderer returned no SVG for this diagram.</div></div>';
                    return;
                }
                normalizeArchitectureSvg(svg);
                svg.querySelectorAll('g.node').forEach(function(node){
                    var block=(diagram.blocks||[]).find(function(b){return node.id.indexOf('flowchart-'+b.id+'-')===0;});
                    if(!block)return;
                    node.setAttribute('data-architecture-id',block.id);node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',block.title);
                    node.style.cursor='pointer';
                    node.addEventListener('click',function(event){event.stopPropagation();selectArchitectureBlock(block.id);});
                    node.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();selectArchitectureBlock(block.id);}});
                });
                svg.querySelectorAll('path.flowchart-link').forEach(function(path){
                    var classes=Array.from(path.classList),from=(classes.find(function(c){return c.startsWith('LS-');})||'').slice(3),to=(classes.find(function(c){return c.startsWith('LE-');})||'').slice(3);
                    var evidence=(diagram.dependencies||[]).filter(function(d){return d.from===from&&d.to===to;});
                    var title=document.createElementNS('http://www.w3.org/2000/svg','title');
                    title.textContent=evidence.map(function(d){return d.label+(d.evidence?' · '+d.evidence:'');}).join('\n');path.appendChild(title);
                });
                updateArchitectureHighlight(selectionRef.current);
                requestAnimationFrame(function(){
                    if(!cancelled){fitArchitectureViewport();if(selectionRef.current)requestAnimationFrame(function(){focusArchitectureBlock(selectionRef.current);});}
                });
            }).catch(function(err){
                if(cancelled||!architectureRenderRef.current)return;
                architectureRenderRef.current.innerHTML='<div class="empty-state"><div class="empty-title">Mermaid render failed</div><div class="empty-desc">'+escapeHtml(err&&err.message?err.message:String(err))+'</div></div>';
            });
        }catch(err){
            container.innerHTML='<div class="empty-state"><div class="empty-title">Mermaid render failed</div><div class="empty-desc">'+escapeHtml(err&&err.message?err.message:String(err))+'</div></div>';
        }
        return function(){cancelled=true;};
    },[diagram,theme,includeTests,includeBuildOutput]);

    useEffect(function(){
        var container=architectureRenderRef.current;
        var pan=container?container.querySelector('.architecture-pan'):null;
        if(!pan)return;
        pan.style.transform='translate('+architectureViewport.x+'px,'+architectureViewport.y+'px) scale('+architectureViewport.scale+')';
    },[architectureViewport]);

    useEffect(function(){
        const observer=new ResizeObserver(()=>fitArchitectureViewport());
        observer.observe(architectureRenderRef.current);
        return ()=>observer.disconnect();
    },[]);
    useLayoutEffect(function(){
        updateArchitectureHighlight(selectedBlock);
        if(selectedBlock)focusArchitectureBlock(selectedBlock);
        else fitArchitectureViewport();
    },[selectedBlock]);
    function normalizeArchitectureSvg(svg){
        if(!svg)return{width:0,height:0};
        var width=0;
        var height=0;
        var viewBox=svg.getAttribute('viewBox')||'';
        var viewBoxParts=viewBox.trim().split(/\s+/).map(function(part){return Number(part);});
        if(viewBoxParts.length===4&&viewBoxParts.every(function(value){return isFinite(value);})){
            width=viewBoxParts[2];
            height=viewBoxParts[3];
        }
        if(!width||!height){
            try{
                var bbox=svg.getBBox();
                if(bbox&&bbox.width&&bbox.height){
                    width=bbox.width;
                    height=bbox.height;
                    svg.setAttribute('viewBox',[bbox.x,bbox.y,bbox.width,bbox.height].join(' '));
                }
            }catch(err){}
        }
        if(!width||!height){
            var rect=svg.getBoundingClientRect();
            width=rect.width||900;
            height=rect.height||600;
        }
        width=Math.max(320,Math.ceil(width));
        height=Math.max(240,Math.ceil(height));
        svg.setAttribute('width',String(width));
        svg.setAttribute('height',String(height));
        svg.setAttribute('data-codeflow-width',String(width));
        svg.setAttribute('data-codeflow-height',String(height));
        svg.style.width=width+'px';
        svg.style.height=height+'px';
        svg.style.maxWidth='none';
        return{width:width,height:height};
    }
    function fitArchitectureViewport(){
        var container=architectureRenderRef.current;
        var svg=container?container.querySelector('.architecture-pan svg'):null;
        if(!container||!svg)return;
        var rect=container.getBoundingClientRect();
        var dims=normalizeArchitectureSvg(svg);
        var availableWidth=Math.max(240,rect.width-64);
        var availableHeight=Math.max(180,rect.height-64);
        var scale=Math.min(1,availableWidth/dims.width,availableHeight/dims.height);
        scale=clampArchitectureScale(scale);
        var x=Math.max(24,Math.round((rect.width-dims.width*scale)/2));
        var y=Math.max(24,Math.round((rect.height-dims.height*scale)/2));
        setArchitectureViewport({scale:scale,x:x,y:y});
    }
    function clampArchitectureScale(value){
        return Math.max(0.005,Math.min(3,value));
    }
    function zoomArchitecture(multiplier,clientX,clientY){
        var container=architectureRenderRef.current;
        setArchitectureViewport(function(prev){
            var nextScale=clampArchitectureScale(prev.scale*multiplier);
            var rect=container?container.getBoundingClientRect():null;
            var px=rect?(clientX==null?rect.left+rect.width/2:clientX)-rect.left:0;
            var py=rect?(clientY==null?rect.top+rect.height/2:clientY)-rect.top:0;
            var ratio=nextScale/prev.scale;
            return{
                scale:nextScale,
                x:px-(px-prev.x)*ratio,
                y:py-(py-prev.y)*ratio
            };
        });
    }
    function handleArchitecturePointerDown(e){
        if(e.target&&e.target.closest&&e.target.closest('g.node'))return;
        if(e.button!==undefined&&e.button!==0)return;
        e.preventDefault();
        architectureDragRef.current={
            pointerId:e.pointerId,
            startX:e.clientX,
            startY:e.clientY,
            originX:architectureViewport.x,
            originY:architectureViewport.y
        };
        if(e.currentTarget&&e.currentTarget.setPointerCapture){
            try{e.currentTarget.setPointerCapture(e.pointerId);}catch(err){}
        }
        setArchitectureDragging(true);
    }
    function handleArchitecturePointerMove(e){
        var drag=architectureDragRef.current;
        if(!drag)return;
        e.preventDefault();
        setArchitectureViewport(function(prev){
            return Object.assign({},prev,{
                x:drag.originX+e.clientX-drag.startX,
                y:drag.originY+e.clientY-drag.startY
            });
        });
    }
    function handleArchitecturePointerUp(e){
        if(e&&e.currentTarget&&e.currentTarget.releasePointerCapture&&architectureDragRef.current){
            try{e.currentTarget.releasePointerCapture(architectureDragRef.current.pointerId);}catch(err){}
        }
        architectureDragRef.current=null;
        setArchitectureDragging(false);
    }
    function handleArchitectureWheel(e){
        e.preventDefault();
        zoomArchitecture(e.deltaY<0?1.12:0.88,e.clientX,e.clientY);
    }
    function focusArchitectureBlock(id){
        var container=architectureRenderRef.current,svg=container&&container.querySelector('svg');
        if(!svg)return;
        var node=Array.from(svg.querySelectorAll('g.node')).find(function(n){return n.id.indexOf('flowchart-'+id+'-')===0;});
        if(!node)return;
        var bounds=node.getBoundingClientRect(),svgBounds=svg.getBoundingClientRect();
        var currentScale=svgBounds.width/Number(svg.getAttribute('width'));
        if(!currentScale)return;
        var cx=(bounds.left+bounds.width/2-svgBounds.left)/currentScale,cy=(bounds.top+bounds.height/2-svgBounds.top)/currentScale;
        setArchitectureViewport({scale:1,x:container.clientWidth/2-cx,y:container.clientHeight/2-cy});
    }
    function updateArchitectureHighlight(id){
        var svg=architectureRenderRef.current&&architectureRenderRef.current.querySelector('svg');if(!svg)return;
        var connected=new Set([id]);
        svg.querySelectorAll('path.flowchart-link').forEach(function(path){
            var classes=Array.from(path.classList),from=(classes.find(function(c){return c.startsWith('LS-');})||'').slice(3),to=(classes.find(function(c){return c.startsWith('LE-');})||'').slice(3);
            var incident=from===id||to===id;if(incident){connected.add(from);connected.add(to);}
            path.style.opacity=id?(incident?'1':'0.08'):'0.4';
        });
        svg.querySelectorAll('[data-architecture-id]').forEach(function(node){
            node.style.opacity=!id||connected.has(node.dataset.architectureId)?'1':'0.25';
            var shape=node.querySelector('rect,polygon');if(shape)shape.style.strokeWidth=node.dataset.architectureId===id?'3px':'';
        });
    }
        return React.createElement('div',{className:'architecture-view'},
            React.createElement('div',{className:'architecture-shell'},
                React.createElement('div',{className:'canvas-toolbar'},
                    React.createElement('button',{className:'tool-btn',onClick:function(){zoomArchitecture(1.4);},'aria-label':'Zoom in'},'+'),
                    React.createElement('button',{className:'tool-btn',onClick:function(){zoomArchitecture(0.7);},'aria-label':'Zoom out'},'−'),
                    React.createElement('button',{className:'tool-btn',onClick:fitArchitectureViewport,'aria-label':'Fit view'},'⊡')),
                React.createElement('div',{
                    className:'mermaid-render'+(architectureDragging?' dragging':''),
                    ref:architectureRenderRef,
                    onPointerDown:handleArchitecturePointerDown,
                    onPointerMove:handleArchitecturePointerMove,
                    onPointerUp:handleArchitecturePointerUp,
                    onPointerCancel:handleArchitecturePointerUp,
                    onWheel:handleArchitectureWheel,
                    role:'img',
                    'aria-label':'Architecture block diagram. Drag to pan, mouse wheel to zoom.'
                })
            )
        );

 });
}
