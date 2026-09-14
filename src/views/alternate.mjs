import {scaleStrokeWidth} from './graph-style.mjs';
import {renderTooltipHtml} from '../browser/html.mjs';

// These are the existing D3 views. Each mounted component owns its SVG,
// camera, tooltip and (for Disjoint) simulation; selection stays in App.
export function createAlternateViews({React,d3,colors:COLORS}){
    const {useRef,useEffect,useLayoutEffect,useState,useImperativeHandle}=React;
    function useSize(ref){
        const [size,setSize]=useState({width:800,height:600});
        useLayoutEffect(()=>{
            const measure=()=>{const width=ref.current.clientWidth||800,height=ref.current.clientHeight||600;
                setSize(previous=>previous.width===width&&previous.height===height?previous:{width,height});};
            measure();const observer=new ResizeObserver(measure);observer.observe(ref.current);
            return ()=>observer.disconnect();
        },[]);
        return size;
    }
    const TreemapView=React.forwardRef(function TreemapView({files:sourceFiles,folderFilter,colorMap,selectedPath,blastRadius,onSelect},ref){
        const containerRef=useRef(null),cameraRef=useRef(d3.zoomIdentity),paintRef=useRef(null),stateRef=useRef(null);
        stateRef.current={onSelect,colorMap,selected:selectedPath?{path:selectedPath}:null,blastRadius};
        useImperativeHandle(ref,()=>({get svgElement(){return containerRef.current?.querySelector('svg')||null;}}),[]);
        const size=useSize(containerRef);
        useEffect(function(){
            var container=d3.select(containerRef.current);
            container.selectAll('*').remove();
            var w=size.width,h=size.height;
            var svg=container.append('svg').attr('width',w).attr('height',h).style('cursor','grab');
            var g=svg.append('g');
            var zoom=d3.zoom().scaleExtent([0.3,4]).on('zoom',function(e){g.attr('transform',e.transform);svg.style('cursor',e.transform.k>1?'grab':'default');});
            svg.call(zoom);
            function cleanup(){cameraRef.current=d3.zoomTransform(svg.node());paintRef.current=null;svg.interrupt();svg.selectAll('*').interrupt();svg.on('.zoom',null);container.selectAll('*').remove();}
            svg.call(zoom.transform,cameraRef.current);
            var hier={name:'root',children:[]};
            var folderMap={};
            var filteredFiles=folderFilter?sourceFiles.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):sourceFiles;
            filteredFiles.forEach(function(f){
                var folder=f.folder||'root';
                if(!folderMap[folder])folderMap[folder]={name:folder,children:[]};
                folderMap[folder].children.push({name:f.name,value:f.lines||1,path:f.path,layer:f.layer,fns:f.functions.length,folder:folder});
            });
            hier.children=Object.values(folderMap);
            var root=d3.hierarchy(hier).sum(function(d){return d.value||0;}).sort(function(a,b){return b.value-a.value;});
            d3.treemap().size([w-20,h-20]).padding(3).round(true)(root);
            var cells=g.selectAll('g.treemap-cell-g').data(root.leaves()).join('g').attr('class','treemap-cell-g')
                .attr('transform',function(d){return'translate('+d.x0+','+d.y0+')';});
            cells.append('rect').attr('class','treemap-rect').attr('width',function(d){return Math.max(0,d.x1-d.x0);}).attr('height',function(d){return Math.max(0,d.y1-d.y0);})
                .attr('fill',function(d){return stateRef.current.colorMap[d.parent.data.name]||COLORS[hier.children.indexOf(d.parent.data)%COLORS.length];})
                .attr('opacity',0.85).attr('rx',3).attr('stroke','var(--bg0)').attr('stroke-width',1).style('cursor','pointer');
            cells.filter(function(d){return d.x1-d.x0>45&&d.y1-d.y0>22;}).append('text').attr('class','treemap-text')
                .attr('x',4).attr('y',14).attr('fill','white').attr('font-size','10px').attr('font-weight','500').style('text-shadow','0 1px 2px rgba(0,0,0,0.5)').style('pointer-events','none')
                .text(function(d){var n=d.data.name.replace(/\.[^.]+$/,'');var maxLen=Math.floor((d.x1-d.x0-8)/6);return n.length>maxLen?n.slice(0,maxLen-1)+'…':n;});
            cells.filter(function(d){return d.x1-d.x0>60&&d.y1-d.y0>35;}).append('text').attr('class','treemap-subtext')
                .attr('x',4).attr('y',26).attr('fill','rgba(255,255,255,0.7)').attr('font-size','8px').style('pointer-events','none')
                .text(function(d){return d.data.value+' lines';});
            var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
            cells.on('mouseenter',function(e,d){
                tooltip.html(renderTooltipHtml(d.data.name,[
                    {label:'Lines',value:d.data.value},
                    {label:'Functions',value:d.data.fns||0},
                    {label:'Layer',value:d.data.layer||'—'},
                    {label:'Folder',value:d.data.folder||'root'}
                ]))
                    .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
                d3.select(this).select('rect').transition().duration(150).attr('opacity',1).attr('stroke','var(--acc)').attr('stroke-width',2);
            }).on('mousemove',function(e){tooltip.style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');})
            .on('mouseleave',function(e,d){
                tooltip.style('display','none');
                var sel=stateRef.current.selected?stateRef.current.selected.path:null;
                var isSelected=d.data.path===sel;
                var isAffected=stateRef.current.blastRadius&&stateRef.current.blastRadius.affected.includes(d.data.path);
                d3.select(this).select('rect').transition().duration(150).attr('opacity',isSelected?1:isAffected?0.95:0.85).attr('stroke',isSelected?'#ff5f5f':isAffected?'var(--orange)':'var(--bg0)').attr('stroke-width',isSelected||isAffected?2:1);
            }).on('click',function(e,d){
                e.stopPropagation();
                if(d.data.path&&stateRef.current.onSelect){
                    stateRef.current.onSelect(d.data.path);

                }
            });
            svg.on('click',function(){
                stateRef.current.onSelect(null);
                cells.select('rect').transition().duration(300).attr('opacity',0.85).attr('fill',function(d){return stateRef.current.colorMap[d.parent.data.name]||COLORS[0];}).attr('stroke','var(--bg0)').attr('stroke-width',1);
            });
            svg.on('dblclick.zoom',function(e){e.preventDefault();svg.transition().duration(300).call(zoom.scaleTo,1);});
            paintRef.current=function(){
                const selected=stateRef.current.selected,blast=stateRef.current.blastRadius;
                cells.select('rect').interrupt()
                    .attr('fill',d=>selected&&d.data.path===selected.path?'#ff5f5f':blast?.affected.includes(d.data.path)?'#ff9f43':stateRef.current.colorMap[d.data.folder]||COLORS[0])
                    .attr('opacity',d=>!selected?0.85:d.data.path===selected.path?1:blast?.affected.includes(d.data.path)?0.95:0.4)
                    .attr('stroke',d=>selected&&d.data.path===selected.path?'#ff5f5f':blast?.affected.includes(d.data.path)?'var(--orange)':'var(--bg0)')
                    .attr('stroke-width',d=>selected&&(d.data.path===selected.path||blast?.affected.includes(d.data.path))?2:1);
            };

            paintRef.current?.();
            return cleanup;
        },[sourceFiles,folderFilter,size.width,size.height]);
        useEffect(()=>{paintRef.current?.();},[colorMap,selectedPath,blastRadius]);
        return React.createElement('div',{ref:containerRef,className:'treemap-container',style:{width:'100%',height:'100%',position:'relative',overflow:'hidden'}});
    });

    const MatrixView=React.forwardRef(function MatrixView({files:sourceFiles,connections,folderFilter,onSelect},ref){
        const containerRef=useRef(null),cameraRef=useRef(d3.zoomIdentity),paintRef=useRef(null),stateRef=useRef(null);
        stateRef.current={onSelect};
        useImperativeHandle(ref,()=>({get svgElement(){return containerRef.current?.querySelector('svg')||null;}}),[]);
        const size=useSize(containerRef);
        useEffect(function(){
            var container=d3.select(containerRef.current);
            container.selectAll('*').remove();
            var w=size.width,h=size.height;
            var svg=container.append('svg').attr('width',w).attr('height',h);
            var left=100,top=80;
            var g=svg.append('g');
            var colAxis=svg.append('g'),rowAxis=svg.append('g');
            var files=folderFilter?sourceFiles.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):sourceFiles;
            var n=files.length;
            var cellSize=Math.min(18,Math.max(10,(Math.min(w-120,h-100))/Math.max(1,n)));
            var fileIdx=new Map(files.map(function(f,i){return[f.path,i];}));
            // Store observed edges, not an n-by-n array. Zero cells are materialized
            // alongside connected cells only when their grid coordinates are visible.
            var weights=new Map(),maxVal=1;
            connections.forEach(function(c){
                var src=typeof c.source==='object'?c.source.id:c.source;
                var tgt=typeof c.target==='object'?c.target.id:c.target;
                if(!fileIdx.has(src)||!fileIdx.has(tgt))return;
                var key=fileIdx.get(src)*n+fileIdx.get(tgt);
                var value=(weights.get(key)||0)+(c.count||1);
                weights.set(key,value);maxVal=Math.max(maxVal,value);
            });
            var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
            var cells=g.selectAll('rect.matrix-cell-rect'),colLabels=colAxis.selectAll('text'),rowLabels=rowAxis.selectAll('text');
            var frame=null,transform=cameraRef.current;
            function clearHover(){
                tooltip.style('display','none');
                cells.attr('opacity',1).attr('stroke','var(--bg0)').attr('stroke-width',0.5);
                colLabels.attr('fill','var(--t2)').attr('font-weight','400');
                rowLabels.attr('fill','var(--t2)').attr('font-weight','400');
            }
            function label(f){var name=f.name.replace(/\.[^.]+$/,'');return name.length>10?name.slice(0,8)+'…':name;}
            function tooltipPosition(e){var r=containerRef.current.getBoundingClientRect();tooltip.style('left',(e.clientX-r.left+15)+'px').style('top',(e.clientY-r.top+15)+'px');}
            function drawViewport(){
                frame=null;
                var k=transform.k,x=left+transform.x,y=top+transform.y;
                var firstCol=Math.max(0,Math.floor((left-x)/(k*cellSize)));
                var lastCol=Math.min(n,Math.ceil((w-x)/(k*cellSize)));
                var firstRow=Math.max(0,Math.floor((top-y)/(k*cellSize)));
                var lastRow=Math.min(n,Math.ceil((h-y)/(k*cellSize)));
                var cellData=[],rows=[],cols=[];
                for(var i=firstRow;i<lastRow;i++){
                    rows.push(files[i]);
                    for(var j=firstCol;j<lastCol;j++)cellData.push({row:i,col:j,value:weights.get(i*n+j)||0,source:files[i],target:files[j]});
                }
                for(var j=firstCol;j<lastCol;j++)cols.push(files[j]);
                cells=g.selectAll('rect.matrix-cell-rect').data(cellData,function(d){return d.row*n+d.col;}).join('rect').attr('class','matrix-cell-rect')
                    .attr('x',function(d){return d.col*cellSize;}).attr('y',function(d){return d.row*cellSize;})
                    .attr('width',cellSize-1).attr('height',cellSize-1).attr('rx',2)
                    .attr('fill',function(d){return d.value>0?'rgba(0,255,157,'+Math.max(0.15,d.value/maxVal)+')':'var(--bg2)';})
                    .attr('stroke','var(--bg0)').attr('stroke-width',0.5).style('cursor','pointer');
                colLabels=colAxis.selectAll('text.col-label').data(cols,function(d){return d.path;}).join('text').attr('class','col-label')
                    .attr('transform',function(d){return 'translate('+(x+(fileIdx.get(d.path)+0.5)*cellSize*k)+','+(top-8)+') rotate(-45)';})
                    .attr('text-anchor','start').attr('fill','var(--t2)').attr('font-size','9px').text(function(d){return label(d);}).style('cursor','pointer')
                    .on('click',function(e,d){stateRef.current.onSelect?.(d.path);});
                rowLabels=rowAxis.selectAll('text.row-label').data(rows,function(d){return d.path;}).join('text').attr('class','row-label')
                    .attr('x',left-8).attr('y',function(d){return y+(fileIdx.get(d.path)+0.5)*cellSize*k+3;})
                    .attr('text-anchor','end').attr('fill','var(--t2)').attr('font-size','9px').text(function(d){return label(d);}).style('cursor','pointer')
                    .on('click',function(e,d){stateRef.current.onSelect?.(d.path);});
                cells.on('mouseenter',function(e,d){
                    tooltip.html(renderTooltipHtml(d.source.name+' → '+d.target.name,[{label:'Connections',value:d.value}])).style('display','block');tooltipPosition(e);
                    cells.attr('opacity',function(c){return c.row===d.row||c.col===d.col?1:0.3;});
                    colLabels.attr('fill',function(c){return fileIdx.get(c.path)===d.col?'var(--acc)':'var(--t2)';}).attr('font-weight',function(c){return fileIdx.get(c.path)===d.col?'600':'400';});
                    rowLabels.attr('fill',function(c){return fileIdx.get(c.path)===d.row?'var(--acc)':'var(--t2)';}).attr('font-weight',function(c){return fileIdx.get(c.path)===d.row?'600':'400';});
                    d3.select(this).attr('stroke','var(--acc)').attr('stroke-width',2);
                }).on('mousemove',tooltipPosition).on('mouseleave',clearHover)
                    .on('click',function(e,d){e.stopPropagation();stateRef.current.onSelect?.(d.source.path);});
            }
            // Axes remain beside the visible rows and columns while the grid pans.
            // Clip cells at the headers so partially visible cells cannot cover labels.
            var clipId='matrix-viewport-'+Math.random().toString(36).slice(2);
            svg.append('defs').append('clipPath').attr('id',clipId).append('rect').attr('x',left).attr('y',top).attr('width',Math.max(0,w-left)).attr('height',Math.max(0,h-top));
            var viewport=svg.insert('g',function(){return g.node();}).attr('clip-path','url(#'+clipId+')');
            viewport.node().appendChild(g.node());
            var zoom=d3.zoom().scaleExtent([0.5,3]).on('zoom',function(e){
                transform=e.transform;cameraRef.current=transform;
                g.attr('transform','translate('+(left+transform.x)+','+(top+transform.y)+') scale('+transform.k+')');
                clearHover();if(frame===null)frame=requestAnimationFrame(drawViewport);
            });
            svg.call(zoom).call(zoom.transform,transform);
            function cleanup(){if(frame!==null)cancelAnimationFrame(frame);cameraRef.current=d3.zoomTransform(svg.node());paintRef.current=null;svg.interrupt();svg.selectAll('*').interrupt();svg.on('.zoom',null);container.selectAll('*').remove();}
            var legend=container.append('div').attr('class','heatmap-legend').style('position','absolute').style('bottom','60px').style('right','20px');
            legend.html('<div style="font-size:9px;color:var(--t2)">Connection Strength</div><div class="heatmap-gradient"></div><div style="display:flex;justify-content:space-between;font-size:8px;color:var(--t3)"><span>0</span><span>'+maxVal+'</span></div>');
            paintRef.current?.();
            return cleanup;
        },[sourceFiles,connections,folderFilter,size.width,size.height]);
        return React.createElement('div',{ref:containerRef,className:'matrix-container',style:{width:'100%',height:'100%',position:'relative',overflow:'auto',display:'flex',alignItems:'center',justifyContent:'center'}});
    });

    const DendrogramView=React.forwardRef(function DendrogramView({files:sourceFiles,folderFilter,colorMap,lineThickness,onSelect,onScope},ref){
        const containerRef=useRef(null),cameraRef=useRef(d3.zoomIdentity),paintRef=useRef(null),stateRef=useRef(null);
        stateRef.current={onSelect,onScope,colorMap,lineThickness};
        useImperativeHandle(ref,()=>({get svgElement(){return containerRef.current?.querySelector('svg')||null;}}),[]);
        const size=useSize(containerRef);
        useEffect(function(){
            var container=d3.select(containerRef.current);
            container.selectAll('*').remove();
            var w=size.width,h=size.height;
            var svg=container.append('svg').attr('width',w).attr('height',h);
            var g=svg.append('g').attr('transform','translate(80,20)');
            var zoom=d3.zoom().scaleExtent([0.3,3]).on('zoom',function(e){g.attr('transform','translate('+(80+e.transform.x)+','+(20+e.transform.y)+') scale('+e.transform.k+')');});
            svg.call(zoom);
            function cleanup(){cameraRef.current=d3.zoomTransform(svg.node());paintRef.current=null;svg.interrupt();svg.selectAll('*').interrupt();svg.on('.zoom',null);container.selectAll('*').remove();}
            svg.call(zoom.transform,cameraRef.current);
            var filteredFiles=folderFilter?sourceFiles.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):sourceFiles;
            var hier={name:'root',children:[]};
            var folderMap={};
            filteredFiles.slice(0,80).forEach(function(f){
                var folder=f.folder||'root';
                if(!folderMap[folder])folderMap[folder]={name:folder.split('/').pop()||'root',fullPath:folder,children:[]};
                folderMap[folder].children.push({name:f.name,path:f.path,fns:f.functions.length,lines:f.lines,folder:folder,layer:f.layer});
            });
            hier.children=Object.values(folderMap);
            var root=d3.hierarchy(hier);
            var treeLayout=d3.cluster().size([h-60,w-200]);
            treeLayout(root);
            var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
            g.selectAll('path.dendro-link').data(root.links()).join('path').attr('class','dendro-link')
                .attr('d',function(d){return'M'+d.source.y+','+d.source.x+'C'+(d.source.y+d.target.y)/2+','+d.source.x+' '+(d.source.y+d.target.y)/2+','+d.target.x+' '+d.target.y+','+d.target.x;})
                .attr('fill','none').attr('stroke','var(--border)').attr('stroke-width',scaleStrokeWidth(1.5,stateRef.current.lineThickness)).attr('stroke-opacity',0.6);
            var node=g.selectAll('g.dendro-node').data(root.descendants()).join('g').attr('class','dendro-node')
                .attr('transform',function(d){return'translate('+d.y+','+d.x+')';}).style('cursor','pointer');
            node.append('circle').attr('r',function(d){return d.children?6:8;})
                .attr('fill',function(d){return d.children?'var(--bg3)':stateRef.current.colorMap[d.data.folder]||COLORS[0];})
                .attr('stroke',function(d){return d.children?'var(--t3)':'var(--bg0)';}).attr('stroke-width',2);
            node.filter(function(d){return!d.children;}).append('text').attr('x',12).attr('dy','0.35em')
                .attr('fill','var(--t1)').attr('font-size','9px').text(function(d){var n=d.data.name.replace(/\.[^.]+$/,'');return n.length>20?n.slice(0,18)+'…':n;});
            node.filter(function(d){return d.children&&d.depth>0;}).append('text').attr('x',-10).attr('dy','0.35em').attr('text-anchor','end')
                .attr('fill','var(--t2)').attr('font-size','10px').attr('font-weight','600').text(function(d){return d.data.name;});
            node.on('mouseenter',function(e,d){
                if(!d.data.path)return;
                tooltip.html(renderTooltipHtml(d.data.name,[
                    {label:'Lines',value:d.data.lines||0},
                    {label:'Functions',value:d.data.fns||0},
                    {label:'Layer',value:d.data.layer||'—'}
                ]))
                    .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
                d3.select(this).select('circle').transition().duration(150).attr('r',12).attr('stroke','var(--acc)').attr('stroke-width',3);
            }).on('mousemove',function(e){tooltip.style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');})
            .on('mouseleave',function(e,d){
                tooltip.style('display','none');
                d3.select(this).select('circle').transition().duration(150).attr('r',d.children?6:8).attr('stroke',d.children?'var(--t3)':'var(--bg0)').attr('stroke-width',2);
            }).on('click',function(e,d){
                e.stopPropagation();
                if(d.data.path&&stateRef.current.onSelect)stateRef.current.onSelect(d.data.path);
                else if(d.data.fullPath)stateRef.current.onScope(d.data.fullPath);
            });
            paintRef.current=()=>{node.select('circle').attr('fill',d=>d.children?'var(--bg3)':stateRef.current.colorMap[d.data.folder]||COLORS[0]);g.selectAll('.dendro-link').attr('stroke-width',scaleStrokeWidth(1.5,stateRef.current.lineThickness));};

            paintRef.current?.();
            return cleanup;
        },[sourceFiles,folderFilter,size.width,size.height]);
        useEffect(()=>{paintRef.current?.();},[colorMap,lineThickness]);
        return React.createElement('div',{ref:containerRef,className:'dendro-container',style:{width:'100%',height:'100%',position:'relative',overflow:'hidden'}});
    });

    const SankeyView=React.forwardRef(function SankeyView({files:sourceFiles,connections,folderFilter,colorMap,lineThickness,onScope},ref){
        const containerRef=useRef(null),cameraRef=useRef(d3.zoomIdentity),paintRef=useRef(null),stateRef=useRef(null);
        stateRef.current={onScope,colorMap,lineThickness};
        useImperativeHandle(ref,()=>({get svgElement(){return containerRef.current?.querySelector('svg')||null;}}),[]);
        const size=useSize(containerRef);
        useEffect(function(){
            var container=d3.select(containerRef.current);
            container.selectAll('*').remove();
            var w=size.width,h=size.height;
            var svg=container.append('svg').attr('width',w).attr('height',h);
            var g=svg.append('g').attr('transform','translate(20,20)');
            var zoom=d3.zoom().scaleExtent([0.5,2]).on('zoom',function(e){g.attr('transform','translate('+(20+e.transform.x)+','+(20+e.transform.y)+') scale('+e.transform.k+')');});
            svg.call(zoom);
            function cleanup(){cameraRef.current=d3.zoomTransform(svg.node());paintRef.current=null;svg.interrupt();svg.selectAll('*').interrupt();svg.on('.zoom',null);container.selectAll('*').remove();}
            svg.call(zoom.transform,cameraRef.current);
            var filteredFiles=folderFilter?sourceFiles.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):sourceFiles;
            var folders=[...new Set(filteredFiles.map(function(f){return f.folder||'root';}))].slice(0,15);
            var folderIdx={};folders.forEach(function(f,i){folderIdx[f]=i;});
            var filteredPaths=new Set(filteredFiles.map(function(f){return f.path;}));
            var flowMap={};
            connections.forEach(function(c){
                var src=typeof c.source==='object'?c.source.id:c.source;
                var tgt=typeof c.target==='object'?c.target.id:c.target;
                if(!filteredPaths.has(src)&&!filteredPaths.has(tgt))return;
                var srcFile=sourceFiles.find(function(f){return f.path===src;});
                var tgtFile=sourceFiles.find(function(f){return f.path===tgt;});
                if(srcFile&&tgtFile&&srcFile.folder!==tgtFile.folder){
                    var key=srcFile.folder+'|'+tgtFile.folder;
                    flowMap[key]=(flowMap[key]||0)+(c.count||1);
                }
            });
            var nodes=folders.map(function(f,i){return{id:i,name:f.split('/').pop()||'root',fullPath:f,fileCount:filteredFiles.filter(function(x){return x.folder===f;}).length};});
            // Merge bidirectional flows to avoid circular link errors
            var linkMap={};
            Object.entries(flowMap).forEach(function(e){
                var parts=e[0].split('|'),val=e[1];
                var si=folderIdx[parts[0]],ti=folderIdx[parts[1]];
                if(si!==undefined&&ti!==undefined&&si!==ti){
                    var key=Math.min(si,ti)+'|'+Math.max(si,ti);
                    if(!linkMap[key])linkMap[key]={a:Math.min(si,ti),b:Math.max(si,ti),ab:0,ba:0};
                    if(si<ti)linkMap[key].ab+=val;else linkMap[key].ba+=val;
                }
            });
            var links=[];
            Object.values(linkMap).forEach(function(l){
                var net=l.ab-l.ba;
                if(net>0)links.push({source:l.a,target:l.b,value:net});
                else if(net<0)links.push({source:l.b,target:l.a,value:-net});
                else if(l.ab>0)links.push({source:l.a,target:l.b,value:l.ab});
            });
            if(links.length===0){
                g.append('text').attr('x',w/2-20).attr('y',h/2).attr('fill','var(--t3)').attr('font-size','12px').text('No cross-folder dependencies to visualize');
                return cleanup;
            }
            var sankey=d3.sankey().nodeId(function(d){return d.id;}).nodeWidth(20).nodePadding(15).extent([[0,0],[w-60,h-60]]);
            var graph;
            try{
                graph=sankey({nodes:nodes.map(function(d){return Object.assign({},d);}),links:links.map(function(d){return Object.assign({},d);})});
            }catch(e){
                g.append('text').attr('x',w/2-20).attr('y',h/2).attr('fill','var(--t3)').attr('font-size','12px').attr('text-anchor','middle').text('Sankey diagram unavailable: dependency graph has circular references. Try the Force Graph view.');
                return cleanup;
            }
            var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
            g.selectAll('path.sankey-link').data(graph.links).join('path').attr('class','sankey-link')
                .attr('d',d3.sankeyLinkHorizontal()).attr('fill','none')
                .attr('stroke',function(d){return stateRef.current.colorMap[d.source.fullPath]||COLORS[d.source.id%COLORS.length];})
                .attr('stroke-width',function(d){return scaleStrokeWidth(Math.max(2,d.width),stateRef.current.lineThickness);}).attr('stroke-opacity',0.4)
                .on('mouseenter',function(e,d){
                    d3.select(this).attr('stroke-opacity',0.8);
                    tooltip.html(renderTooltipHtml(d.source.name+' → '+d.target.name,[
                        {label:'Connections',value:d.value}
                    ]))
                        .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
                }).on('mouseleave',function(){d3.select(this).attr('stroke-opacity',0.4);tooltip.style('display','none');});
            var node=g.selectAll('g.sankey-node').data(graph.nodes).join('g').attr('class','sankey-node').style('cursor','pointer');
            node.append('rect').attr('x',function(d){return d.x0;}).attr('y',function(d){return d.y0;})
                .attr('width',function(d){return d.x1-d.x0;}).attr('height',function(d){return Math.max(4,d.y1-d.y0);})
                .attr('fill',function(d){return stateRef.current.colorMap[d.fullPath]||COLORS[d.id%COLORS.length];}).attr('rx',3);
            node.append('text').attr('x',function(d){return d.x0<w/2?d.x1+8:d.x0-8;}).attr('y',function(d){return(d.y0+d.y1)/2;})
                .attr('dy','0.35em').attr('text-anchor',function(d){return d.x0<w/2?'start':'end';})
                .attr('fill','var(--t1)').attr('font-size','10px').attr('font-weight','500').text(function(d){return d.name+' ('+d.fileCount+')';});
            node.on('mouseenter',function(e,d){
                tooltip.html(renderTooltipHtml(d.fullPath,[
                    {label:'Files',value:d.fileCount}
                ]))
                    .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
                g.selectAll('path.sankey-link').attr('stroke-opacity',function(l){return l.source.id===d.id||l.target.id===d.id?0.8:0.1;});
            }).on('mouseleave',function(){tooltip.style('display','none');g.selectAll('path.sankey-link').attr('stroke-opacity',0.4);})
            .on('click',function(e,d){e.stopPropagation();stateRef.current.onScope(d.fullPath);});
            paintRef.current=()=>{node.select('rect').attr('fill',d=>stateRef.current.colorMap[d.fullPath]||COLORS[d.id%COLORS.length]);g.selectAll('.sankey-link').attr('stroke',d=>stateRef.current.colorMap[d.source.fullPath]||COLORS[d.source.id%COLORS.length]).attr('stroke-width',d=>scaleStrokeWidth(Math.max(2,d.width),stateRef.current.lineThickness));};

            paintRef.current?.();
            return cleanup;
        },[sourceFiles,connections,folderFilter,size.width,size.height]);
        useEffect(()=>{paintRef.current?.();},[colorMap,lineThickness]);
        return React.createElement('div',{ref:containerRef,className:'sankey-container',style:{width:'100%',height:'100%',position:'relative',overflow:'hidden'}});
    });

    const DisjointView=React.forwardRef(function DisjointView({files:sourceFiles,connections,folderFilter,colorMap,lineThickness,onSelect},ref){
        const containerRef=useRef(null),cameraRef=useRef(d3.zoomIdentity),paintRef=useRef(null),stateRef=useRef(null);
        stateRef.current={onSelect,colorMap,lineThickness};
        useImperativeHandle(ref,()=>({get svgElement(){return containerRef.current?.querySelector('svg')||null;}}),[]);
        const size=useSize(containerRef);
        useEffect(function(){
            var container=d3.select(containerRef.current);
            container.selectAll('*').remove();
            var w=size.width,h=size.height;
            var svg=container.append('svg').attr('width',w).attr('height',h);
            var g=svg.append('g');
            var zoom=d3.zoom().scaleExtent([0.2,4]).on('zoom',function(e){g.attr('transform',e.transform);});
            svg.call(zoom);
            function cleanup(){cameraRef.current=d3.zoomTransform(svg.node());paintRef.current=null;svg.interrupt();svg.selectAll('*').interrupt();svg.on('.zoom',null);container.selectAll('*').remove();sim?.stop();}
            svg.call(zoom.transform,cameraRef.current);
            var filteredFiles=folderFilter?sourceFiles.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):sourceFiles;
            var files=filteredFiles.slice(0,100);
            var fileIdx={};files.forEach(function(f,i){fileIdx[f.path]=i;});
            var folders=[...new Set(files.map(function(f){return f.folder||'root';}))];
            var cols=Math.ceil(Math.sqrt(folders.length));
            var cellW=w/cols,cellH=h/Math.ceil(folders.length/cols);
            var centers={};
            folders.forEach(function(f,i){centers[f]={x:(i%cols+0.5)*cellW,y:(Math.floor(i/cols)+0.5)*cellH};});
            var nodes=files.map(function(f){return{id:f.path,name:f.name,folder:f.folder||'root',fns:f.functions.length,lines:f.lines,layer:f.layer,cx:centers[f.folder||'root'].x,cy:centers[f.folder||'root'].y};});
            var links=[];
            connections.forEach(function(c){
                var src=typeof c.source==='object'?c.source.id:c.source;
                var tgt=typeof c.target==='object'?c.target.id:c.target;
                if(fileIdx[src]!==undefined&&fileIdx[tgt]!==undefined&&src!==tgt)links.push({source:src,target:tgt,count:c.count||1});
            });
            var sim=d3.forceSimulation(nodes)
                .force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(40).strength(0.3))
                .force('charge',d3.forceManyBody().strength(-80))
                .force('x',d3.forceX(function(d){return d.cx;}).strength(0.15))
                .force('y',d3.forceY(function(d){return d.cy;}).strength(0.15))
                .force('collide',d3.forceCollide(15));
            g.selectAll('rect.cluster-bg').data(folders).join('rect').attr('class','cluster-bg')
                .attr('x',function(d,i){return(i%cols)*cellW+10;}).attr('y',function(d,i){return Math.floor(i/cols)*cellH+10;})
                .attr('width',cellW-20).attr('height',cellH-20).attr('rx',12)
                .attr('fill',function(d){return stateRef.current.colorMap[d]||COLORS[folders.indexOf(d)%COLORS.length];}).attr('opacity',0.08)
                .attr('stroke',function(d){return stateRef.current.colorMap[d]||COLORS[folders.indexOf(d)%COLORS.length];}).attr('stroke-width',1).attr('stroke-opacity',0.3);
            g.selectAll('text.cluster-label').data(folders).join('text').attr('class','cluster-label')
                .attr('x',function(d,i){return(i%cols)*cellW+20;}).attr('y',function(d,i){return Math.floor(i/cols)*cellH+28;})
                .attr('fill','var(--t2)').attr('font-size','11px').attr('font-weight','600').text(function(d){return d.split('/').pop()||'root';});
            var link=g.selectAll('line.disjoint-link').data(links).join('line').attr('class','disjoint-link')
                .attr('stroke','var(--border)').attr('stroke-width',scaleStrokeWidth(1,stateRef.current.lineThickness)).attr('stroke-opacity',0.3);
            var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
            var node=g.selectAll('g.disjoint-node').data(nodes).join('g').attr('class','disjoint-node').style('cursor','pointer')
                .call(d3.drag().on('start',function(e,d){if(!e.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
                    .on('drag',function(e,d){d.fx=e.x;d.fy=e.y;}).on('end',function(e,d){if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));
            node.append('circle').attr('class','disjoint-circle').attr('r',function(d){return Math.max(6,Math.min(14,4+d.fns));})
                .attr('fill',function(d){return stateRef.current.colorMap[d.folder]||COLORS[0];}).attr('stroke','var(--bg0)').attr('stroke-width',1.5);
            node.on('mouseenter',function(e,d){
                tooltip.html(renderTooltipHtml(d.name,[
                    {label:'Lines',value:d.lines||0},
                    {label:'Functions',value:d.fns||0},
                    {label:'Folder',value:d.folder}
                ]))
                    .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
                link.attr('stroke-opacity',function(l){return l.source.id===d.id||l.target.id===d.id?0.8:0.05;}).attr('stroke',function(l){return l.source.id===d.id||l.target.id===d.id?'var(--acc)':'var(--border)';});
                d3.select(this).select('circle').transition().duration(150).attr('r',14).attr('stroke','var(--acc)').attr('stroke-width',2);
            }).on('mousemove',function(e){tooltip.style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');})
            .on('mouseleave',function(e,d){
                tooltip.style('display','none');
                link.attr('stroke-opacity',0.3).attr('stroke','var(--border)');
                d3.select(this).select('circle').transition().duration(150).attr('r',Math.max(6,Math.min(14,4+d.fns))).attr('stroke','var(--bg0)').attr('stroke-width',1.5);
            }).on('click',function(e,d){e.stopPropagation();if(stateRef.current.onSelect)stateRef.current.onSelect(d.id);});
            sim.on('tick',function(){
                link.attr('x1',function(d){return d.source.x;}).attr('y1',function(d){return d.source.y;}).attr('x2',function(d){return d.target.x;}).attr('y2',function(d){return d.target.y;});
                node.attr('transform',function(d){return'translate('+d.x+','+d.y+')';});
            });
            svg.on('click',function(){stateRef.current.onSelect(null);});

            paintRef.current=()=>{node.select('circle').attr('fill',d=>stateRef.current.colorMap[d.folder]||COLORS[0]);link.attr('stroke-width',scaleStrokeWidth(1,stateRef.current.lineThickness));g.selectAll('.cluster-bg').attr('fill',d=>stateRef.current.colorMap[d]||COLORS[0]).attr('stroke',d=>stateRef.current.colorMap[d]||COLORS[0]);};

            paintRef.current?.();
            return cleanup;
        },[sourceFiles,connections,folderFilter,size.width,size.height]);
        useEffect(()=>{paintRef.current?.();},[colorMap,lineThickness]);
        return React.createElement('div',{ref:containerRef,className:'disjoint-container',style:{width:'100%',height:'100%',position:'relative',overflow:'hidden'}});
    });

    const BundleView=React.forwardRef(function BundleView({files:sourceFiles,connections,folderFilter,colorMap,selectedPath,blastRadius,lineThickness,onSelect,onScope},ref){
        const containerRef=useRef(null),cameraRef=useRef(d3.zoomIdentity),paintRef=useRef(null),stateRef=useRef(null);
        stateRef.current={onSelect,onScope,colorMap,selected:selectedPath?{path:selectedPath}:null,blastRadius,lineThickness};
        useImperativeHandle(ref,()=>({get svgElement(){return containerRef.current?.querySelector('svg')||null;}}),[]);
        const size=useSize(containerRef);
        useEffect(function(){
            var container=d3.select(containerRef.current);
            container.selectAll('*').remove();
            var w=size.width,h=size.height;
            var svg=container.append('svg').attr('width',w).attr('height',h);
            var mainG=svg.append('g').attr('transform','translate('+w/2+','+h/2+')');
            var zoom=d3.zoom().scaleExtent([0.4,3]).on('zoom',function(e){mainG.attr('transform','translate('+(w/2+e.transform.x)+','+(h/2+e.transform.y)+') scale('+e.transform.k+')');});
            svg.call(zoom);
            function cleanup(){cameraRef.current=d3.zoomTransform(svg.node());paintRef.current=null;svg.interrupt();svg.selectAll('*').interrupt();svg.on('.zoom',null);container.selectAll('*').remove();}
            svg.call(zoom.transform,cameraRef.current);
            var radius=Math.min(w,h)/2-100;
            var filteredFiles=folderFilter?sourceFiles.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):sourceFiles;
            var files=filteredFiles.slice(0,70);
            var fileIdx={};files.forEach(function(f,i){fileIdx[f.path]=i;});
            var folderGroups={};files.forEach(function(f){var folder=f.folder||'root';if(!folderGroups[folder])folderGroups[folder]=[];folderGroups[folder].push(f);});
            var nodes=[],angle=0;
            var sortedFolders=Object.entries(folderGroups).sort(function(a,b){return b[1].length-a[1].length;});
            sortedFolders.forEach(function(entry){
                var folder=entry[0],fls=entry[1];
                var step=2*Math.PI*fls.length/files.length;
                fls.forEach(function(f){
                    nodes.push({id:f.path,name:f.name,folder:folder,angle:angle,x:Math.cos(angle-Math.PI/2)*radius,y:Math.sin(angle-Math.PI/2)*radius,layer:f.layer,fns:f.functions.length,lines:f.lines});
                    angle+=step/fls.length;
                });
            });
            var nodeMap={};nodes.forEach(function(n){nodeMap[n.id]=n;});
            var links=[];
            connections.forEach(function(c){
                var src=typeof c.source==='object'?c.source.id:c.source;
                var tgt=typeof c.target==='object'?c.target.id:c.target;
                if(nodeMap[src]&&nodeMap[tgt]&&src!==tgt)links.push({source:nodeMap[src],target:nodeMap[tgt],count:c.count||1});
            });
            function isBundleLinkMatch(nodeId,linkDatum){
                return linkDatum.source.id===nodeId||linkDatum.target.id===nodeId;
            }
            function getBundleLinkColor(linkDatum){
                return stateRef.current.colorMap[linkDatum.source.folder]||'var(--acc)';
            }
            function getBundleDirectConnections(nodeId){
                var connected=new Set([nodeId]);
                links.forEach(function(linkDatum){
                    if(isBundleLinkMatch(nodeId,linkDatum)){
                        connected.add(linkDatum.source.id);
                        connected.add(linkDatum.target.id);
                    }
                });
                return connected;
            }
            var link=mainG.selectAll('path.bundle-link').data(links).join('path').attr('class','bundle-link')
                .attr('d',function(d){
                    var a1=d.source.angle,a2=d.target.angle;
                    var x1=Math.cos(a1-Math.PI/2)*(radius-15),y1=Math.sin(a1-Math.PI/2)*(radius-15);
                    var x2=Math.cos(a2-Math.PI/2)*(radius-15),y2=Math.sin(a2-Math.PI/2)*(radius-15);
                    var midAngle=(a1+a2)/2;
                    var tension=0.3*radius;
                    var cx=Math.cos(midAngle-Math.PI/2)*tension,cy=Math.sin(midAngle-Math.PI/2)*tension;
                    return'M'+x1+','+y1+'Q'+cx+','+cy+' '+x2+','+y2;
                })
                .attr('fill','none').attr('stroke',getBundleLinkColor)
                .attr('stroke-width',scaleStrokeWidth(1.8,stateRef.current.lineThickness)).attr('stroke-opacity',0.35);
            var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
            var node=mainG.selectAll('g.bundle-node').data(nodes).join('g').attr('class','bundle-node').style('cursor','pointer')
                .attr('transform',function(d){return'rotate('+(d.angle*180/Math.PI-90)+') translate('+radius+',0)'+(d.angle>Math.PI?' rotate(180)':'');});
            node.append('circle').attr('class','bundle-circle').attr('r',6).attr('fill',function(d){return stateRef.current.colorMap[d.folder]||COLORS[0];}).attr('stroke','var(--bg0)').attr('stroke-width',1.5)
                .attr('transform',function(d){return d.angle>Math.PI?'translate(-6,0)':'translate(6,0)';});
            node.append('text').attr('dy','0.31em').attr('x',function(d){return d.angle>Math.PI?-14:14;}).attr('text-anchor',function(d){return d.angle>Math.PI?'end':'start';})
                .attr('fill','var(--t2)').attr('font-size','9px').text(function(d){var n=d.name.replace(/\.[^.]+$/,'');return n.length>16?n.slice(0,13)+'…':n;});
            function applyBundleDefaultState(){
                link.transition().duration(200)
                    .attr('stroke-opacity',0.35)
                    .attr('stroke-width',scaleStrokeWidth(1.8,stateRef.current.lineThickness))
                    .attr('stroke',getBundleLinkColor);
                node.selectAll('.bundle-circle').transition().duration(200)
                    .attr('fill',function(d){return stateRef.current.colorMap[d.folder]||COLORS[0];})
                    .attr('opacity',1)
                    .attr('r',6)
                    .attr('stroke','var(--bg0)')
                    .attr('stroke-width',1.5);
            }
            function applyBundleHoverState(nodeId){
                var directConnections=getBundleDirectConnections(nodeId);
                link.transition().duration(200)
                    .attr('stroke-opacity',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?0.88:0.04;})
                    .attr('stroke-width',function(linkDatum){return scaleStrokeWidth(isBundleLinkMatch(nodeId,linkDatum)?3.1:1,stateRef.current.lineThickness);})
                    .attr('stroke',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?'var(--acc)':getBundleLinkColor(linkDatum);});
                node.selectAll('.bundle-circle').transition().duration(200)
                    .attr('opacity',function(nodeDatum){return directConnections.has(nodeDatum.id)?1:0.22;})
                    .attr('r',function(nodeDatum){return nodeDatum.id===nodeId?9:6;})
                    .attr('stroke',function(nodeDatum){return nodeDatum.id===nodeId?'var(--acc)':'var(--bg0)';})
                    .attr('stroke-width',function(nodeDatum){return nodeDatum.id===nodeId?2:1.5;});
            }
            function applyBundleSelectionState(nodeId,blast){
                var directConnections=getBundleDirectConnections(nodeId);
                var affectedSet=new Set(blast&&blast.affected?blast.affected:[]);
                link.transition().duration(300)
                    .attr('stroke-opacity',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?0.96:0.08;})
                    .attr('stroke-width',function(linkDatum){return scaleStrokeWidth(isBundleLinkMatch(nodeId,linkDatum)?3.6:1.15,stateRef.current.lineThickness);})
                    .attr('stroke',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?'#ff9f43':getBundleLinkColor(linkDatum);});
                node.selectAll('.bundle-circle').transition().duration(300)
                    .attr('fill',function(nodeDatum){return nodeDatum.id===nodeId?'#ff5f5f':affectedSet.has(nodeDatum.id)?'#ff9f43':stateRef.current.colorMap[nodeDatum.folder]||COLORS[0];})
                    .attr('opacity',function(nodeDatum){return directConnections.has(nodeDatum.id)||affectedSet.has(nodeDatum.id)?1:0.22;})
                    .attr('r',function(nodeDatum){return nodeDatum.id===nodeId?9:6;})
                    .attr('stroke',function(nodeDatum){return nodeDatum.id===nodeId?'var(--acc)':'var(--bg0)';})
                    .attr('stroke-width',function(nodeDatum){return nodeDatum.id===nodeId?2:1.5;});
            }
            node.on('mouseenter',function(e,d){
                var rect=containerRef.current.getBoundingClientRect();
                tooltip.html(renderTooltipHtml(d.name,[
                    {label:'Lines',value:d.lines||0},
                    {label:'Functions',value:d.fns||0},
                    {label:'Folder',value:d.folder||'root'}
                ]))
                    .style('display','block').style('left',(e.clientX-rect.left+15)+'px').style('top',(e.clientY-rect.top+15)+'px');
                applyBundleHoverState(d.id);
            }).on('mousemove',function(e){var rect=containerRef.current.getBoundingClientRect();tooltip.style('left',(e.clientX-rect.left+15)+'px').style('top',(e.clientY-rect.top+15)+'px');})
            .on('mouseleave',function(){
                tooltip.style('display','none');
                if(stateRef.current.selected&&nodeMap[stateRef.current.selected.path]){
                    applyBundleSelectionState(stateRef.current.selected.path,stateRef.current.blastRadius);
                }else{
                    applyBundleDefaultState();
                }
            }).on('click',function(e,d){
                e.stopPropagation();
                if(stateRef.current.onSelect){
                    stateRef.current.onSelect(d.id);
                }
            });
            var arcGen=d3.arc().innerRadius(radius+20).outerRadius(radius+30);
            var folderAngleStart=0;
            sortedFolders.forEach(function(entry,i){
                var folder=entry[0],count=entry[1].length;
                var span=2*Math.PI*count/files.length;
                mainG.append('path').attr('d',arcGen({startAngle:folderAngleStart,endAngle:folderAngleStart+span}))
                    .attr('fill',stateRef.current.colorMap[folder]||COLORS[i%COLORS.length]).attr('opacity',0.5).style('cursor','pointer')
                    .on('click',function(){stateRef.current.onScope(folder);});
                if(span>0.15){
                    var midAngle=folderAngleStart+span/2-Math.PI/2;
                    mainG.append('text').attr('x',Math.cos(midAngle)*(radius+40)).attr('y',Math.sin(midAngle)*(radius+40))
                        .attr('text-anchor','middle').attr('fill','var(--t2)').attr('font-size','8px')
                        .attr('transform','rotate('+(midAngle*180/Math.PI+90)+','+Math.cos(midAngle)*(radius+40)+','+Math.sin(midAngle)*(radius+40)+')')
                        .text(folder.split('/').pop()||'root');
                }
                folderAngleStart+=span;
            });
            svg.on('click',function(){
                stateRef.current.onSelect(null);
                applyBundleDefaultState();
            });
            paintRef.current=function(){
            if(stateRef.current.selected&&nodeMap[stateRef.current.selected.path]){
                applyBundleSelectionState(stateRef.current.selected.path,stateRef.current.blastRadius);
            }else{
                applyBundleDefaultState();
            }
            };

            paintRef.current?.();
            return cleanup;
        },[sourceFiles,connections,folderFilter,size.width,size.height]);
        useEffect(()=>{paintRef.current?.();},[colorMap,selectedPath,blastRadius,lineThickness]);
        return React.createElement('div',{ref:containerRef,className:'bundle-container',style:{width:'100%',height:'100%',position:'relative',overflow:'hidden'}});
    });

    return {TreemapView,MatrixView,DendrogramView,SankeyView,DisjointView,BundleView};
}
