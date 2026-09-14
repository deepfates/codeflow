import {graph3dLinkWidth} from './graph-style.mjs';

// Own the native WebGL renderer and camera for this mounted view. The project
// and selected file remain application state; updates do not recreate WebGL.
export function createGraph3DView({React,getRuntime,colors:COLORS,layerColors:LAYER_COLORS}){
    const {useEffect,useRef,useImperativeHandle}=React;
    return React.forwardRef(function Graph3DView({data,folderFilter,colorMap,colorMode,theme,config,selectedPath,blastRadius,lineThickness,onSelect},ref){
    const graph3dRef=useRef(null),graph3dInstanceRef=useRef(null),onSelectRef=useRef(onSelect);
    onSelectRef.current=onSelect;
    useImperativeHandle(ref,()=>({
        zoom(factor){const graph=graph3dInstanceRef.current;if(!graph)return;const pos=graph.cameraPosition();graph.cameraPosition({x:pos.x*factor,y:pos.y*factor,z:pos.z*factor},null,400);},
        fit(){graph3dInstanceRef.current?.zoomToFit(600);}
    }),[]);
    // 3D Force Graph Hook
    useEffect(function(){
        if(!data||!graph3dRef.current)return;
        const {ForceGraph3D,THREE}=getRuntime();
        if(typeof ForceGraph3D==='undefined'){
            console.warn('3d-force-graph library not loaded');
            return;
        }
        var w=graph3dRef.current.clientWidth||800,h=graph3dRef.current.clientHeight||600;
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        var fileIds=new Set(filteredFiles.map(function(f){return f.path;}));

        // To prevent node jumping/sim resets, preserve existing node coordinate/velocity references
        var existingNodesMap=new Map();
        if(graph3dInstanceRef.current){
            var currentData=graph3dInstanceRef.current.graphData();
            if(currentData&&currentData.nodes){
                currentData.nodes.forEach(function(n){
                    existingNodesMap.set(n.id,n);
                });
            }
        }

        var nodes=filteredFiles.map(function(f){
            var existing=existingNodesMap.get(f.path);
            if(existing){
                existing.name=f.name;
                existing.folder=f.folder;
                existing.fnCount=f.functions.length;
                existing.layer=f.layer;
                existing.churn=f.churn||0;
                return existing;
            }
            return{id:f.path,name:f.name,folder:f.folder,fnCount:f.functions.length,layer:f.layer,churn:f.churn||0};
        });

        var linkMap=new Map();
        data.connections.forEach(function(c){
            if(!fileIds.has(c.source)||!fileIds.has(c.target))return;
            if(c.source===c.target)return;
            var k=c.source+'|'+c.target;
            if(!linkMap.has(k))linkMap.set(k,{source:c.source,target:c.target,count:0});
            linkMap.get(k).count+=c.count;
        });
        var links=Array.from(linkMap.values());

        // Color resolution helper for WebGL (which doesn't understand CSS var(--xxx) variables)
        function resolveHex(colorStr){
            if(!colorStr)return'#888888';
            if(colorStr.startsWith('var(--')){
                var isLight=(theme==='light');
                if(colorStr==='var(--acc)')return isLight?'#00a86b':'#00ff9d';
                if(colorStr==='var(--purple)')return'#a78bfa';
                if(colorStr==='var(--orange)')return'#ff9f43';
                if(colorStr==='var(--cyan)')return'#22d3ee';
                if(colorStr==='var(--red)')return'#ff5f5f';
                if(colorStr==='var(--green)')return'#22c55e';
                if(colorStr==='var(--blue)')return'#4d9fff';
                if(colorStr==='var(--pink)')return'#ec4899';
                if(colorStr==='var(--border)')return isLight?'#dadce0':'#2d2d35';
                if(colorStr==='var(--bg0)')return isLight?'#ffffff':'#0a0a0c';
            }
            return colorStr;
        }

        function hexToRgba(hex,alpha){
            var resolved=resolveHex(hex);
            resolved=resolved.replace('#','');
            if(resolved.length===3){
                resolved=resolved[0]+resolved[0]+resolved[1]+resolved[1]+resolved[2]+resolved[2];
            }
            var r=parseInt(resolved.substring(0,2),16);
            var g=parseInt(resolved.substring(2,4),16);
            var b=parseInt(resolved.substring(4,6),16);
            return'rgba('+r+','+g+','+b+','+alpha+')';
        }

        function getBaseColor(d){
            if(colorMode==='folder')return colorMap[d.folder]||COLORS[0];
            if(colorMode==='layer')return LAYER_COLORS[d.layer]||LAYER_COLORS['utils'];
            if(colorMode==='churn')return colorMap[d.id]||'#22c55e';
            return COLORS[0];
        }

        function getR(d){
            var base=Math.max(6,Math.min(20,4+d.fnCount*0.4));
            if(selectedPath){
                if(d.id===selectedPath)return base*2.0;
                if(blastRadius&&blastRadius.affected.indexOf(d.id)>=0)return base*1.4;
                if(blastRadius&&blastRadius.dependencies.indexOf(d.id)>=0)return base*1.4;
                return base*0.6;
            }
            return base;
        }

        function getC(d){
            var baseColor=getBaseColor(d);
            if(selectedPath){
                if(d.id===selectedPath)return hexToRgba('var(--acc)',0.95);
                if(blastRadius&&blastRadius.affected.indexOf(d.id)>=0)return hexToRgba('var(--purple)',0.95);
                if(blastRadius&&blastRadius.dependencies.indexOf(d.id)>=0)return hexToRgba('var(--orange)',0.95);
                return hexToRgba(baseColor,0.15);
            }
            return resolveHex(baseColor);
        }

        var graph;
        if(!graph3dInstanceRef.current){
            graph=ForceGraph3D({controlType:'orbit'})(graph3dRef.current);
            graph3dInstanceRef.current=graph;
        }else{
            graph=graph3dInstanceRef.current;
        }

        graph
            .width(w)
            .height(h)
            .backgroundColor(theme==='light'?'#ffffff':'#0a0a0c')
            .showNavInfo(false)
            .graphData({nodes:nodes,links:links})
            .nodeResolution(24)
            .nodeVal(getR)
            .nodeColor(getC)
            .nodeLabel(function(node){
                return '<div style="font-family:JetBrains Mono,monospace;font-size:10px;padding:6px;background:rgba(15,15,18,0.95);border:1px solid var(--border);border-radius:6px;color:#fff;">'+
                    '<strong style="color:var(--acc);">'+node.name+'</strong><br/>'+
                    node.folder+'<br/>'+
                    node.fnCount+' functions • '+node.layer+' layer • '+node.churn+' commits'+
                    '</div>';
            })
            .linkColor(function(link){
                var s=link.source.id||link.source;
                var t=link.target.id||link.target;
                if(selectedPath){
                    if(s===selectedPath)return hexToRgba('var(--orange)',0.85);
                    if(t===selectedPath)return hexToRgba('var(--purple)',0.85);
                    return theme==='light'?'rgba(220,220,220,0.08)':'rgba(40,40,48,0.08)';
                }
                return theme==='light'?'rgba(200,200,200,0.4)':'rgba(60,60,70,0.4)';
            })
            .linkWidth(function(link){
                return graph3dLinkWidth(link,selectedPath,lineThickness);
            })
            .linkDirectionalArrowLength(function(link){
                if(selectedPath){
                    var s=link.source.id||link.source;
                    var t=link.target.id||link.target;
                    if(s===selectedPath||t===selectedPath)return 5.0;
                    return 0;
                }
                return 3.5;
            })
            .linkDirectionalArrowRelPos(1)
            .linkDirectionalParticles(function(link){
                if(selectedPath){
                    var s=link.source.id||link.source;
                    var t=link.target.id||link.target;
                    if(s===selectedPath||t===selectedPath)return 4;
                    return 0;
                }
                return 1;
            })
            .linkDirectionalParticleWidth(function(link){
                if(selectedPath){
                    return 2.5;
                }
                return 1.2;
            })
            .linkDirectionalParticleSpeed(function(link){
                if(selectedPath){
                    return 0.015;
                }
                return 0.004;
            })
            .linkDirectionalParticleColor(function(link){
                var s=link.source.id||link.source;
                var t=link.target.id||link.target;
                if(selectedPath){
                    if(s===selectedPath)return resolveHex('var(--orange)');
                    if(t===selectedPath)return resolveHex('var(--purple)');
                }
                return resolveHex('var(--acc)');
            })
            .linkCurvature(config.curvedLinks?0.25:0)
            .onNodeClick(function(node){
                var distance=120;
                var distRatio=1+distance/Math.hypot(node.x,node.y,node.z);
                var newPos=node.x||node.y||node.z
                    ?{x:node.x*distRatio,y:node.y*distRatio,z:node.z*distRatio}
                    :{x:0,y:0,z:distance};
                graph.cameraPosition(newPos,node,1200);
                onSelectRef.current(node.id);
            })
            .onBackgroundClick(function(){
                onSelectRef.current(null);
            });

        // Crisp 3D Node Label Sprites using Canvas Textures
        
        if(THREE&&config.showLabels){
            graph.nodeThreeObject(function(node){
                var r=getR(node);
                var color=getC(node);
                var group=new THREE.Group();

                // Sphere mesh
                var sphereGeo=new THREE.SphereGeometry(r,24,24);
                var sphereMat=new THREE.MeshPhongMaterial({
                    color:color,
                    shininess:80
                });
                var sphereMesh=new THREE.Mesh(sphereGeo,sphereMat);
                group.add(sphereMesh);

                // Text canvas label
                var labelText=node.name;
                var canvas=document.createElement('canvas');
                var ctx=canvas.getContext('2d');
                var scale=4;
                ctx.font=(10*scale)+'px "JetBrains Mono", monospace';
                var textWidth=ctx.measureText(labelText).width;

                canvas.width=textWidth+(16*scale);
                canvas.height=24*scale;

                ctx.font=(10*scale)+'px "JetBrains Mono", monospace';
                ctx.fillStyle=theme==='light'?'rgba(255,255,255,0.9)':'rgba(10,10,12,0.9)';

                // Draw rounded rectangle label boundary
                var w_rect=canvas.width;
                var h_rect=canvas.height;
                var r_rect=4*scale;
                ctx.beginPath();
                ctx.moveTo(r_rect,0);
                ctx.lineTo(w_rect-r_rect,0);
                ctx.quadraticCurveTo(w_rect,0,w_rect,r_rect);
                ctx.lineTo(w_rect,h_rect-r_rect);
                ctx.quadraticCurveTo(w_rect,h_rect,w_rect-r_rect,h_rect);
                ctx.lineTo(r_rect,h_rect);
                ctx.quadraticCurveTo(0,h_rect,0,h_rect-r_rect);
                ctx.lineTo(0,r_rect);
                ctx.quadraticCurveTo(0,0,r_rect,0);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle=theme==='light'?'rgba(0,0,0,0.15)':'rgba(255,255,255,0.15)';
                ctx.lineWidth=1*scale;
                ctx.stroke();

                ctx.fillStyle=color;
                ctx.textAlign='center';
                ctx.textBaseline='middle';
                ctx.fillText(labelText,canvas.width/2,canvas.height/2);

                var texture=new THREE.CanvasTexture(canvas);
                var labelMaterial=new THREE.SpriteMaterial({map:texture,depthWrite:false});
                var labelSprite=new THREE.Sprite(labelMaterial);

                var spriteWidth=(canvas.width/scale)*0.15;
                var spriteHeight=(canvas.height/scale)*0.15;
                labelSprite.scale.set(spriteWidth,spriteHeight,1);
                labelSprite.position.set(0,r+spriteHeight/2+2,0);
                group.add(labelSprite);

                return group;
            });
            graph.nodeThreeObjectExtend(false);
        }else{
            graph.nodeThreeObject(null);
        }

        // Auto-rotation handling on Three.js OrbitControls
        var rotationTimer=setTimeout(function(){
            if(graph3dInstanceRef.current){
                var ctrl=graph3dInstanceRef.current.controls();
                if(ctrl){
                    ctrl.autoRotate=!!config.autoRotate;
                    ctrl.autoRotateSpeed=1.0;
                }
            }
        },100);

        var linkForce=graph.d3Force('link');
        if(linkForce)linkForce.distance(config.linkDist||70);
        var chargeForce=graph.d3Force('charge');
        if(chargeForce)chargeForce.strength(-(config.spacing||200));

        // Dynamic 3D Clustering Force by Color Category (Folder or Layer)
        var groups=[];
        if(colorMode==='folder'){
            groups=Array.from(new Set(filteredFiles.map(function(f){return f.folder;})));
        }else if(colorMode==='layer'){
            groups=Array.from(new Set(filteredFiles.map(function(f){return f.layer;})));
        }

        var centers={};
        if(groups.length>0){
            var nG=groups.length;
            groups.forEach(function(g,i){
                // Distribute cluster centers uniformly on a 3D sphere using Fibonacci distribution
                var phi=Math.acos(1-2*(i+0.5)/nG);
                var theta=Math.PI*(1+Math.sqrt(5))*(i+0.5);
                var radius=180; // Distance of clusters from center
                centers[g]={
                    x:radius*Math.sin(phi)*Math.cos(theta),
                    y:radius*Math.sin(phi)*Math.sin(theta),
                    z:radius*Math.cos(phi)
                };
            });
        }

        function customForce(axis,targetSelector,strength){
            var nodes;
            function force(alpha){
                var prop=axis;
                var velProp='v'+axis;
                for(var i=0;i<nodes.length;i++){
                    var node=nodes[i];
                    var target=targetSelector(node);
                    node[velProp]+=(target-node[prop])*strength*alpha;
                }
            }
            force.initialize=function(_){nodes=_;};
            return force;
        }

        if(groups.length>0){
            var targetProp=colorMode==='folder'?'folder':'layer';
            var forceStrength=0.15; // Moderate grouping force to allow link connections to stretch organic shapes
            graph.d3Force('x',customForce('x',function(d){return centers[d[targetProp]]?centers[d[targetProp]].x:0;},forceStrength));
            graph.d3Force('y',customForce('y',function(d){return centers[d[targetProp]]?centers[d[targetProp]].y:0;},forceStrength));
            graph.d3Force('z',customForce('z',function(d){return centers[d[targetProp]]?centers[d[targetProp]].z:0;},forceStrength));
        }else{
            // Clear clustering forces when not in folder/layer mode
            graph.d3Force('x',null);
            graph.d3Force('y',null);
            graph.d3Force('z',null);
        }

        return function(){clearTimeout(rotationTimer);};
    },[data,colorMap,colorMode,theme,folderFilter,selectedPath,blastRadius,config.linkDist,config.spacing,config.showLabels,config.curvedLinks,config.autoRotate,lineThickness]);

    useEffect(function(){
        const observer=new ResizeObserver(function(){
            const graph=graph3dInstanceRef.current,container=graph3dRef.current;
            if(graph&&container)graph.width(container.clientWidth||800).height(container.clientHeight||600);
        });
        observer.observe(graph3dRef.current);
        return function(){
            observer.disconnect();
            const graph=graph3dInstanceRef.current;
            if(graph){graph.pauseAnimation();graph.graphData({nodes:[],links:[]});graph._destructor();graph3dInstanceRef.current=null;}
        };
    },[]);
    return React.createElement('div',{ref:graph3dRef,className:'graph3d-container',style:{width:'100%',height:'100%'}});
    });
}
