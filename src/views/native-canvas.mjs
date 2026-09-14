import {highlightSyntax} from './highlight.mjs';
import {FINDING_COLORS,graphLinkStrokeWidth,prefersReducedMotion,subscribePrefersReducedMotion,forceLinkVisual,forceLinkParticlesNeedTickUpdate,readableLabelScale,zoomShowsColorBlocks,graphColorBlockSize,graphColorBlockScale,graphColorBlockFill} from './graph-style.mjs';
import {graphStructureKey,codeViewSceneKey} from '../project/identity.mjs';
import {asCodeLines,fileSourceDisplayState} from '../project/source.mjs';
import {codeCardDiffClass,codeCardDiffLineNo,codeCardDiffRows} from '../project/changes.mjs';
import {codeCardSizeForDiff,CODE_CARD_HEAD_HEIGHT,CODE_CARD_WIDTH,normalizeCodeCardPrefs,codeCardSize,clampCodeCardResize,applyCodeCardUserSize} from './card-size.mjs';
import {nodeReplacedByCard,graphFolderCenters,parkLeftoverCodeNodes,translateCodeViewSiblings,settleCodeViewAfterDrag,liveCodeCollideRadius,appendCodeCardPlacement,reflowUnpinnedCodeCards,liveGraphNodeXY,readCodeCardWorldBoxes,codeFolderHullBounds,preserveGraphNodeState} from './canvas-layout.mjs';
import {codeCardPlacementKeepSet,pruneCodeCardPlacements,filesForOpenedCodePaths} from '../investigation/navigation.mjs';
import {vizHasCanvasMinimap,vizUsesForceLinkParticles} from './capabilities.mjs';
import {noteCodeCardPointerEnd,consumeCodeCardClick,codeCardDragDelta,codeCardResizeDelta,codeViewDragRefresh,raiseCodeCardStack,applyCodeCardStackOrder,findCodeCardElement,applyCodeCardDragFrame,applyCodeCardResizeFrame,codeViewWheelAction,codeViewWheelPanDelta,applyCodeCardLayout,readCodeCardBodyScroll,isCodeCanvasDeselectTarget,codeViewWheelUsesNativeScroll} from './card-interaction.mjs';
import {codeCardLinkPath} from './card-links.mjs';
import {snapshotZoomTransform,shouldFitCodeCamera,clampCodeViewFitScale,codeCardFitBounds} from './camera.mjs';
import {minimapCardInputs,collectMinimapContent,viewportWorldRect,minimapFitRect,zoomTransformFromMinimapPoint,panTransformByViewportFraction,panTransformToWorldMidpoint,minimapPointerXY,readMinimapTheme,clearCanvasMinimap,drawCanvasMinimap} from './minimap.mjs';
import {codeColorBlockSections,codeCardSymbolPills,codeCardPillViewTop,collectCrossFileSymbols,annotateHtmlWithSymbols} from './source-symbols.mjs';
import {calcBlast} from '../analysis/metrics.mjs';

function copyRecords(records){
    return Object.fromEntries(Object.entries(records).map(([path,value])=>[path,{...value}]));
}

// Graph and Code share one camera, simulation and card geometry. Navigation and
// source acquisition enter through controlled inputs and callbacks; the scene
// snapshot is returned to the project's workspace owner for persistence.
export function createNativeCanvas({React,d3,Icon,COLORS,LAYER_COLORS}){
const {useState,useEffect,useLayoutEffect,useMemo,useRef,useImperativeHandle}=React;
return React.forwardRef(function NativeCanvas({
    data,active,projectIdentity,currentHydrationId,investigation,
    graphConfig,colorMap,colorMode,theme,lineThickness,codeViewExpand,codeViewWrap,viewport,
    cliLiveByPath,sourceFocus,codeSourceFailed,canReadSource,activeSymbol,getNodeColor,
    onSelect,onOpen,onClose,onRetrySource,onSourceClick,onActiveSymbol,onTooltip,
    restoredScene,onSceneRestored
},ref){
 const selected=data?.files.find(file=>file.path===investigation.selectedPath)||null;
 const folderFilter=investigation.scope,openedCodePaths=investigation.openedPaths;
 const codeViewFiles=useMemo(()=>filesForOpenedCodePaths(openedCodePaths,data,folderFilter),[openedCodePaths,data,folderFilter]);
 const {width:viewportWidth,sidebarWidth,rightPanelWidth}=viewport;
 const selectFile=onSelect,closeCodeCard=onClose,retryCodeSource=onRetrySource,beamSourceClick=onSourceClick,setActiveSymbol=onActiveSymbol,setTooltip=onTooltip;
 const canReadLiveFileSource=()=>canReadSource;
var pendingSourceFocusRef=useRef(null);
var svgRef=useRef(null);
var zoomRef=useRef(null);
var simRef=useRef(null);
var nodesRef=useRef(null);
var linksRef=useRef(null);
var linkParticlesRef=useRef(null);
var applyForceLinkVisualsRef=useRef(null);
var selectFileRef=useRef(null);
var codeCardsLayerRef=useRef(null);
var codeCardPathsRef=useRef(new Set());
var codeZoomTransformRef=useRef({k:1,x:0,y:0});
var graphNodesByIdRef=useRef(Object.create(null));
var selectedPathRef=useRef(null);
var codeCardSizesRef=useRef(Object.create(null));
var codeCardUserPinnedRef=useRef(new Set());
var codeCardLayoutKeyRef=useRef('');
var codeViewCameraReadyRef=useRef(false);
var codeViewSceneRef=useRef('');
var codeCardIgnoreClickRef=useRef(false);
var codeCardPlacementRef=useRef(Object.create(null));
var workspaceRestoreRef=useRef(null);
var pendingFlyToRef=useRef(null);
var openCodeFileRef=useRef(null);
var codeFilesByPathRef=useRef(Object.create(null));
var codeCanvasRef=useRef(null);
var updateHullsRef=useRef(null);
var drawMinimapRef=useRef(null);
var minimapHostRef=useRef(null);
var minimapCanvasRef=useRef(null);
var minimapModelRef=useRef(null);
var minimapDragRef=useRef(null);
var minimapRafRef=useRef(0);
var codeFolderCentersRef=useRef(Object.create(null));
var codeCardUserSizeRef=useRef(Object.create(null));
var codeCardStackRef=useRef([]);
var lineThicknessRef=useRef(lineThickness);
var [codePillScroll,setCodePillScroll]=useState(0);
 const activeGesture=useRef(null);
 function endCardGesture(){activeGesture.current?.();activeGesture.current=null;}
 function listenCardGesture(onMove,onUp){
   endCardGesture();
   window.addEventListener('pointermove',onMove);
   window.addEventListener('pointerup',onUp);
   window.addEventListener('pointercancel',onUp);
   activeGesture.current=()=>{
     window.removeEventListener('pointermove',onMove);
     window.removeEventListener('pointerup',onUp);
     window.removeEventListener('pointercancel',onUp);
   };
 }
 useEffect(()=>endCardGesture,[]);
 const previousOpened=useRef(openedCodePaths);
 useLayoutEffect(()=>{
   for(const path of previousOpened.current)if(!openedCodePaths.includes(path)){delete codeCardPlacementRef.current[path];codeCardUserPinnedRef.current.delete(path);}
   previousOpened.current=openedCodePaths;
 },[openedCodePaths]);
 useLayoutEffect(()=>{
   if(!restoredScene)return;
   codeCardPlacementRef.current=copyRecords(restoredScene.placements);
   codeCardUserSizeRef.current=copyRecords(restoredScene.sizes);
   codeCardUserPinnedRef.current=new Set(restoredScene.pinned);
   workspaceRestoreRef.current=restoredScene;
   pendingFlyToRef.current=null;
 },[restoredScene]);
 useLayoutEffect(()=>{
   pendingSourceFocusRef.current=sourceFocus;
   if(sourceFocus&&!codeCardUserSizeRef.current[sourceFocus.path])codeCardUserSizeRef.current[sourceFocus.path]={height:640};
 },[sourceFocus]);
 lineThicknessRef.current=lineThickness;
 selectFileRef.current=onSelect;openCodeFileRef.current=onOpen;

function updateGraphHighlight(path,blast){
        if(!nodesRef.current||!linksRef.current)return;
        var affectedSet=new Set(blast?blast.affected:[]);
        var dependencySet=new Set(blast?blast.dependencies:[]);
        nodesRef.current.selectAll('.nc,.nb').transition().duration(200)
            .attr('opacity',function(n){if(n.id===path)return 1;if(affectedSet.has(n.id)||dependencySet.has(n.id))return 1;return path?0.15:1;})
            .attr('fill',function(n){
                var fill=colorMode==='findings'?getNodeColor(n):n.id===path?'#ff5f5f':affectedSet.has(n.id)?'#ff9f43':dependencySet.has(n.id)?'#4d9fff':getNodeColor(n);
                return d3.select(this).classed('nb')?graphColorBlockFill(fill):fill;
            });
        linksRef.current.transition().duration(200)
            .attr('stroke-opacity',function(l){var src=l.source.id||l.source;var tgt=l.target.id||l.target;if(src===path||tgt===path)return 0.8;return path?0.05:0.4;})
            .attr('stroke',function(l){var src=l.source.id||l.source;var tgt=l.target.id||l.target;if(src===path||tgt===path)return'var(--acc)';return theme==='light'?'#ccc':'#333';});
    }
var graphRebuildKey=useMemo(function(){
        return [
            currentHydrationId,
            graphStructureKey(data,folderFilter),
            colorMode,
            theme,
            graphConfig.vizType,
            graphConfig.viewMode,
            graphConfig.spacing,
            graphConfig.linkDist,
            graphConfig.showLabels,
            graphConfig.curvedLinks,
            graphConfig.vizType==='code'?[selected&&selected.path,openedCodePaths.join('|')].join(':'):''
        ].join('\0');
    },[currentHydrationId,data,folderFilter,colorMode,theme,graphConfig,selected&&selected.path,openedCodePaths]);
useEffect(function(){
        var el=codeCanvasRef.current;
        if(!el||graphConfig.vizType!=='code')return;
        function onWheel(e){
            if(!zoomRef.current||!svgRef.current)return;
            if(codeViewWheelUsesNativeScroll(e,e.target))return;
            var action=codeViewWheelAction(e);
            e.preventDefault();
            var svg=d3.select(svgRef.current);
            if(action==='zoom'){
                var rect=svgRef.current.getBoundingClientRect();
                var factor=e.deltaY<0?1.08:1/1.08;
                zoomRef.current.scaleBy(svg,factor,[e.clientX-rect.left,e.clientY-rect.top]);
                return;
            }
            var pan=codeViewWheelPanDelta(e.deltaX,e.deltaY,snapshotZoomTransform(codeZoomTransformRef.current).k);
            zoomRef.current.translateBy(svg,pan.x,pan.y);
        }
        el.addEventListener('wheel',onWheel,{passive:false});
        return function(){el.removeEventListener('wheel',onWheel);};
    },[graphConfig.vizType]);
useLayoutEffect(function(){
        if(graphConfig.vizType!=='code'||!selected||!selected.path){
            setCodePillScroll(0);
            return;
        }
        setCodePillScroll(readCodeCardBodyScroll(codeCardsLayerRef.current,selected.path));
    },[graphConfig.vizType,selected&&selected.path]);

selectedPathRef.current=selected&&selected.path;
codeCardPathsRef.current=new Set(codeViewFiles.map(function(file){return file.path;}));
var filesByPath=Object.create(null);
if(data&&data.files)data.files.forEach(function(file){filesByPath[file.path]=file;});
codeFilesByPathRef.current=filesByPath;
function currentCodeCardPrefs(){
        return normalizeCodeCardPrefs({expand:codeViewExpand,wrap:codeViewWrap});
    }
function currentCodeCardSizes(){
        var prefs=currentCodeCardPrefs();
        var overrides=codeCardUserSizeRef.current;
        var sizes=Object.create(null);
        codeViewFiles.forEach(function(file){
            var rows=codeCardDiffRows(file,cliLiveByPath[file.path]);
            sizes[file.path]=applyCodeCardUserSize(codeCardSizeForDiff(file,prefs,rows),overrides[file.path]);
        });
        codeCardSizesRef.current=sizes;
        return sizes;
    }
function syncCodeCards(){
        applyCodeCardLayout(codeCardsLayerRef.current,graphNodesByIdRef.current,codeZoomTransformRef.current,codeCardSizesRef.current,codeCardStackRef.current);
    }
function redrawMovedGraphNodes(movedIds){
        if(!nodesRef.current||!movedIds||!movedIds.length)return;
        var seen=Object.create(null);
        movedIds.forEach(function(node){if(node&&node.id)seen[node.id]=true;});
        nodesRef.current.filter(function(d){return d&&seen[d.id];}).attr('transform',function(d){return'translate('+d.x+','+d.y+')';});
    }
function graphLinkPath(d){
        if(graphConfig.vizType==='code'){
            var cardPath=codeCardLinkPath(d,codeCardSizesRef.current,codeFilesByPathRef.current,codeCardPathsRef.current);
            if(cardPath)return cardPath;
        }
        if(graphConfig.curvedLinks){
            var dx=d.target.x-d.source.x,dy=d.target.y-d.source.y,dr=Math.sqrt(dx*dx+dy*dy);
            return 'M'+d.source.x+','+d.source.y+'A'+dr+','+dr+' 0 0,1 '+d.target.x+','+d.target.y;
        }
        return 'M'+d.source.x+','+d.source.y+'L'+d.target.x+','+d.target.y;
    }
function redrawActiveForceLinkParticles(){
        if(!linkParticlesRef.current)return;
        if(!forceLinkParticlesNeedTickUpdate(selectedPathRef.current,{reducedMotion:prefersReducedMotion(),vizType:graphConfig.vizType}))return;
        linkParticlesRef.current.filter('.is-on').attr('d',graphLinkPath);
    }
function redrawGraphLinksAndNodes(){
        if(nodesRef.current)nodesRef.current.attr('transform',function(d){return'translate('+d.x+','+d.y+')';});
        if(linksRef.current)linksRef.current.attr('d',graphLinkPath);
        redrawActiveForceLinkParticles();
    }
function applyForceLinkVisuals(){
        if(!vizUsesForceLinkParticles(graphConfig.vizType))return;
        var selectedPath=selectedPathRef.current||null;
        var opts={theme:theme,thickness:lineThicknessRef.current,reducedMotion:prefersReducedMotion(),vizType:graphConfig.vizType};
        if(linksRef.current){
            linksRef.current.each(function(d){
                var v=forceLinkVisual(d,selectedPath,opts);
                d3.select(this)
                    .attr('stroke',v.stroke)
                    .attr('stroke-opacity',v.opacity)
                    .attr('stroke-width',v.width)
                    .classed('force-link-active',v.active)
                    .classed('force-link-quiet',v.role==='quiet');
            });
        }
        if(linkParticlesRef.current){
            linkParticlesRef.current.each(function(d){
                var v=forceLinkVisual(d,selectedPath,opts);
                d3.select(this)
                    .attr('d',graphLinkPath(d))
                    .attr('stroke',v.particleStroke||v.stroke)
                    .attr('stroke-width',v.particleWidth)
                    .attr('stroke-opacity',v.particle?0.95:0)
                    .attr('stroke-dasharray',v.particle?v.particleDash:null)
                    .classed('is-on',!!v.particle)
                    .style('display',v.particle?null:'none');
            });
        }
    }
applyForceLinkVisualsRef.current=applyForceLinkVisuals;
function applyLinkThickness(){
        if(vizUsesForceLinkParticles(graphConfig.vizType))applyForceLinkVisuals();
        else if(linksRef.current)linksRef.current.attr('stroke-width',function(d){return graphLinkStrokeWidth(d.count,lineThicknessRef.current);});

    }
function refreshMinimap(){
        var canvas=minimapCanvasRef.current;
        if(!canvas||!vizHasCanvasMinimap(graphConfig.vizType))return;
        var svg=svgRef.current;
        if(!svg){
            minimapModelRef.current=null;
            clearCanvasMinimap(canvas);
            return;
        }
        var mapW=canvas.clientWidth||176;
        var mapH=canvas.clientHeight||118;
        var viewW=svg.clientWidth||800;
        var viewH=svg.clientHeight||600;
        var nodes=simRef.current?simRef.current.nodes():[];
        var overlay=minimapCardInputs(graphConfig.vizType,codeCardSizesRef.current,codeCardPathsRef.current);
        var content=collectMinimapContent(nodes,overlay.sizesByPath,overlay.cardPaths,getNodeColor);
        if(!content.world||!content.world.width){
            minimapModelRef.current=null;
            clearCanvasMinimap(canvas);
            return;
        }
        var transform=snapshotZoomTransform(codeZoomTransformRef.current);
        var viewport=viewportWorldRect(transform,viewW,viewH);
        var fit=minimapFitRect(content.world,mapW,mapH,8);
        var model={
            mapW:mapW,
            mapH:mapH,
            viewW:viewW,
            viewH:viewH,
            transform:transform,
            world:content.world,
            fit:fit,
            viewport:viewport,
            marks:content.marks,
            hulls:content.hulls,
            theme:readMinimapTheme(minimapHostRef.current||canvas)
        };
        minimapModelRef.current=model;
        drawCanvasMinimap(canvas,model);
    }
function scheduleMinimapDraw(){
        if(minimapRafRef.current)return;
        minimapRafRef.current=requestAnimationFrame(function(){
            minimapRafRef.current=0;
            refreshMinimap();
        });
    }
drawMinimapRef.current=scheduleMinimapDraw;
function applyMinimapFocus(mx,my){
        var model=minimapModelRef.current;
        if(!model||!model.fit||!zoomRef.current||!svgRef.current)return;
        var next=zoomTransformFromMinimapPoint(mx,my,model.world,model.fit,codeZoomTransformRef.current,model.viewW,model.viewH);
        d3.select(svgRef.current).call(zoomRef.current.transform,d3.zoomIdentity.translate(next.x,next.y).scale(next.k));
    }
function handleMinimapPointerDown(e){
        if(e.button!==undefined&&e.button!==0)return;
        e.preventDefault();
        e.stopPropagation();
        var canvas=minimapCanvasRef.current;
        if(!canvas)return;
        var xy=minimapPointerXY(e.clientX,e.clientY,canvas.getBoundingClientRect());
        minimapDragRef.current={pointerId:e.pointerId};
        if(e.currentTarget&&e.currentTarget.setPointerCapture){
            try{e.currentTarget.setPointerCapture(e.pointerId);}catch(err){}
        }
        applyMinimapFocus(xy.x,xy.y);
    }
function handleMinimapPointerMove(e){
        if(!minimapDragRef.current)return;
        e.preventDefault();
        var canvas=minimapCanvasRef.current;
        if(!canvas)return;
        var xy=minimapPointerXY(e.clientX,e.clientY,canvas.getBoundingClientRect());
        applyMinimapFocus(xy.x,xy.y);
    }
function handleMinimapPointerUp(e){
        if(e&&e.currentTarget&&e.currentTarget.releasePointerCapture&&minimapDragRef.current){
            try{e.currentTarget.releasePointerCapture(minimapDragRef.current.pointerId);}catch(err){}
        }
        minimapDragRef.current=null;
    }
function handleMinimapKeyDown(e){
        if(!e||e.altKey||e.ctrlKey||e.metaKey)return;
        var model=minimapModelRef.current;
        if(!model||!zoomRef.current||!svgRef.current)return;
        var transform=codeZoomTransformRef.current;
        var next=null;
        var frac=e.shiftKey?0.5:0.25;
        if(e.key==='ArrowLeft')next=panTransformByViewportFraction(transform,-frac,0,model.viewW,model.viewH);
        else if(e.key==='ArrowRight')next=panTransformByViewportFraction(transform,frac,0,model.viewW,model.viewH);
        else if(e.key==='ArrowUp')next=panTransformByViewportFraction(transform,0,-frac,model.viewW,model.viewH);
        else if(e.key==='ArrowDown')next=panTransformByViewportFraction(transform,0,frac,model.viewW,model.viewH);
        else if(e.key==='Home')next=panTransformToWorldMidpoint(transform,model.world,model.viewW,model.viewH);
        else return;
        e.preventDefault();
        e.stopPropagation();
        d3.select(svgRef.current).call(zoomRef.current.transform,d3.zoomIdentity.translate(next.x,next.y).scale(next.k));
    }
function flyToOpenedCodeCard(place){
        if(!svgRef.current||!zoomRef.current||!place||!isFinite(place.x)||!isFinite(place.y))return;
        var w=svgRef.current.clientWidth||800;
        var h=svgRef.current.clientHeight||600;
        var t=snapshotZoomTransform(codeZoomTransformRef.current);
        t.k=Math.min(1,Math.max(0.8,t.k));
        var next=d3.zoomIdentity.translate(w/2-place.x*t.k,h/2-place.y*t.k).scale(t.k);
        d3.select(svgRef.current).transition().duration(260).call(zoomRef.current.transform,next);
    }
function applyOpenedCardPlacements(opts){
        opts=opts||{};
        var sim=simRef.current;
        if(!sim||graphConfig.vizType!=='code')return;
        var sizes=currentCodeCardSizes();
        var placements=codeCardPlacementRef.current||Object.create(null);
        var centers=codeFolderCentersRef.current||Object.create(null);
        var placeOpts={pinnedPaths:codeCardUserPinnedRef.current,centers:centers,gapY:64};
        codeViewFiles.forEach(function(file){
            if(codeCardUserPinnedRef.current.has(file.path)&&placements[file.path]){
                var live=graphNodesByIdRef.current[file.path];
                var size=sizes[file.path]||applyCodeCardUserSize(codeCardSize(file,currentCodeCardPrefs()),codeCardUserSizeRef.current[file.path]);
                if(live&&isFinite(live.fx)&&isFinite(live.fy)){
                    placements[file.path]={
                        left:live.fx-size.width/2,
                        top:live.fy-size.height/2,
                        x:live.fx,
                        y:live.fy,
                        width:size.width,
                        height:size.height,
                        folder:file.folder||placements[file.path].folder||'root'
                    };
                    return;
                }
            }
            placements=appendCodeCardPlacement(placements,file,sizes[file.path]||applyCodeCardUserSize(codeCardSize(file,currentCodeCardPrefs()),codeCardUserSizeRef.current[file.path]),placeOpts);
        });
        var keep=codeCardPlacementKeepSet(openedCodePaths,codeViewFiles);
        var departed=pruneCodeCardPlacements(placements,keep);
        placements=reflowUnpinnedCodeCards(placements,codeCardUserPinnedRef.current,placeOpts);
        codeCardPlacementRef.current=placements;
        sim.nodes().forEach(function(node){
            var pos=placements[node.id];
            if(!pos){
                if(departed[node.id]&&!codeCardUserPinnedRef.current.has(node.id)){
                    node.fx=null;node.fy=null;
                }
                return;
            }
            if(codeCardUserPinnedRef.current.has(node.id)&&isFinite(node.fx)&&isFinite(node.fy)){
                node.x=node.fx;node.y=node.fy;
                return;
            }
            node.fx=pos.x;node.fy=pos.y;node.x=pos.x;node.y=pos.y;
        });
        var flyPath=pendingFlyToRef.current;
        if(flyPath&&codeViewCameraReadyRef.current&&!opts.skipFly){
            // Focus after the graph effect has rebuilt its zoom behavior.
            requestAnimationFrame(function(){requestAnimationFrame(function(){
                if(pendingFlyToRef.current!==flyPath)return;
                var current=codeCardPlacementRef.current[flyPath];
                if(current)flyToOpenedCodeCard(current);
                pendingFlyToRef.current=null;
            });});
        }
    }
function placeRemainingCodeNodes(){
        var sim=simRef.current;
        if(!sim)return;
        parkLeftoverCodeNodes(sim.nodes(),codeCardPathsRef.current,codeFolderCentersRef.current);
        settleCodeViewAfterDrag(sim.nodes(),codeCardPathsRef.current,codeCardSizesRef.current,null,{
            boxesByPath:readCodeCardWorldBoxes(codeCardsLayerRef.current)
        });
        refreshCodeCardForces();
        redrawGraphLinksAndNodes();
    }
function refreshCodeCardForces(){
        var sim=simRef.current;
        if(!sim)return;
        var collide=sim.force('collision');
        if(collide&&typeof collide.radius==='function'){
            collide.radius(function(d){return liveCodeCollideRadius(d,codeCardPathsRef.current.has(d.id)?codeCardSizesRef.current[d.id]:null);});
        }
        var linkForce=sim.force('link');
        if(linkForce&&typeof linkForce.distance==='function'){
            linkForce.distance(function(d){
                var src=typeof d.source==='object'?d.source.id:d.source;
                var tgt=typeof d.target==='object'?d.target.id:d.target;
                var extra=(codeCardPathsRef.current.has(src)||codeCardPathsRef.current.has(tgt))?240:0;
                return (graphConfig.linkDist||70)+extra;
            });
        }
        if(nodesRef.current){
            var zoomK=(codeZoomTransformRef.current||{}).k;
            var markScale=readableLabelScale(zoomK);
            var hideChrome=zoomShowsColorBlocks(zoomK);
            nodesRef.current.classed('has-code-card',function(d){return nodeReplacedByCard(d.id,codeCardPathsRef.current);});
            nodesRef.current.classed('code-faded',false);
            nodesRef.current.attr('display',function(d){return nodeReplacedByCard(d.id,codeCardPathsRef.current)?'none':null;});
            nodesRef.current.selectAll('circle.nc').attr('transform',function(d){return nodeReplacedByCard(d.id,codeCardPathsRef.current)||hideChrome?'':'scale('+markScale+')';});
            nodesRef.current.selectAll('text.node-label').attr('transform',function(d){return nodeReplacedByCard(d.id,codeCardPathsRef.current)||hideChrome?'':'scale('+markScale+')';});
        }
    }
var codeViewSymbols=useMemo(function(){
        return collectCrossFileSymbols(codeViewFiles,data?data.connections:[]);
    },[codeViewFiles,data]);
useEffect(function(){
        if(!data||!active||!svgRef.current)return;
        var svg=d3.select(svgRef.current);
        svg.selectAll('*').remove();
        try{
        var w=svgRef.current.clientWidth;
        var h=svgRef.current.clientHeight;
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        var fileIds=new Set(filteredFiles.map(function(f){return f.path;}));
        var nodes=filteredFiles.map(function(f){return{id:f.path,name:f.name,folder:f.folder,fnCount:f.functions.length,layer:f.layer,churn:f.churn||0};});
        var linkMap=new Map();
        data.connections.forEach(function(c){
            if(!fileIds.has(c.source)||!fileIds.has(c.target))return;
            if(c.source===c.target)return;// Skip self-links
            var k=JSON.stringify([c.source,c.target,c.kind||'']);
            if(!linkMap.has(k))linkMap.set(k,{source:c.source,target:c.target,kind:c.kind,count:0,fn:c.fn||null});
            linkMap.get(k).count+=c.count;
            if(!linkMap.get(k).fn&&c.fn)linkMap.get(k).fn=c.fn;
        });
        var links=Array.from(linkMap.values());
        function getR(d){return Math.max(8,Math.min(24,5+d.fnCount*0.8));}
        function getC(d){
            if(colorMode==='folder')return colorMap[d.folder]||COLORS[0];
            if(colorMode==='layer')return LAYER_COLORS[d.layer]||LAYER_COLORS['utils'];
            if(colorMode==='findings')return colorMap[d.id]||FINDING_COLORS.none;
            if(colorMode==='churn')return colorMap[d.id]||'#22c55e';
            return COLORS[0];
        }
        var folders=[...new Set(nodes.map(function(n){return n.folder;}))];
        var cols=Math.max(2,Math.ceil(Math.sqrt(folders.length)));
        var cw=w/(cols+1);
        var ch=h/(Math.ceil(folders.length/cols)+1);
        var centers={};
        folders.forEach(function(f,i){centers[f]={x:(i%cols+1)*cw,y:(Math.floor(i/cols)+1)*ch};});
        var keepReadable=graphConfig.vizType==='code';
        if(keepReadable){
            codeFolderCentersRef.current=graphFolderCenters(folders,w,h,{minCellW:CODE_CARD_WIDTH+220,minCellH:360});
        }
        var sceneKey=codeViewSceneKey(data,folderFilter,graphConfig.vizType,projectIdentity);
        if(sceneKey!==codeViewSceneRef.current){
            codeViewSceneRef.current=sceneKey;
            codeViewCameraReadyRef.current=false;
        }
        var workspaceRestore=workspaceRestoreRef.current;
        var restoringWorkspace=workspaceRestore&&workspaceRestore.view===graphConfig.vizType&&workspaceRestore.scope===(folderFilter||null);
        if(restoringWorkspace){codeZoomTransformRef.current=workspaceRestore.camera;codeViewCameraReadyRef.current=true;}
        var savedZoom=snapshotZoomTransform(codeZoomTransformRef.current);
        var prevNodesById=Object.create(null);
        if(simRef.current){
            simRef.current.nodes().forEach(function(n){if(n&&n.id)prevNodesById[n.id]=n;});
        }
        if(keepReadable&&codeViewCameraReadyRef.current)preserveGraphNodeState(nodes,prevNodesById);
        if(!keepReadable&&!restoringWorkspace){
            codeZoomTransformRef.current={k:1,x:0,y:0};
            codeViewCameraReadyRef.current=false;
        }
        graphNodesByIdRef.current=Object.create(null);
        nodes.forEach(function(n){graphNodesByIdRef.current[n.id]=n;});
        function collideR(d){return liveCodeCollideRadius(d,keepReadable&&codeCardPathsRef.current.has(d.id)?codeCardSizesRef.current[d.id]:null);}
        function applyCanvasColorBlocks(k){
            var on=zoomShowsColorBlocks(k);
            var s=on?graphColorBlockScale(k):1;
            if(svgRef.current&&svgRef.current.classList){
                if(on)svgRef.current.classList.add('color-blocks');
                else svgRef.current.classList.remove('color-blocks');
            }
            if(nodesRef.current){
                nodesRef.current.selectAll('rect.nb').attr('display',on?null:'none').attr('transform',on?'scale('+s+')':null);
            }
        }
        function applyReadableLabels(k){
            applyCanvasColorBlocks(k);
            if(!keepReadable)return;
            var s=readableLabelScale(k);
            var blocks=zoomShowsColorBlocks(k);
            nodeLayer.selectAll('g').each(function(d){
                var hidden=nodeReplacedByCard(d&&d.id,codeCardPathsRef.current);
                var sel=d3.select(this);
                sel.classed('has-code-card',hidden);
                sel.classed('code-faded',false);
                sel.attr('display',hidden?'none':null);
                if(hidden)return;
                if(blocks){
                    sel.select('circle.nc').attr('transform',null);
                    sel.select('text.node-label').attr('transform',null);
                    return;
                }
                sel.select('circle.nc').attr('transform','scale('+s+')');
                sel.select('text.node-label').attr('transform','scale('+s+')');
            });
            hullLayer.selectAll('text.hull-label').attr('font-size',(11*s)+'px');
        }
        var zoom=d3.zoom().extent(function(){return [[0,0],[svgRef.current.clientWidth,svgRef.current.clientHeight]];}).scaleExtent([keepReadable?0.08:0.2,5]).filter(function(event){
            if(keepReadable){
                if(event.type==='wheel')return false;
                return !event.button;
            }
            return !event.ctrlKey&&!event.button;
        }).on('zoom',function(e){
            container.attr('transform',e.transform);
            codeZoomTransformRef.current=e.transform;
            applyReadableLabels(e.transform.k);
            if(keepReadable)syncCodeCards();
            if(drawMinimapRef.current)drawMinimapRef.current();
        });
        svg.call(zoom);
        zoomRef.current=zoom;
        var container=svg.append('g');
        var defs=svg.append('defs');
        defs.append('marker').attr('id','arr').attr('viewBox','0 -5 10 10').attr('refX',14).attr('markerWidth',4).attr('markerHeight',4).attr('orient','auto').append('path').attr('d','M0,-4L10,0L0,4').attr('fill',theme==='light'?'#aaa':'#444');
        var hullLayer=container.append('g').attr('data-code-bg','1').attr('pointer-events','none');
        var linkLayer=container.append('g');
        var particleLayer=keepReadable?container.append('g').attr('class','force-link-particles').attr('pointer-events','none'):null;
        var nodeLayer=container.append('g');
        var sim=d3.forceSimulation(nodes);
        if(graphConfig.viewMode==='force'){
            sim.force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(graphConfig.linkDist).strength(0.3))
               .force('charge',d3.forceManyBody().strength(-graphConfig.spacing).distanceMax(400))
               .force('collision',d3.forceCollide().radius(collideR))
               .force('x',d3.forceX(function(d){return centers[d.folder]?centers[d.folder].x:w/2;}).strength(0.15))
               .force('y',d3.forceY(function(d){return centers[d.folder]?centers[d.folder].y:h/2;}).strength(0.15));
        }else if(graphConfig.viewMode==='radial'){
            var r=Math.min(w,h)*0.35;
            nodes.forEach(function(n,i){n.angle=i/nodes.length*2*Math.PI;n.targetX=w/2+Math.cos(n.angle)*r;n.targetY=h/2+Math.sin(n.angle)*r;});
            sim.force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(graphConfig.linkDist*0.5).strength(0.05))
               .force('charge',d3.forceManyBody().strength(-graphConfig.spacing*0.3))
               .force('collision',d3.forceCollide().radius(collideR))
               .force('x',d3.forceX(function(d){return d.targetX;}).strength(0.8))
               .force('y',d3.forceY(function(d){return d.targetY;}).strength(0.8));
        }else if(graphConfig.viewMode==='hierarchical'){
            var layerOrder={util:0,model:1,service:2,controller:3,view:4,test:5,config:6,modules:7,forms:8,classes:9};
            var layerGroups={};
            nodes.forEach(function(n){var l=n.layer||'util';if(!layerGroups[l])layerGroups[l]=[];layerGroups[l].push(n);});
            var sortedLayers=Object.keys(layerGroups).sort(function(a,b){return(layerOrder[a]||99)-(layerOrder[b]||99);});
            sortedLayers.forEach(function(l,li){var g=layerGroups[l];var colW=w/(sortedLayers.length+1);g.forEach(function(n,ni){n.targetX=(li+1)*colW;n.targetY=(ni+1)*h/(g.length+1);});});
            sim.force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(graphConfig.linkDist).strength(0.1))
               .force('charge',d3.forceManyBody().strength(-graphConfig.spacing*0.5).distanceMax(200))
               .force('collision',d3.forceCollide().radius(collideR))
               .force('x',d3.forceX(function(d){return d.targetX||w/2;}).strength(0.9))
               .force('y',d3.forceY(function(d){return d.targetY||h/2;}).strength(0.3));
        }else if(graphConfig.viewMode==='grid'){
            var gridCols=Math.ceil(Math.sqrt(nodes.length));
            var cellW=w/(gridCols+1);
            var cellH=h/(Math.ceil(nodes.length/gridCols)+1);
            nodes.forEach(function(n,i){n.targetX=(i%gridCols+1)*cellW;n.targetY=(Math.floor(i/gridCols)+1)*cellH;});
            sim.force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(graphConfig.linkDist*1.5).strength(0.02))
               .force('collision',d3.forceCollide().radius(collideR))
               .force('x',d3.forceX(function(d){return d.targetX;}).strength(1))
               .force('y',d3.forceY(function(d){return d.targetY;}).strength(1));
        }else if(graphConfig.viewMode==='metro'){
            var metro={lines:[],stations:{}};
            var roots=nodes.filter(function(n){return!links.some(function(l){return(l.target.id||l.target)===n.id;});});
            if(!roots.length)roots=[nodes[0]];
            var lineY=80,lineSpacing=Math.min(120,(h-160)/Math.max(1,roots.length));
            roots.forEach(function(root,li){
                var visited=new Set(),queue=[root.id],line=[],x=80;
                while(queue.length){
                    var id=queue.shift();if(visited.has(id))continue;visited.add(id);
                    var node=nodes.find(function(n){return n.id===id;});
                    if(node){node.targetX=x;node.targetY=lineY+li*lineSpacing;node.metroLine=li;line.push(node);x+=graphConfig.spacing*0.8;}
                    links.forEach(function(l){var s=l.source.id||l.source,t=l.target.id||l.target;if(s===id&&!visited.has(t))queue.push(t);});
                }
                metro.lines.push(line);
            });
            nodes.filter(function(n){return!n.targetX;}).forEach(function(n,i){n.targetX=80+i*50;n.targetY=h-80;n.metroLine=roots.length;});
            sim.force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(graphConfig.linkDist).strength(0.05))
               .force('collision',d3.forceCollide().radius(collideR))
               .force('x',d3.forceX(function(d){return d.targetX||w/2;}).strength(0.95))
               .force('y',d3.forceY(function(d){return d.targetY||h/2;}).strength(0.95));
        }
        // Adaptive simulation parameters based on graph size
        var isLargeGraph=nodes.length>300;
        var alphaDecay=isLargeGraph?0.08:0.05;
        var velDecay=isLargeGraph?0.7:0.6;
        sim.velocityDecay(velDecay).alphaDecay(alphaDecay);
        simRef.current=sim;
        var link=linkLayer.selectAll('path').data(links).join('path').attr('fill','none').attr('stroke',theme==='light'?'#ccc':'#333').attr('stroke-width',function(d){return graphLinkStrokeWidth(d.count,lineThicknessRef.current);}).attr('stroke-opacity',0.4).attr('marker-end','url(#arr)');
        linksRef.current=link;
        if(keepReadable&&particleLayer){
            var particles=particleLayer.selectAll('path').data(links).join('path').attr('fill','none').attr('class','force-link-particle').attr('stroke-linecap','round');
            linkParticlesRef.current=particles;
            applyForceLinkVisuals();
        }else{
            linkParticlesRef.current=null;
        }
        var node=nodeLayer.selectAll('g').data(nodes).join('g').style('cursor','pointer');
        nodesRef.current=node;
        var codeNodeDragPrev=Object.create(null);
        node.call(d3.drag().on('start',function(e,d){
            d.fx=d.x;d.fy=d.y;
            if(keepReadable){
                codeNodeDragPrev[d.id]={x:d.x,y:d.y};
                return;
            }
            if(!e.active)sim.alphaTarget(0.1).restart();
        }).on('drag',function(e,d){
            d.fx=e.x;d.fy=e.y;d.x=e.x;d.y=e.y;
            if(keepReadable){
                var prev=codeNodeDragPrev[d.id]||{x:d.x,y:d.y};
                var dx=d.x-prev.x,dy=d.y-prev.y;
                codeNodeDragPrev[d.id]={x:d.x,y:d.y};
                var siblings=translateCodeViewSiblings(sim.nodes(),d,dx,dy,codeCardPathsRef.current);
                if(codeViewDragRefresh('move')){
                    redrawGraphLinksAndNodes();
                    if(updateHullsRef.current)updateHullsRef.current();
                }else{
                    redrawMovedGraphNodes([d].concat(siblings));
                }
                if(drawMinimapRef.current)drawMinimapRef.current();
                return;
            }
        }).on('end',function(e,d){
            if(!keepReadable){
                if(!e.active)sim.alphaTarget(0);
                d.fx=null;d.fy=null;
                return;
            }
            d.fx=d.x;d.fy=d.y;
            delete codeNodeDragPrev[d.id];
            if(codeCardPathsRef.current.has(d.id))codeCardUserPinnedRef.current.add(d.id);
            if(codeViewDragRefresh('release')){
                settleCodeViewAfterDrag(sim.nodes(),codeCardPathsRef.current,codeCardSizesRef.current,d.id,{
                    boxesByPath:readCodeCardWorldBoxes(codeCardsLayerRef.current)
                });
                redrawGraphLinksAndNodes();
                if(updateHullsRef.current)updateHullsRef.current();
            }
            if(drawMinimapRef.current)drawMinimapRef.current();
        }));
        node.on('click',function(e,d){
            e.stopPropagation();
            if(keepReadable&&openCodeFileRef.current)openCodeFileRef.current(d.id);
            else if(selectFileRef.current)selectFileRef.current(d.id);
        });
        node.classed('has-code-card',function(d){return keepReadable&&nodeReplacedByCard(d.id,codeCardPathsRef.current);});
        node.attr('display',function(d){return keepReadable&&nodeReplacedByCard(d.id,codeCardPathsRef.current)?'none':null;});
        node.on('mouseenter',function(e,d){if(keepReadable&&codeCardPathsRef.current.has(d.id))return;var r=svgRef.current.getBoundingClientRect();setTooltip({x:e.clientX-r.left+10,y:e.clientY-r.top,title:d.name,content:d.fnCount+' functions\n'+d.layer+' layer\n'+d.churn+' recent commits'});}).on('mouseleave',function(){setTooltip(null);});
        svg.on('click',function(e){
            if(!isCodeCanvasDeselectTarget(e.target,svgRef.current))return;
            onSelect(null);

            setActiveSymbol(null);
            selectedPathRef.current=null;
            if(keepReadable){
                applyForceLinkVisuals();
                return;
            }
            link.attr('stroke',theme==='light'?'#ccc':'#333').attr('stroke-opacity',0.4);
            node.selectAll('.nc').attr('opacity',1).attr('fill',getC);
            node.selectAll('.nb').attr('opacity',1).attr('fill',function(d){return graphColorBlockFill(getC(d));});
        });
        node.append('circle').attr('class','nc').attr('r',getR).attr('fill',getC).attr('stroke',function(d){var c=d3.color(getC(d));return c?c.brighter(0.3):'#fff';}).attr('stroke-width',1.5);
        node.append('rect').attr('class','nb').attr('x',function(d){return -graphColorBlockSize(d)/2;}).attr('y',function(d){return -graphColorBlockSize(d)/2;}).attr('width',graphColorBlockSize).attr('height',graphColorBlockSize).attr('rx',3).attr('fill',function(d){return graphColorBlockFill(getC(d));}).attr('stroke',function(d){var c=d3.color(graphColorBlockFill(getC(d)));return c?c.darker(0.35):'#000';}).attr('stroke-width',1).attr('display','none');
        // Hide labels for large graphs to reduce DOM overhead. Code view keeps titles readable.
        if(keepReadable||!isLargeGraph||graphConfig.showLabels){
            node.append('text').attr('class','node-label').attr('text-anchor','middle').attr('dy',0).attr('fill',theme==='light'?'#333':'#eee').attr('font-size',function(d){return (keepReadable?Math.max(9,Math.min(12,getR(d)*0.7)):Math.max(6,Math.min(10,getR(d)*0.6)))+'px';}).attr('font-family','JetBrains Mono').attr('font-weight','600').attr('pointer-events','none').text(function(d){var n=d.name.replace(/\.[^.]+$/,'');if(keepReadable)return n.length>18?n.slice(0,17)+'…':n;var maxLen=Math.max(4,Math.floor(getR(d)/2));return n.length>maxLen+1?n.slice(0,maxLen)+'…':n;});
        }
        function liveNodesByFolder(){
            var live=(simRef.current&&simRef.current.nodes())||nodes;
            var grouped=Object.create(null);
            (live||[]).forEach(function(n){
                if(!n)return;
                var folder=n.folder||'root';
                if(!grouped[folder])grouped[folder]=[];
                grouped[folder].push(n);
            });
            return grouped;
        }
        function updateHulls(){
            hullLayer.selectAll('*').remove();
            var grouped=liveNodesByFolder();
            var boxesByPath=keepReadable?readCodeCardWorldBoxes(codeCardsLayerRef.current):null;
            Object.keys(grouped).forEach(function(f){
                var fn=grouped[f];
                if(!fn||fn.length<1)return;
                var cardNodes=keepReadable?fn.filter(function(n){return codeCardPathsRef.current.has(n.id);}):[];
                var leftover=keepReadable?fn.filter(function(n){return !codeCardPathsRef.current.has(n.id);}):fn;
                var color=colorMap[f]||COLORS[folders.indexOf(f)%COLORS.length];
                if(cardNodes.length){
                    var bounds=codeFolderHullBounds(cardNodes,leftover,codeCardSizesRef.current,28,boxesByPath);
                    if(bounds){
                        hullLayer.append('rect').attr('x',bounds.x).attr('y',bounds.y).attr('width',bounds.width).attr('height',bounds.height).attr('rx',14).attr('fill',color).attr('fill-opacity',0.06).attr('stroke',color).attr('stroke-width',2).attr('stroke-opacity',0.35);
                        hullLayer.append('text').attr('class','hull-label').attr('x',bounds.x+12).attr('y',bounds.y+16).attr('text-anchor','start').attr('fill',color).attr('font-size',keepReadable?'12px':'10px').attr('font-family','JetBrains Mono').attr('font-weight','600').attr('opacity',0.9).text(f||'root');
                    }
                    return;
                }
                var pts=[];
                leftover.forEach(function(n){
                    var xy=liveGraphNodeXY(n);
                    if(!xy)return;
                    pts.push([xy.x-30,xy.y-30],[xy.x+30,xy.y-30],[xy.x-30,xy.y+30],[xy.x+30,xy.y+30]);
                });
                if(pts.length<3)return;
                var hull=d3.polygonHull(pts);
                if(hull){
                    hullLayer.append('path').attr('d','M'+hull.join('L')+'Z').attr('fill',color).attr('fill-opacity',0.04).attr('stroke',color).attr('stroke-width',2).attr('stroke-opacity',0.25).attr('rx',8);
                    var cx=d3.mean(leftover,function(n){var xy=liveGraphNodeXY(n);return xy?xy.x:null;}),cy=d3.min(leftover,function(n){var xy=liveGraphNodeXY(n);return xy?xy.y:null;})-38;
                    hullLayer.append('text').attr('class','hull-label').attr('x',cx).attr('y',cy).attr('text-anchor','middle').attr('fill',color).attr('font-size',keepReadable?'11px':'10px').attr('font-family','JetBrains Mono').attr('font-weight','600').attr('opacity',0.85).text(f||'root');
                }
            });
        }
        // Throttle hull updates for large graphs (every N ticks instead of every tick)
        var hullInterval=isLargeGraph?5:1;
        var tickCount=0;
        sim.on('tick',function(){
            link.attr('d',graphLinkPath);
            redrawActiveForceLinkParticles();
            node.attr('transform',function(d){return'translate('+d.x+','+d.y+')';});
            if(keepReadable){
                nodes.forEach(function(n){graphNodesByIdRef.current[n.id]=n;});
                syncCodeCards();
            }
            tickCount++;
            if(tickCount%hullInterval===0)updateHulls();
            if(drawMinimapRef.current)drawMinimapRef.current();
        });
        node.selectAll('text').attr('opacity',(keepReadable||graphConfig.showLabels)?1:0);
        applyCanvasColorBlocks((codeZoomTransformRef.current&&codeZoomTransformRef.current.k)||1);
        if(keepReadable){
            applyOpenedCardPlacements({skipFly:true});
            placeRemainingCodeNodes();
            syncCodeCards();
            applyReadableLabels((codeZoomTransformRef.current&&codeZoomTransformRef.current.k)||1);
            updateHulls();
            if(shouldFitCodeCamera(codeViewCameraReadyRef.current,graphConfig.vizType)){
                var fit=computeGraphFitTransform();
                if(fit)svg.call(zoom.transform,fit);
                codeViewCameraReadyRef.current=true;
            }else{
                svg.call(zoom.transform,d3.zoomIdentity.translate(savedZoom.x,savedZoom.y).scale(savedZoom.k));
            }
            sim.alpha(0);
        }
        if(restoringWorkspace){
            svg.call(zoom.transform,d3.zoomIdentity.translate(savedZoom.x,savedZoom.y).scale(savedZoom.k));
            workspaceRestoreRef.current=null;
            onSceneRestored?.();
        }
        updateHullsRef.current=updateHulls;
        if(drawMinimapRef.current)drawMinimapRef.current();
        }catch(e){console.error('Force graph error:',e);svg.selectAll('*').remove();svg.append('text').attr('x',20).attr('y',30).attr('fill','var(--t3)').text('Graph rendering error: '+e.message);}
        return function(){if(simRef.current)simRef.current.stop();updateHullsRef.current=null;linkParticlesRef.current=null;};
    },[graphRebuildKey,restoredScene,active]);
useLayoutEffect(function(){
        if(!data||!active)return;
        if(graphConfig.vizType!=='code'){
            codeCardLayoutKeyRef.current='';
            codeViewCameraReadyRef.current=false;
            return;
        }
        var layoutKey=codeViewFiles.map(function(file){return file.path;}).join('|');
        if(layoutKey!==codeCardLayoutKeyRef.current)codeCardLayoutKeyRef.current=layoutKey;
        applyOpenedCardPlacements();
        placeRemainingCodeNodes();
        syncCodeCards();
        if(updateHullsRef.current)updateHullsRef.current();
        if(drawMinimapRef.current)drawMinimapRef.current();
    },[data,active,codeViewFiles,graphConfig.vizType,graphConfig.linkDist,codeViewExpand,codeViewWrap,cliLiveByPath]);
useEffect(function(){
        return subscribePrefersReducedMotion(function(){
            if(applyForceLinkVisualsRef.current)applyForceLinkVisualsRef.current();
        });
    },[]);
useEffect(function(){
        applyLinkThickness();
    },[lineThickness,selected&&selected.path]);
useEffect(function(){
        if(!vizHasCanvasMinimap(graphConfig.vizType)){
            minimapModelRef.current=null;
            if(minimapCanvasRef.current)clearCanvasMinimap(minimapCanvasRef.current);
            return;
        }
        scheduleMinimapDraw();
    },[graphConfig.vizType,theme,colorMode,viewportWidth,sidebarWidth,rightPanelWidth]);
useEffect(function(){
        return function(){
            if(minimapRafRef.current){
                cancelAnimationFrame(minimapRafRef.current);
                minimapRafRef.current=0;
            }
        };
    },[]);
function computeGraphFitTransform(paddingSlack){
        paddingSlack=paddingSlack==null?100:paddingSlack;
        if(!zoomRef.current||!svgRef.current||!simRef.current)return null;
        var nodes=simRef.current.nodes();
        if(!nodes.length)return null;
        var w=svgRef.current.clientWidth,h=svgRef.current.clientHeight;
        if(w<1||h<1)return null;
        if(graphConfig.vizType==='code'&&codeCardPathsRef.current&&codeCardPathsRef.current.size){
            var cardBounds=codeCardFitBounds(nodes,codeCardSizesRef.current,codeCardPathsRef.current);
            if(cardBounds){
                var cardW=Math.max(1,cardBounds.maxX-cardBounds.minX+80);
                var cardH=Math.max(1,cardBounds.maxY-cardBounds.minY+80);
                var cardScale=clampCodeViewFitScale(0.88/Math.max(cardW/w,cardH/h));
                return d3.zoomIdentity.translate(w/2-cardScale*cardBounds.cx,h/2-cardScale*cardBounds.cy).scale(cardScale);
            }
        }
        var xs=nodes.map(function(n){return n.x;}),ys=nodes.map(function(n){return n.y;});
        var minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs),minY=Math.min.apply(null,ys),maxY=Math.max.apply(null,ys);
        var scale=0.8/Math.max((maxX-minX+paddingSlack)/w,(maxY-minY+paddingSlack)/h);
        return d3.zoomIdentity.translate(w/2-scale*(minX+maxX)/2,h/2-scale*(minY+maxY)/2).scale(Math.min(scale,2));
    }
useEffect(function(){
        var focus=pendingSourceFocusRef.current,layer=codeCardsLayerRef.current;
        if(graphConfig.vizType!=='code'||!focus||!layer)return;
        var card=Array.from(layer.querySelectorAll('[data-code-card]')).find(function(el){return el.dataset.codeCard===focus.path;});
        var line=card&&card.querySelector('[data-line="'+focus.line+'"]'),body=card&&card.querySelector('.code-card-body');
        if(!line||!body)return;
        var bodyBounds=body.getBoundingClientRect(),lineBounds=line.getBoundingClientRect();
        var scale=bodyBounds.height/body.offsetHeight;
        if(!Number.isFinite(scale)||scale<=0)return;
        pendingSourceFocusRef.current=null;
        // Canvas zoom scales screen rectangles; scrollTop remains in local CSS pixels.
        body.scrollTop+=(lineBounds.top-bodyBounds.top)/scale-body.clientTop-body.clientHeight/2+line.offsetHeight/2;
    },[sourceFocus,codeViewFiles,cliLiveByPath,graphConfig.vizType]);
function beginCodeCardDrag(e,file){
        if(e.pointerType==='mouse'&&e.button!==0)return;
        e.stopPropagation();
        var node=graphNodesByIdRef.current[file.path];
        var transform=codeZoomTransformRef.current||{k:1,x:0,y:0};
        var k=Number(transform.k);
        if(!isFinite(k)||k<=0)k=1;
        if(!node){
            selectFile(file.path);
            return;
        }
        var startX=e.clientX,startY=e.clientY,originX=node.x,originY=node.y,moved=false,lastX=node.x,lastY=node.y;
        node.fx=node.x;node.fy=node.y;
        codeCardStackRef.current=raiseCodeCardStack(codeCardStackRef.current,file.path);
        applyCodeCardStackOrder(codeCardsLayerRef.current,codeCardStackRef.current);
        function writePlacement(){
            var size=codeCardSizesRef.current[file.path]||codeCardSize(file,currentCodeCardPrefs());
            var prev=codeCardPlacementRef.current[file.path]||{};
            codeCardPlacementRef.current[file.path]={
                left:node.fx-size.width/2,
                top:node.fy-size.height/2,
                x:node.fx,
                y:node.fy,
                width:size.width,
                height:size.height,
                folder:file.folder||prev.folder||'root'
            };
        }
        function onMove(ev){
            var delta=codeCardDragDelta(ev.clientX,ev.clientY,startX,startY,k,3);
            if(delta.moved){
                moved=true;
                codeCardUserPinnedRef.current.add(file.path);
            }
            var nextX=originX+delta.x,nextY=originY+delta.y;
            var dx=nextX-lastX,dy=nextY-lastY;
            node.x=node.fx=nextX;
            node.y=node.fy=nextY;
            lastX=nextX;lastY=nextY;
            var siblings=translateCodeViewSiblings((simRef.current&&simRef.current.nodes())||[],node,dx,dy,codeCardPathsRef.current);
            writePlacement();
            if(codeViewDragRefresh('move')){
                syncCodeCards();
                redrawGraphLinksAndNodes();
                if(updateHullsRef.current)updateHullsRef.current();
            }else{
                applyCodeCardDragFrame(codeCardsLayerRef.current,file.path,node,codeCardSizesRef.current[file.path]);
                redrawMovedGraphNodes([node].concat(siblings));
            }
            if(drawMinimapRef.current)drawMinimapRef.current();
        }
        function onUp(){
            endCardGesture();
            var end=noteCodeCardPointerEnd(moved);
            if(end.ignoreNextClick){
                codeCardIgnoreClickRef.current=true;
                setTimeout(function(){codeCardIgnoreClickRef.current=false;},400);
            }
            if(moved){
                codeCardUserPinnedRef.current.add(file.path);
                if(codeViewDragRefresh('release')){
                    settleCodeViewAfterDrag((simRef.current&&simRef.current.nodes())||[],codeCardPathsRef.current,codeCardSizesRef.current,file.path,{
                        boxesByPath:readCodeCardWorldBoxes(codeCardsLayerRef.current)
                    });
                }
                node.x=node.fx;node.y=node.fy;
                writePlacement();
                syncCodeCards();
                redrawGraphLinksAndNodes();
                if(updateHullsRef.current)updateHullsRef.current();
                if(drawMinimapRef.current)drawMinimapRef.current();
            }
            if(end.select)selectFile(file.path);
        }
        listenCardGesture(onMove,onUp);
    }
function beginCodeCardResize(e,file,edge){
        if(e.pointerType==='mouse'&&e.button!==0)return;
        e.stopPropagation();
        e.preventDefault();
        var node=graphNodesByIdRef.current[file.path];
        var size=codeCardSizesRef.current[file.path]||applyCodeCardUserSize(codeCardSizeForDiff(file,currentCodeCardPrefs(),codeCardDiffRows(file,cliLiveByPath[file.path])),codeCardUserSizeRef.current[file.path]);
        if(!node)return;
        var transform=codeZoomTransformRef.current||{k:1,x:0,y:0};
        var k=Number(transform.k);
        if(!isFinite(k)||k<=0)k=1;
        var startX=e.clientX,startY=e.clientY,startW=size.width,startH=size.height;
        var left=node.x-size.width/2,top=node.y-size.height/2,moved=false;
        function writeSize(nextSize){
            codeCardUserSizeRef.current[file.path]={width:nextSize.width,height:nextSize.height};
            codeCardSizesRef.current[file.path]=applyCodeCardUserSize(codeCardSizeForDiff(file,currentCodeCardPrefs(),codeCardDiffRows(file,cliLiveByPath[file.path])),nextSize);
            var live=codeCardSizesRef.current[file.path];
            node.x=node.fx=left+live.width/2;
            node.y=node.fy=top+live.height/2;
            var prev=codeCardPlacementRef.current[file.path]||{};
            codeCardPlacementRef.current[file.path]={
                left:left,
                top:top,
                x:node.fx,
                y:node.fy,
                width:live.width,
                height:live.height,
                folder:file.folder||prev.folder||'root'
            };
        }
        function onMove(ev){
            var delta=codeCardResizeDelta(ev.clientX,ev.clientY,startX,startY,startW,startH,k,edge);
            if(Math.abs(delta.dx)+Math.abs(delta.dy)>2){
                moved=true;
                codeCardUserPinnedRef.current.add(file.path);
            }
            writeSize(clampCodeCardResize(delta.width,delta.height,currentCodeCardPrefs()));
            if(codeViewDragRefresh('move')){
                syncCodeCards();
                redrawGraphLinksAndNodes();
                if(updateHullsRef.current)updateHullsRef.current();
            }else{
                applyCodeCardDragFrame(codeCardsLayerRef.current,file.path,node,codeCardSizesRef.current[file.path]);
                applyCodeCardResizeFrame(findCodeCardElement(codeCardsLayerRef.current,file.path),codeCardSizesRef.current[file.path]);
            }
            if(drawMinimapRef.current)drawMinimapRef.current();
        }
        function onUp(){
            endCardGesture();
            if(moved){
                codeCardUserPinnedRef.current.add(file.path);
                if(codeViewDragRefresh('release')){
                    settleCodeViewAfterDrag((simRef.current&&simRef.current.nodes())||[],codeCardPathsRef.current,codeCardSizesRef.current,file.path,{
                        boxesByPath:readCodeCardWorldBoxes(codeCardsLayerRef.current)
                    });
                }
                syncCodeCards();
                redrawGraphLinksAndNodes();
                if(updateHullsRef.current)updateHullsRef.current();
                if(drawMinimapRef.current)drawMinimapRef.current();
            }
        }
        listenCardGesture(onMove,onUp);
    }
function renderCodeFileCard(file,isPrimary){
        if(!file)return null;
        var sourceState=fileSourceDisplayState(file,canReadLiveFileSource(),codeSourceFailed);
        var body;
        if(sourceState==='ready'){
            var diffRows=codeCardDiffRows(file,cliLiveByPath[file.path]);
            if(diffRows){
                var diffSource=diffRows.map(function(row){return row.text;}).join('\n');
                var diffLines=asCodeLines(highlightSyntax(diffSource,file.name));
                body=React.createElement('pre',{className:'file-preview-code'},
                    diffLines.map(function(lineHtml,i){
                        var row=diffRows[i]||{type:'same'};
                        return React.createElement('div',{key:i,'data-line':row.newLine||undefined,className:'file-preview-line'+codeCardDiffClass(row)+(sourceFocus&&sourceFocus.path===file.path&&sourceFocus.line===row.newLine?' highlighted':'')},
                            React.createElement('span',{className:'file-preview-linenum'},codeCardDiffLineNo(row)),
                            React.createElement('span',{className:'file-preview-text',onClick:data.beam&&row.newLine?function(e){beamSourceClick(e,file.path,row.newLine-1);}:undefined,dangerouslySetInnerHTML:{__html:annotateHtmlWithSymbols(lineHtml||' ',codeViewSymbols,activeSymbol)}})
                        );
                    })
                );
            }else{
                var lines=asCodeLines(highlightSyntax(file.content||'',file.name));
                body=React.createElement('pre',{className:'file-preview-code'},
                    lines.map(function(lineHtml,i){
                        return React.createElement('div',{key:i,'data-line':i+1,className:'file-preview-line'+(sourceFocus&&sourceFocus.path===file.path&&sourceFocus.line===i+1?' highlighted':'')},
                            React.createElement('span',{className:'file-preview-linenum'},i+1),
                            React.createElement('span',{className:'file-preview-text',onClick:data.beam?function(e){beamSourceClick(e,file.path,i);}:undefined,dangerouslySetInnerHTML:{__html:annotateHtmlWithSymbols(lineHtml||' ',codeViewSymbols,activeSymbol)}})
                        );
                    })
                );
            }
        }else if(sourceState==='failed'){
            body=React.createElement('div',{className:'code-card-source-status'},
                React.createElement('div',{className:'empty-desc'},'Source unavailable'),
                React.createElement('button',{className:'code-card-retry',type:'button',onClick:function(e){
                    e.stopPropagation();
                    retryCodeSource(file.path);
                }},'Retry')
            );
        }else{
            var message=sourceState==='skipped'
                ?(file.analysisSkipped==='oversized'?'Skipped during analysis (file too large)':'File was not fetched during analysis')
                :(sourceState==='loading'?'Loading source...':'Reopen this project to read source');
            body=React.createElement('div',{className:'empty-desc',style:{padding:'12px'}},message);
        }
        var cardPrefs=currentCodeCardPrefs();
        var cardSize=applyCodeCardUserSize(codeCardSizeForDiff(file,cardPrefs,diffRows),codeCardUserSizeRef.current[file.path]);
        var pills=isPrimary?codeCardSymbolPills(file,data?data.connections:[],cardPrefs,diffRows):[];
        var colorBlocks=codeColorBlockSections(file,data?data.connections:[],cardPrefs,diffRows);
        var blockLayer=colorBlocks.length?React.createElement('div',{className:'code-color-blocks'},
            colorBlocks.map(function(block){
                return React.createElement('div',{
                    key:block.name+':'+block.startLine,
                    className:'code-color-block '+block.kind,
                    title:block.name,
                    style:{top:block.top+'px',height:block.height+'px',background:block.color},
                    onMouseEnter:function(e){
                        var host=codeCanvasRef.current;
                        if(!host)return;
                        var r=host.getBoundingClientRect();
                        setTooltip({x:e.clientX-r.left+10,y:e.clientY-r.top,title:block.name,content:block.kind+(block.startLine?' · L'+block.startLine:'')});
                    },
                    onMouseLeave:function(){setTooltip(null);}
                });
            })
        ):null;
        body=React.createElement('div',{className:'code-card-source'},body,blockLayer);
        return React.createElement('div',{key:file.path,'data-code-card':file.path,className:'code-card'+(isPrimary?' primary':' linked')+(cardSize.clipped?' clipped':'')+(cardSize.expand?' expand':'')+(cardSize.wrap?' wrap':''),onClick:function(e){
            var taken=consumeCodeCardClick(codeCardIgnoreClickRef.current);
            codeCardIgnoreClickRef.current=taken.ignoreNextClick;
            if(taken.ignore){e.stopPropagation();return;}
            if(!selected||selected.path!==file.path)selectFile(file.path);
        }},
            React.createElement('div',{className:'code-card-head',onPointerDown:function(e){beginCodeCardDrag(e,file);}},
                React.createElement('div',null,
                    React.createElement('div',{className:'code-card-name'},file.name),
                    React.createElement('div',{className:'code-card-path'},file.path)
                ),
                React.createElement('span',{className:'badge badge-default'},isPrimary?'selected':'open'),
                React.createElement('button',{className:'top-btn',type:'button','aria-label':'Close '+file.name,title:'Close file',onPointerDown:function(e){e.stopPropagation();},onClick:function(e){e.stopPropagation();closeCodeCard(file.path);}},React.createElement(Icon,{name:'close',size:'s'}))
            ),
            React.createElement('div',{className:'code-card-body',onClick:function(e){
                var mark=e.target.closest?e.target.closest('[data-sym]'):null;
                if(mark){
                    e.stopPropagation();
                    var name=mark.getAttribute('data-sym');
                    setActiveSymbol(function(prev){return prev===name?null:name;});
                }
            },onScroll:isPrimary&&cardSize.clipped?function(e){setCodePillScroll(e.currentTarget.scrollTop);}:undefined},body),
            pills.map(function(pill){
                var top=codeCardPillViewTop(pill.top,isPrimary?codePillScroll:0,cardSize.height,CODE_CARD_HEAD_HEIGHT);
                if(top==null)return null;
                return React.createElement('button',{
                    key:pill.name+':'+pill.line,
                    className:'code-line-pill '+pill.kind+(activeSymbol===pill.name?' active':''),
                    style:{top:top+'px'},
                    title:pill.name,
                    onClick:function(e){
                        e.stopPropagation();
                        setActiveSymbol(function(prev){return prev===pill.name?null:pill.name;});
                    }
                },pill.name);
            }),
            React.createElement('div',{className:'code-card-resize code-card-resize-e','data-code-resize':'e',onPointerDown:function(e){beginCodeCardResize(e,file,'e');}}),
            React.createElement('div',{className:'code-card-resize code-card-resize-s','data-code-resize':'s',onPointerDown:function(e){beginCodeCardResize(e,file,'s');}}),
            React.createElement('div',{className:'code-card-resize code-card-resize-se','data-code-resize':'se',onPointerDown:function(e){beginCodeCardResize(e,file,'se');}})
        );
    }
function renderCodeView(){
        var primaryPath=selected&&selected.path;
        return React.createElement('div',{className:'code-canvas',ref:codeCanvasRef},
            React.createElement('svg',{ref:svgRef}),
            React.createElement('div',{className:'code-canvas-cards',ref:codeCardsLayerRef},
                codeViewFiles.map(function(file){return renderCodeFileCard(file,file.path===primaryPath);})
            ),
            React.createElement('div',{className:'code-canvas-hud'},
                React.createElement('div',{className:'code-canvas-hint'},(codeViewFiles.length?'Open files from nodes or the Files tree. Open cards stay put. Wheel pans · Ctrl+wheel zooms.':'No files to open as cards.')),
                codeViewSymbols.length>0&&React.createElement('div',{className:'code-sym-list'},
                    codeViewSymbols.map(function(sym){
                        return React.createElement('button',{key:sym.name,className:'code-sym-chip '+sym.kind+(activeSymbol===sym.name?' active':''),title:sym.name,onClick:function(){setActiveSymbol(function(prev){return prev===sym.name?null:sym.name;});}},sym.name);
                    })
                )
            )
        );
    }
 useEffect(()=>{if(!selected){updateGraphHighlight(null,null);return;}if(graphConfig.vizType==='code')applyForceLinkVisuals();else updateGraphHighlight(selected.path,calcBlast(selected.path,data.connections,data.files));},[selected?.path,data,graphConfig.vizType]);
 function reveal(path,camera){
   pendingFlyToRef.current=null;
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
     const node=graphNodesByIdRef.current[path],svg=svgRef.current;
     if(!node||!zoomRef.current||!svg)return;
     const t=camera?d3.zoomIdentity.translate(camera.x,camera.y).scale(camera.k):d3.zoomIdentity.translate(svg.clientWidth/2-node.x,svg.clientHeight/2-node.y);
     d3.select(svg).transition().duration(250).call(zoomRef.current.transform,t);
   }));
 }
 useImperativeHandle(ref,()=>({
  focus(path){pendingFlyToRef.current=path;},reveal,
  prepareSource(location){if(!codeCardUserSizeRef.current[location.path])codeCardUserSizeRef.current[location.path]={height:640};pendingSourceFocusRef.current={path:location.path,line:location.range?location.range.start.line+1:1};},
  snapshotScene(){return {placements:copyRecords(codeCardPlacementRef.current),sizes:copyRecords(codeCardUserSizeRef.current),pinned:Array.from(codeCardUserPinnedRef.current),camera:snapshotZoomTransform(codeZoomTransformRef.current)};},
  get svgElement(){return svgRef.current;},
  frameForExport(padding){const svg=svgRef.current,zoom=zoomRef.current,previous=d3.zoomTransform(svg);const fit=computeGraphFitTransform(padding);if(fit)d3.select(svg).call(zoom.transform,fit);return ()=>{if(svgRef.current===svg)d3.select(svg).call(zoom.transform,previous);};},
  zoomBy(factor){if(svgRef.current&&zoomRef.current)d3.select(svgRef.current).transition().duration(200).call(zoomRef.current.scaleBy,factor);},
  resetZoom(){if(svgRef.current&&zoomRef.current)d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.transform,d3.zoomIdentity);},
  fit(){const t=computeGraphFitTransform(100);if(t)d3.select(svgRef.current).transition().duration(400).call(zoomRef.current.transform,t);}
 }));
 if(!data||!active||!['graph','code'].includes(graphConfig.vizType))return null;
 return React.createElement(React.Fragment,null,graphConfig.vizType==='code'?renderCodeView():React.createElement('svg',{ref:svgRef}),vizHasCanvasMinimap(graphConfig.vizType)&&React.createElement('div',{
                        className:'canvas-minimap',
                        ref:minimapHostRef,
                        tabIndex:0,
                        role:'application',
                        'aria-label':'Canvas mini-map. Click or drag to pan. Arrow keys pan the view. Home recenters.',
                        title:'Click or drag to pan. Arrow keys pan the view.',
                        onPointerDown:handleMinimapPointerDown,
                        onPointerMove:handleMinimapPointerMove,
                        onPointerUp:handleMinimapPointerUp,
                        onPointerCancel:handleMinimapPointerUp,
                        onKeyDown:handleMinimapKeyDown,
                        onWheel:function(e){e.preventDefault();e.stopPropagation();}
                    },React.createElement('canvas',{ref:minimapCanvasRef})));

});
}
