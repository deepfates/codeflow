import { unionPaddedBoxes, liveGraphNodeXY } from './canvas-layout.mjs';
import { snapshotZoomTransform } from './camera.mjs';

export function minimapWorldFromBoxes(boxes,pad){
    var union=unionPaddedBoxes(boxes,pad==null?48:pad,0);
    if(!union)return null;
    return{
        minX:union.x,
        minY:union.y,
        maxX:union.x+union.width,
        maxY:union.y+union.height,
        width:union.width,
        height:union.height
    };
}

export function minimapCardInputs(vizType,sizesByPath,cardPaths){
    if(vizType!=='code')return{sizesByPath:null,cardPaths:null};
    return{sizesByPath:sizesByPath||null,cardPaths:cardPaths||null};
}

export function collectMinimapWorldBounds(nodes,sizesByPath,cardPaths,pad){
    var boxes=[];
    (nodes||[]).forEach(function(node){
        var xy=liveGraphNodeXY(node);
        if(!xy)return;
        if(cardPaths&&cardPaths.has&&cardPaths.has(node.id)&&sizesByPath&&sizesByPath[node.id]){
            var size=sizesByPath[node.id];
            boxes.push({x:xy.x-size.width/2,y:xy.y-size.height/2,width:size.width,height:size.height});
            return;
        }
        boxes.push({x:xy.x-16,y:xy.y-16,width:32,height:32});
    });
    return minimapWorldFromBoxes(boxes,pad);
}

export function collectMinimapContent(nodes,sizesByPath,cardPaths,colorOf,pad){
    var marks=[];
    var boxes=[];
    var folders=Object.create(null);
    (nodes||[]).forEach(function(node){
        var xy=liveGraphNodeXY(node);
        if(!xy)return;
        var folder=node.folder||'root';
        var color=typeof colorOf==='function'?colorOf(node):null;
        var isCard=!!(cardPaths&&cardPaths.has&&cardPaths.has(node.id)&&sizesByPath&&sizesByPath[node.id]);
        var box;
        if(isCard){
            var size=sizesByPath[node.id];
            box={x:xy.x-size.width/2,y:xy.y-size.height/2,width:size.width,height:size.height};
            marks.push({kind:'card',x:box.x,y:box.y,width:box.width,height:box.height,color:color,folder:folder});
        }else{
            box={x:xy.x-16,y:xy.y-16,width:32,height:32};
            marks.push({kind:'node',x:xy.x,y:xy.y,color:color,folder:folder});
        }
        if(!folders[folder])folders[folder]={boxes:[],color:color};
        folders[folder].boxes.push(box);
        boxes.push(box);
        if(color)folders[folder].color=color;
    });
    var hulls=[];
    Object.keys(folders).forEach(function(folder){
        var union=unionPaddedBoxes(folders[folder].boxes,18,0);
        if(union)hulls.push({folder:folder,color:folders[folder].color,x:union.x,y:union.y,width:union.width,height:union.height});
    });
    return{marks:marks,hulls:hulls,world:minimapWorldFromBoxes(boxes,pad)};
}

export function viewportWorldRect(transform,viewW,viewH){
    var t=snapshotZoomTransform(transform);
    var w=Number(viewW);
    var h=Number(viewH);
    if(!isFinite(w)||w<=0)w=800;
    if(!isFinite(h)||h<=0)h=600;
    return{x:-t.x/t.k,y:-t.y/t.k,width:w/t.k,height:h/t.k};
}

export function minimapFitRect(world,mapW,mapH,pad){
    mapW=Number(mapW);
    mapH=Number(mapH);
    if(!world||!isFinite(world.width)||!isFinite(world.height)||world.width<=0||world.height<=0)return null;
    if(!isFinite(mapW)||!isFinite(mapH)||mapW<=0||mapH<=0)return null;
    pad=pad==null?8:Number(pad);
    if(!isFinite(pad)||pad<0)pad=0;
    var innerW=Math.max(1,mapW-pad*2);
    var innerH=Math.max(1,mapH-pad*2);
    var scale=Math.min(innerW/world.width,innerH/world.height);
    if(!isFinite(scale)||scale<=0)scale=1;
    var usedW=world.width*scale;
    var usedH=world.height*scale;
    return{scale:scale,ox:pad+(innerW-usedW)/2,oy:pad+(innerH-usedH)/2};
}

export function worldToMinimap(x,y,world,fit){
    if(!world||!fit)return{x:0,y:0};
    return{x:(Number(x)-world.minX)*fit.scale+fit.ox,y:(Number(y)-world.minY)*fit.scale+fit.oy};
}

export function clampMinimapPoint(mx,my,world,fit){
    mx=Number(mx);
    my=Number(my);
    if(!world||!fit||!isFinite(Number(fit.scale))||!fit.scale){
        return{x:isFinite(mx)?mx:0,y:isFinite(my)?my:0};
    }
    var minX=Number(fit.ox)||0;
    var minY=Number(fit.oy)||0;
    var maxX=minX+Number(world.width)*Number(fit.scale);
    var maxY=minY+Number(world.height)*Number(fit.scale);
    if(!isFinite(maxX)||maxX<minX)maxX=minX;
    if(!isFinite(maxY)||maxY<minY)maxY=minY;
    if(!isFinite(mx))mx=minX;
    if(!isFinite(my))my=minY;
    if(mx<minX)mx=minX;
    else if(mx>maxX)mx=maxX;
    if(my<minY)my=minY;
    else if(my>maxY)my=maxY;
    return{x:mx,y:my};
}

export function minimapToWorld(mx,my,world,fit){
    if(!world||!fit||!fit.scale)return{x:0,y:0};
    var p=clampMinimapPoint(mx,my,world,fit);
    return{x:(p.x-fit.ox)/fit.scale+world.minX,y:(p.y-fit.oy)/fit.scale+world.minY};
}

export function zoomTransformToCenterWorld(worldX,worldY,scale,viewW,viewH){
    var k=Number(scale);
    if(!isFinite(k)||k<=0)k=1;
    var w=Number(viewW);
    var h=Number(viewH);
    if(!isFinite(w)||w<=0)w=800;
    if(!isFinite(h)||h<=0)h=600;
    return{k:k,x:w/2-Number(worldX)*k,y:h/2-Number(worldY)*k};
}

export function zoomTransformFromMinimapPoint(mx,my,world,fit,transform,viewW,viewH){
    var pt=minimapToWorld(mx,my,world,fit);
    var t=snapshotZoomTransform(transform);
    return zoomTransformToCenterWorld(pt.x,pt.y,t.k,viewW,viewH);
}

export function zoomTransformNudgeWorld(transform,dxWorld,dyWorld){
    var t=snapshotZoomTransform(transform);
    var dx=Number(dxWorld);
    var dy=Number(dyWorld);
    if(!isFinite(dx))dx=0;
    if(!isFinite(dy))dy=0;
    return{k:t.k,x:t.x-dx*t.k,y:t.y-dy*t.k};
}

export function panTransformByViewportFraction(transform,dxFrac,dyFrac,viewW,viewH){
    var view=viewportWorldRect(transform,viewW,viewH);
    var fx=Number(dxFrac);
    var fy=Number(dyFrac);
    if(!isFinite(fx))fx=0;
    if(!isFinite(fy))fy=0;
    return zoomTransformNudgeWorld(transform,view.width*fx,view.height*fy);
}

export function panTransformToWorldMidpoint(transform,world,viewW,viewH){
    var t=snapshotZoomTransform(transform);
    if(!world)return t;
    var midX=(Number(world.minX)+Number(world.maxX))/2;
    var midY=(Number(world.minY)+Number(world.maxY))/2;
    if(!isFinite(midX)||!isFinite(midY))return t;
    return zoomTransformToCenterWorld(midX,midY,t.k,viewW,viewH);
}

export function minimapPointerXY(clientX,clientY,rect){
    rect=rect||{};
    return{x:(Number(clientX)||0)-(Number(rect.left)||0),y:(Number(clientY)||0)-(Number(rect.top)||0)};
}

export function colorWithAlpha(color,alpha){
    color=String(color||'');
    var a=Number(alpha);
    if(!isFinite(a))a=1;
    if(a<0)a=0;
    if(a>1)a=1;
    if(color.charAt(0)==='#'&&(color.length===7||color.length===4)){
        var r,g,b;
        if(color.length===4){
            r=parseInt(color.charAt(1)+color.charAt(1),16);
            g=parseInt(color.charAt(2)+color.charAt(2),16);
            b=parseInt(color.charAt(3)+color.charAt(3),16);
        }else{
            r=parseInt(color.slice(1,3),16);
            g=parseInt(color.slice(3,5),16);
            b=parseInt(color.slice(5,7),16);
        }
        if(isFinite(r)&&isFinite(g)&&isFinite(b))return 'rgba('+r+','+g+','+b+','+a+')';
    }
    return color;
}

export function readMinimapTheme(el){
    var styles=el&&typeof getComputedStyle==='function'?getComputedStyle(el):null;
    function css(name,fallback){
        var v=styles?String(styles.getPropertyValue(name)||'').trim():'';
        return v||fallback;
    }
    return{
        bg:css('--bg1','#0f0f12'),
        acc:css('--acc','#00ff9d'),
        muted:css('--t3','#5c5c66')
    };
}

export function clearCanvasMinimap(canvas){
    if(!canvas||typeof canvas.getContext!=='function')return false;
    var ctx=canvas.getContext('2d');
    if(!ctx)return false;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,canvas.width||0,canvas.height||0);
    return true;
}

export function drawCanvasMinimap(canvas,model){
    if(!canvas||typeof canvas.getContext!=='function'||!model||!model.fit||!model.world)return false;
    var ctx=canvas.getContext('2d');
    if(!ctx)return false;
    var dpr=typeof window!=='undefined'&&window.devicePixelRatio?window.devicePixelRatio:1;
    if(!isFinite(dpr)||dpr<=0)dpr=1;
    var w=Number(model.mapW);
    var h=Number(model.mapH);
    if(!isFinite(w)||w<=0)w=176;
    if(!isFinite(h)||h<=0)h=118;
    var pixelW=Math.max(1,Math.round(w*dpr));
    var pixelH=Math.max(1,Math.round(h*dpr));
    if(canvas.width!==pixelW||canvas.height!==pixelH){
        canvas.width=pixelW;
        canvas.height=pixelH;
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    var theme=model.theme||{};
    var acc=theme.acc||'#00ff9d';
    var muted=theme.muted||'#5c5c66';
    (model.hulls||[]).forEach(function(hull){
        if(!hull)return;
        var p1=worldToMinimap(hull.x,hull.y,model.world,model.fit);
        var p2=worldToMinimap(hull.x+hull.width,hull.y+hull.height,model.world,model.fit);
        var hx=p1.x,hy=p1.y,hw=Math.max(2,p2.x-p1.x),hh=Math.max(2,p2.y-p1.y);
        ctx.beginPath();
        ctx.fillStyle=colorWithAlpha(hull.color||muted,0.12);
        ctx.strokeStyle=colorWithAlpha(hull.color||muted,0.4);
        ctx.lineWidth=1;
        if(typeof ctx.roundRect==='function')ctx.roundRect(hx,hy,hw,hh,3);
        else ctx.rect(hx,hy,hw,hh);
        ctx.fill();
        ctx.stroke();
    });
    (model.marks||[]).forEach(function(mark){
        if(!mark||mark.kind!=='card')return;
        var c1=worldToMinimap(mark.x,mark.y,model.world,model.fit);
        var c2=worldToMinimap(mark.x+mark.width,mark.y+mark.height,model.world,model.fit);
        ctx.fillStyle=colorWithAlpha(mark.color||acc,0.32);
        ctx.fillRect(c1.x,c1.y,Math.max(2,c2.x-c1.x),Math.max(2,c2.y-c1.y));
    });
    (model.marks||[]).forEach(function(mark){
        if(!mark||mark.kind!=='node')return;
        var p=worldToMinimap(mark.x,mark.y,model.world,model.fit);
        ctx.beginPath();
        ctx.fillStyle=mark.color||acc;
        ctx.arc(p.x,p.y,1.7,0,Math.PI*2);
        ctx.fill();
    });
    if(model.viewport){
        var v=model.viewport;
        var v1=worldToMinimap(v.x,v.y,model.world,model.fit);
        var v2=worldToMinimap(v.x+v.width,v.y+v.height,model.world,model.fit);
        ctx.fillStyle=colorWithAlpha(acc,0.1);
        ctx.strokeStyle=acc;
        ctx.lineWidth=1.25;
        ctx.fillRect(v1.x,v1.y,v2.x-v1.x,v2.y-v1.y);
        ctx.strokeRect(v1.x,v1.y,v2.x-v1.x,v2.y-v1.y);
    }
    return true;
}
