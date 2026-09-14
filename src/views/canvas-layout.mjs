import { codeCardSize, CODE_CARD_MIN_HEIGHT } from './card-size.mjs';

export function nodeReplacedByCard(path,cardPaths){
    return !!(cardPaths&&cardPaths.has(path));
}

export function unburyNodesFromCards(nodes,cardPaths,sizesByPath,pad,boxesByPath){
    pad=pad==null?36:pad;
    var list=nodes||[];
    var cards=[];
    list.forEach(function(node){
        if(!node||!cardPaths||!cardPaths.has(node.id))return;
        var box=cardWorldBox(node,sizesByPath,boxesByPath);
        if(!box)return;
        cards.push({node:node,box:box});
    });
    if(!cards.length)return list;
    var pass;
    for(pass=0;pass<4;pass++){
        var moved=false;
        list.forEach(function(node){
            if(!node||(cardPaths&&cardPaths.has(node.id)))return;
            var xy=liveGraphNodeXY(node);
            if(!xy)return;
            cards.forEach(function(card){
                var box=card.box;
                var left=box.x-pad,top=box.y-pad,right=box.x+box.width+pad,bottom=box.y+box.height+pad;
                if(xy.x<left||xy.x>right||xy.y<top||xy.y>bottom)return;
                var dLeft=xy.x-left,dRight=right-xy.x,dTop=xy.y-top,dBottom=bottom-xy.y;
                var min=Math.min(dLeft,dRight,dTop,dBottom);
                if(min===dLeft)xy.x=left;
                else if(min===dRight)xy.x=right;
                else if(min===dTop)xy.y=top;
                else xy.y=bottom;
                node.x=xy.x;node.y=xy.y;
                if(node.fx!=null)node.fx=node.x;
                if(node.fy!=null)node.fy=node.y;
                moved=true;
            });
        });
        if(!moved)break;
    }
    return list;
}

export function graphFolderCenters(folders,width,height,options){
    options=options||{};
    var list=[];
    (folders||[]).forEach(function(f){if(f!=null&&list.indexOf(f)<0)list.push(f);});
    var out=Object.create(null);
    if(!list.length)return out;
    var cols=Math.max(2,Math.ceil(Math.sqrt(list.length)));
    var rows=Math.max(1,Math.ceil(list.length/cols));
    var minW=options.minCellW==null?0:Number(options.minCellW)||0;
    var minH=options.minCellH==null?0:Number(options.minCellH)||0;
    var cw=Math.max(minW,(Number(width)||800)/(cols+1));
    var ch=Math.max(minH,(Number(height)||600)/(rows+1));
    list.forEach(function(f,i){
        out[f]={x:(i%cols+1)*cw,y:(Math.floor(i/cols)+1)*ch};
    });
    return out;
}

export function leftoverCodeNodeGrid(count,spacing){
    spacing=spacing==null?56:Number(spacing)||56;
    count=Math.max(0,Math.floor(Number(count)||0));
    var out=[];
    if(count<=0)return out;
    var cols=Math.max(1,Math.ceil(Math.sqrt(count)));
    var rows=Math.max(1,Math.ceil(count/cols));
    var i;
    for(i=0;i<count;i++){
        var col=i%cols;
        var row=Math.floor(i/cols);
        out.push({
            x:(col-(cols-1)/2)*spacing,
            y:(row-(rows-1)/2)*spacing
        });
    }
    return out;
}

export function parkLeftoverCodeNodes(nodes,cardPaths,centers,options){
    options=options||{};
    var spacing=options.spacing==null?56:options.spacing;
    var pin=options.pin!==false;
    var groups=Object.create(null);
    var order=[];
    (nodes||[]).forEach(function(node){
        if(!node)return;
        if(cardPaths&&cardPaths.has(node.id))return;
        if(node.fx!=null&&isFinite(Number(node.fx)))return;
        var folder=node.folder||'root';
        if(!groups[folder]){
            groups[folder]=[];
            order.push(folder);
        }
        groups[folder].push(node);
    });
    order.forEach(function(folder){
        var group=groups[folder];
        var c=centers&&centers[folder];
        if(!c||!isFinite(c.x)||!isFinite(c.y))return;
        var offs=leftoverCodeNodeGrid(group.length,spacing);
        group.forEach(function(node,i){
            node.x=c.x+offs[i].x;
            node.y=c.y+offs[i].y;
            if(pin){
                node.fx=node.x;
                node.fy=node.y;
            }
        });
    });
    return nodes;
}

export function codeViewSiblingNodes(nodes,dragged,cardPaths){
    if(!dragged)return[];
    var folder=dragged.folder||'root';
    var out=[];
    (nodes||[]).forEach(function(node){
        if(!node||node===dragged||node.id===dragged.id)return;
        if(cardPaths&&cardPaths.has(node.id))return;
        if((node.folder||'root')!==folder)return;
        out.push(node);
    });
    return out;
}

export function translateCodeViewSiblings(nodes,dragged,dx,dy,cardPaths){
    dx=Number(dx)||0;
    dy=Number(dy)||0;
    if(!dx&&!dy)return[];
    var siblings=codeViewSiblingNodes(nodes,dragged,cardPaths);
    siblings.forEach(function(node){
        if(isFinite(node.x))node.x+=dx;
        if(isFinite(node.y))node.y+=dy;
        if(node.fx!=null&&isFinite(Number(node.fx)))node.fx=node.x;
        if(node.fy!=null&&isFinite(Number(node.fy)))node.fy=node.y;
    });
    return siblings;
}

export function nodeWorldBox(node,size){
    if(!node||!size)return null;
    var xy=liveGraphNodeXY(node);
    if(!xy)return null;
    var width=Number(size.width)||0;
    var height=Number(size.height)||0;
    if(width<=0||height<=0)return null;
    return{x:xy.x-width/2,y:xy.y-height/2,width:width,height:height};
}

export function cardWorldBox(node,sizesByPath,boxesByPath){
    if(!node)return null;
    var size=(sizesByPath&&sizesByPath[node.id])||codeCardSize(null);
    var live=nodeWorldBox(node,size);
    var snap=boxesByPath&&boxesByPath[node.id];
    if(!snap)return live;
    if(!live)return snap;
    var liveCx=live.x+live.width/2,liveCy=live.y+live.height/2;
    var snapCx=snap.x+snap.width/2,snapCy=snap.y+snap.height/2;
    if(Math.abs(liveCx-snapCx)>0.5||Math.abs(liveCy-snapCy)>0.5){
        return{x:liveCx-snap.width/2,y:liveCy-snap.height/2,width:snap.width,height:snap.height};
    }
    return snap;
}

export function resolveBoxOverlap(box,obstacles,gap){
    if(!box)return null;
    gap=gap==null?24:Number(gap)||0;
    var next={x:box.x,y:box.y,width:box.width,height:box.height};
    var pass;
    for(pass=0;pass<8;pass++){
        var hit=null;
        (obstacles||[]).forEach(function(obs){
            if(!hit&&boxesOverlap(next,obs,gap))hit=obs;
        });
        if(!hit)break;
        var slack=gap+1;
        var right=(hit.x+hit.width+slack)-next.x;
        var left=next.x+next.width+slack-hit.x;
        var down=(hit.y+hit.height+slack)-next.y;
        var up=next.y+next.height+slack-hit.y;
        if(right<=left&&right<=down&&right<=up)next.x+=right;
        else if(left<=down&&left<=up)next.x-=left;
        else if(down<=up)next.y+=down;
        else next.y-=up;
    }
    return next;
}

export function bumpOverlappingCodeCards(nodes,droppedId,cardPaths,sizesByPath,gap){
    if(!droppedId)return null;
    var dropped=null;
    var obstacles=[];
    (nodes||[]).forEach(function(node){
        if(!node||!cardPaths||!cardPaths.has(node.id))return;
        var size=(sizesByPath&&sizesByPath[node.id])||codeCardSize(null);
        var box=nodeWorldBox(node,size);
        if(!box)return;
        if(node.id===droppedId)dropped={node:node,size:size,box:box};
        else obstacles.push(box);
    });
    if(!dropped)return null;
    var next=resolveBoxOverlap(dropped.box,obstacles,gap);
    if(!next)return dropped.node;
    dropped.node.x=dropped.node.fx=next.x+next.width/2;
    dropped.node.y=dropped.node.fy=next.y+next.height/2;
    return dropped.node;
}

export function leftoverGroupBox(nodes,pad){
    var boxes=[];
    (nodes||[]).forEach(function(node){
        var xy=liveGraphNodeXY(node);
        if(!xy)return;
        boxes.push({x:xy.x-22,y:xy.y-22,width:44,height:44});
    });
    return unionPaddedBoxes(boxes,pad==null?16:pad,0);
}

export function leftoverHullObstacles(nodes,cardPaths){
    var leftoversByFolder=Object.create(null);
    (nodes||[]).forEach(function(node){
        if(!node||(cardPaths&&cardPaths.has(node.id)))return;
        var folder=node.folder||'root';
        if(!leftoversByFolder[folder])leftoversByFolder[folder]=[];
        leftoversByFolder[folder].push(node);
    });
    var hulls=[];
    Object.keys(leftoversByFolder).forEach(function(folder){
        var hull=leftoverGroupBox(leftoversByFolder[folder],16);
        if(hull)hulls.push(hull);
    });
    return hulls;
}

export function nudgeLeftoverGroupsFromCards(nodes,cardPaths,sizesByPath,pad,boxesByPath){
    pad=pad==null?40:pad;
    var cards=[];
    var leftoversByFolder=Object.create(null);
    (nodes||[]).forEach(function(node){
        if(!node)return;
        if(cardPaths&&cardPaths.has(node.id)){
            var box=cardWorldBox(node,sizesByPath,boxesByPath);
            if(box)cards.push(box);
            return;
        }
        var folder=node.folder||'root';
        if(!leftoversByFolder[folder])leftoversByFolder[folder]=[];
        leftoversByFolder[folder].push(node);
    });
    Object.keys(leftoversByFolder).forEach(function(folder){
        var group=leftoversByFolder[folder];
        var hull=leftoverGroupBox(group,16);
        if(!hull)return;
        var next=resolveBoxOverlap(hull,cards,pad);
        if(!next)return;
        var dx=next.x-hull.x;
        var dy=next.y-hull.y;
        if(!dx&&!dy)return;
        group.forEach(function(node){
            if(isFinite(node.x))node.x+=dx;
            if(isFinite(node.y))node.y+=dy;
            if(node.fx!=null)node.fx=node.x;
            if(node.fy!=null)node.fy=node.y;
        });
    });
    return nodes;
}

export function leftoverSpatialCellKey(x,y,cell){
    var size=Number(cell);
    if(!isFinite(size)||size<=0)size=36;
    return Math.floor((Number(x)||0)/size)+'\t'+Math.floor((Number(y)||0)/size);
}

export function leftoverSeparationNeighbors(a,b,gap){
    if(!a||!b||a===b)return false;
    var dx=b.x-a.x,dy=b.y-a.y;
    var dist=Math.hypot(dx,dy);
    if(dist>=gap)return false;
    var push=(gap-(dist||0.01))/2;
    var nx=dist<1e-6?1:dx/dist;
    var ny=dist<1e-6?0:dy/dist;
    a.x-=nx*push;
    a.y-=ny*push;
    b.x+=nx*push;
    b.y+=ny*push;
    if(a.fx!=null)a.fx=a.x;
    if(a.fy!=null)a.fy=a.y;
    if(b.fx!=null)b.fx=b.x;
    if(b.fy!=null)b.fy=b.y;
    return true;
}

export function leftoverSeparationBuckets(leftovers,cell){
    var buckets=Object.create(null);
    (leftovers||[]).forEach(function(node,i){
        var key=leftoverSpatialCellKey(node.x,node.y,cell);
        if(!buckets[key])buckets[key]=[];
        buckets[key].push(i);
    });
    return buckets;
}

export function separateLeftoverCodeNodes(nodes,cardPaths,gap){
    gap=gap==null?36:Number(gap)||36;
    var leftovers=[];
    (nodes||[]).forEach(function(node){
        if(!node||(cardPaths&&cardPaths.has(node.id)))return;
        if(!isFinite(node.x)||!isFinite(node.y))return;
        leftovers.push(node);
    });
    if(leftovers.length<2)return nodes;
    var cell=Math.max(gap,1);
    var pass,i,ox,oy;
    for(pass=0;pass<6;pass++){
        var buckets=leftoverSeparationBuckets(leftovers,cell);
        var moved=false;
        for(i=0;i<leftovers.length;i++){
            var a=leftovers[i];
            var cx=Math.floor(a.x/cell);
            var cy=Math.floor(a.y/cell);
            for(ox=-1;ox<=1;ox++){
                for(oy=-1;oy<=1;oy++){
                    var group=buckets[cx+ox+'\t'+(cy+oy)];
                    if(!group)continue;
                    group.forEach(function(j){
                        if(j<=i)return;
                        if(leftoverSeparationNeighbors(a,leftovers[j],gap))moved=true;
                    });
                }
            }
        }
        if(!moved)break;
    }
    return nodes;
}

export function settleCodeViewAfterDrag(nodes,cardPaths,sizesByPath,droppedId,options){
    options=options||{};
    var boxesByPath=options.boxesByPath||null;
    var dropped=null;
    if(droppedId){
        (nodes||[]).some(function(node){
            if(node&&node.id===droppedId){dropped=node;return true;}
            return false;
        });
    }
    function applyDroppedDelta(before){
        if(!dropped||!before)return;
        var dx=dropped.x-before.x,dy=dropped.y-before.y;
        if(dx||dy)translateCodeViewSiblings(nodes,dropped,dx,dy,cardPaths);
    }
    var before=dropped?liveGraphNodeXY(dropped):null;
    if(dropped&&cardPaths&&cardPaths.has(dropped.id)){
        bumpOverlappingCodeCards(nodes,dropped.id,cardPaths,sizesByPath,options.cardGap==null?24:options.cardGap);
        applyDroppedDelta(before);
        before=liveGraphNodeXY(dropped);
    }
    var pass;
    for(pass=0;pass<3;pass++){
        nudgeLeftoverGroupsFromCards(nodes,cardPaths,sizesByPath,options.hullPad==null?40:options.hullPad,boxesByPath);
    }
    unburyNodesFromCards(nodes,cardPaths,sizesByPath,options.nodePad==null?48:options.nodePad,boxesByPath);
    if(dropped&&cardPaths&&cardPaths.has(dropped.id)){
        before=liveGraphNodeXY(dropped);
        var hulls=leftoverHullObstacles(nodes,cardPaths);
        var box=cardWorldBox(dropped,sizesByPath,boxesByPath);
        if(box&&hulls.length){
            var next=resolveBoxOverlap(box,hulls,options.hullPad==null?40:options.hullPad);
            if(next&&(next.x!==box.x||next.y!==box.y)){
                dropped.x=dropped.fx=next.x+next.width/2;
                dropped.y=dropped.fy=next.y+next.height/2;
                applyDroppedDelta(before);
            }
        }
    }
    separateLeftoverCodeNodes(nodes,cardPaths,options.nodeGap==null?40:options.nodeGap);
    return nodes;
}

export function boxesOverlap(a,b,gap){
    if(!a||!b)return false;
    gap=gap==null?0:Number(gap)||0;
    return !(a.x>b.x+b.width+gap||a.x+a.width<b.x-gap||a.y>b.y+b.height+gap||a.y+a.height<b.y-gap);
}

export function codeCardCollisionRadius(size){
    size=size||codeCardSize(null);
    return Math.round(Math.hypot(size.width,size.height)/2)+18;
}

export function liveCodeCollideRadius(node,size){
    if(size)return codeCardCollisionRadius(size);
    return Math.max(8,Math.min(24,5+((node&&node.fnCount)||0)*0.8))+12;
}

export function layoutCodeCardsByFolder(files,sizesByPath,options){
    options=options||{};
    var gapX=options.gapX==null?56:options.gapX;
    var gapY=options.gapY==null?48:options.gapY;
    var groupGapX=options.groupGapX==null?96:options.groupGapX;
    var groupGapY=options.groupGapY==null?120:options.groupGapY;
    var originX=options.originX==null?80:options.originX;
    var originY=options.originY==null?80:options.originY;
    var maxRowWidth=options.maxRowWidth==null?2400:options.maxRowWidth;
    var groups=Object.create(null);
    var folderOrder=[];
    (files||[]).forEach(function(file){
        var folder=file&&file.folder?file.folder:'root';
        if(!groups[folder]){groups[folder]=[];folderOrder.push(folder);}
        groups[folder].push(file);
    });
    var placed=Object.create(null);
    var gx=originX,gy=originY,rowH=0;
    folderOrder.forEach(function(folder){
        var items=groups[folder];
        var cols=Math.max(1,Math.ceil(Math.sqrt(items.length)));
        var colWidths=[],rowHeights=[];
        items.forEach(function(file,i){
            var size=(sizesByPath&&sizesByPath[file.path])||codeCardSize(file);
            var col=i%cols,row=Math.floor(i/cols);
            colWidths[col]=Math.max(colWidths[col]||0,size.width);
            rowHeights[row]=Math.max(rowHeights[row]||0,size.height);
        });
        var colX=[],x=0;
        colWidths.forEach(function(w){colX.push(x);x+=w+gapX;});
        var rowY=[],y=36;
        rowHeights.forEach(function(h){rowY.push(y);y+=h+gapY;});
        var groupW=Math.max(0,x-gapX);
        var groupH=Math.max(0,y-gapY);
        if(gx>originX&&gx+groupW>originX+maxRowWidth){
            gx=originX;
            gy+=rowH+groupGapY;
            rowH=0;
        }
        items.forEach(function(file,i){
            var size=(sizesByPath&&sizesByPath[file.path])||codeCardSize(file);
            var col=i%cols,row=Math.floor(i/cols);
            placed[file.path]={
                x:gx+colX[col]+size.width/2,
                y:gy+rowY[row]+size.height/2,
                folder:folder
            };
        });
        gx+=groupW+groupGapX;
        rowH=Math.max(rowH,groupH);
    });
    return placed;
}

export function appendCodeCardPlacement(placements,file,size,options){
    options=options||{};
    var gapX=options.gapX==null?88:options.gapX;
    var gapY=options.gapY==null?36:options.gapY;
    var originX=options.originX==null?80:options.originX;
    var originY=options.originY==null?72:options.originY;
    var next=Object.assign(Object.create(null),placements||{});
    if(!file||!file.path)return next;
    size=size||codeCardSize(file);
    var folder=file.folder||'root';
    var prev=next[file.path];
    if(prev){
        next[file.path]={
            left:prev.left,
            top:prev.top,
            x:prev.left+size.width/2,
            y:prev.top+size.height/2,
            width:size.width,
            height:size.height,
            folder:prev.folder||folder
        };
        return reflowUnpinnedCodeCards(next,options.pinnedPaths,options);
    }
    var same=[];
    var folderLeft=null;
    Object.keys(next).forEach(function(id){
        var item=next[id];
        if(!item||item.folder!==folder)return;
        same.push(item);
        folderLeft=folderLeft==null?item.left:Math.min(folderLeft,item.left);
    });
    var left,top;
    if(!same.length){
        var center=options.centers&&options.centers[folder];
        if(center&&isFinite(center.x)&&isFinite(center.y)){
            left=center.x-size.width/2;
            top=center.y-size.height/2;
        }else{
            var maxRight=originX;
            Object.keys(next).forEach(function(id){
                var item=next[id];
                if(!item)return;
                maxRight=Math.max(maxRight,item.left+item.width+gapX);
            });
            left=Object.keys(next).length?maxRight:originX;
            top=originY;
        }
    }else{
        left=folderLeft;
        var maxBottom=originY;
        same.forEach(function(item){maxBottom=Math.max(maxBottom,item.top+item.height+gapY);});
        top=maxBottom;
    }
    next[file.path]={
        left:left,
        top:top,
        x:left+size.width/2,
        y:top+size.height/2,
        width:size.width,
        height:size.height,
        folder:folder
    };
    return reflowUnpinnedCodeCards(next,options.pinnedPaths,options);
}

export function codePathIsPinned(pinnedPaths,path){
    if(!path||!pinnedPaths)return false;
    if(typeof pinnedPaths.has==='function')return pinnedPaths.has(path);
    return !!pinnedPaths[path];
}

export function reflowUnpinnedCodeCards(placements,pinnedPaths,options){
    options=options||{};
    var gapY=options.gapY==null?36:options.gapY;
    var originY=options.originY==null?72:options.originY;
    var next=placements||Object.create(null);
    var byFolder=Object.create(null);
    Object.keys(next).forEach(function(path){
        var item=next[path];
        if(!item)return;
        var folder=item.folder||'root';
        if(!byFolder[folder])byFolder[folder]=[];
        byFolder[folder].push(path);
    });
    Object.keys(byFolder).forEach(function(folder){
        var paths=byFolder[folder];
        paths.sort(function(a,b){
            var dy=(next[a].top||0)-(next[b].top||0);
            if(dy)return dy;
            return a<b?-1:a>b?1:0;
        });
        var center=options.centers&&options.centers[folder];
        var startY=originY;
        if(center&&isFinite(center.y)){
            var firstH=next[paths[0]]&&next[paths[0]].height;
            startY=center.y-((firstH||CODE_CARD_MIN_HEIGHT)/2);
        }
        var cursor=startY;
        paths.forEach(function(path){
            var item=Object.assign({},next[path]);
            next[path]=item;
            if(codePathIsPinned(pinnedPaths,path)){
                item.x=item.left+item.width/2;
                item.y=item.top+item.height/2;
                cursor=Math.max(cursor,item.top+item.height+gapY);
                return;
            }
            item.top=cursor;
            item.x=item.left+item.width/2;
            item.y=item.top+item.height/2;
            cursor=item.top+item.height+gapY;
        });
    });
    return next;
}

export function layoutOpenedCodeCards(files,prev,sizesByPath,options){
    var placements=Object.assign(Object.create(null),prev||{});
    (files||[]).forEach(function(file){
        placements=appendCodeCardPlacement(placements,file,sizesByPath&&file?sizesByPath[file.path]:null,options);
    });
    return placements;
}

export function liveGraphNodeXY(node){
    if(!node)return null;
    var x=node.fx!=null&&isFinite(Number(node.fx))?Number(node.fx):Number(node.x);
    var y=node.fy!=null&&isFinite(Number(node.fy))?Number(node.fy):Number(node.y);
    if(!isFinite(x)||!isFinite(y))return null;
    return{x:x,y:y};
}

export function readCodeCardWorldBox(card){
    if(!card||!card.style)return null;
    var x=parseFloat(card.style.left);
    var y=parseFloat(card.style.top);
    var width=parseFloat(card.style.width);
    var height=parseFloat(card.style.height);
    if(!isFinite(x)||!isFinite(y)||!isFinite(width)||!isFinite(height)||width<=0||height<=0)return null;
    return{x:x,y:y,width:width,height:height};
}

export function readCodeCardWorldBoxes(layer){
    var out=Object.create(null);
    if(!layer||!layer.querySelectorAll)return out;
    var cards=layer.querySelectorAll('[data-code-card]');
    Array.prototype.forEach.call(cards,function(card){
        var path=card.getAttribute('data-code-card');
        var box=readCodeCardWorldBox(card);
        if(path&&box)out[path]=box;
    });
    return out;
}

export function codeFolderMemberBox(node,sizesByPath,boxesByPath,fallbackR){
    if(!node)return null;
    if(boxesByPath&&boxesByPath[node.id])return boxesByPath[node.id];
    var xy=liveGraphNodeXY(node);
    if(!xy)return null;
    var size=sizesByPath&&sizesByPath[node.id];
    if(size&&isFinite(size.width)&&isFinite(size.height)){
        return{x:xy.x-size.width/2,y:xy.y-size.height/2,width:size.width,height:size.height};
    }
    if(fallbackR){
        return{x:xy.x-fallbackR,y:xy.y-fallbackR,width:fallbackR*2,height:fallbackR*2};
    }
    size=codeCardSize(null);
    return{x:xy.x-size.width/2,y:xy.y-size.height/2,width:size.width,height:size.height};
}

export function unionPaddedBoxes(boxes,pad,labelExtra){
    pad=pad==null?24:pad;
    labelExtra=labelExtra==null?22:labelExtra;
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    (boxes||[]).forEach(function(box){
        if(!box||!isFinite(box.x)||!isFinite(box.y)||!isFinite(box.width)||!isFinite(box.height))return;
        minX=Math.min(minX,box.x);
        minY=Math.min(minY,box.y);
        maxX=Math.max(maxX,box.x+box.width);
        maxY=Math.max(maxY,box.y+box.height);
    });
    if(!isFinite(minX))return null;
    return{x:minX-pad,y:minY-pad-labelExtra,width:maxX-minX+pad*2,height:maxY-minY+pad*2+labelExtra};
}

export function codeFolderCardBounds(nodes,sizesByPath,pad,boxesByPath){
    var boxes=[];
    (nodes||[]).forEach(function(node){
        var box=codeFolderMemberBox(node,sizesByPath,boxesByPath,0);
        if(box)boxes.push(box);
    });
    return unionPaddedBoxes(boxes,pad,22);
}

export function codeFolderHullsByFolder(groups,sizesByPath,pad,boxesByPath){
    var out=Object.create(null);
    Object.keys(groups||{}).forEach(function(folder){
        var group=groups[folder]||{};
        out[folder]=codeFolderHullBounds(group.cards||[],group.leftover||[],sizesByPath,pad,boxesByPath);
    });
    return out;
}

export function codeFolderHullBounds(cardNodes,leftoverNodes,sizesByPath,pad,boxesByPath){
    var boxes=[];
    (cardNodes||[]).forEach(function(node){
        var box=codeFolderMemberBox(node,sizesByPath,boxesByPath,0);
        if(box)boxes.push(box);
    });
    var cardUnion=unionPaddedBoxes(boxes,0,0);
    (leftoverNodes||[]).forEach(function(node){
        var box=codeFolderMemberBox(node,sizesByPath,null,30);
        if(!box)return;
        if(cardUnion&&!boxesOverlap(box,cardUnion,240))return;
        boxes.push(box);
    });
    return unionPaddedBoxes(boxes,pad==null?40:pad,22);
}

export function preserveGraphNodeState(nodes,prevById){
    (nodes||[]).forEach(function(node){
        var prev=prevById&&prevById[node.id];
        if(!prev)return;
        if(isFinite(prev.x))node.x=prev.x;
        if(isFinite(prev.y))node.y=prev.y;
        if(isFinite(prev.vx))node.vx=prev.vx;
        if(isFinite(prev.vy))node.vy=prev.vy;
        if(prev.fx!=null&&isFinite(prev.fx))node.fx=prev.fx;
        if(prev.fy!=null&&isFinite(prev.fy))node.fy=prev.fy;
    });
    return nodes;
}
