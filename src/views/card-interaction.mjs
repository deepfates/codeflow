import { CODE_CARD_WIDTH, CODE_CARD_MIN_HEIGHT, codeCardSize } from './card-size.mjs';
import { liveGraphNodeXY } from './canvas-layout.mjs';
import { readableLabelScale, zoomHidesCodeText, zoomShowsColorBlocks } from './graph-style.mjs';

export function noteCodeCardPointerEnd(moved){
    return {select:!moved,ignoreNextClick:!!moved};
}

export function consumeCodeCardClick(ignoreNextClick){
    return {ignore:!!ignoreNextClick,ignoreNextClick:false};
}

export function codeCardDragDelta(clientX,clientY,startX,startY,scale,threshold){
    var screenX=(Number(clientX)||0)-(Number(startX)||0);
    var screenY=(Number(clientY)||0)-(Number(startY)||0);
    var k=Number(scale);
    if(!isFinite(k)||k<=0)k=1;
    var limit=threshold==null?3:Number(threshold);
    if(!isFinite(limit))limit=3;
    return{
        x:screenX/k,
        y:screenY/k,
        screenX:screenX,
        screenY:screenY,
        moved:Math.abs(screenX)+Math.abs(screenY)>limit
    };
}

export function codeCardResizeDelta(clientX,clientY,startX,startY,startW,startH,scale,edge){
    var k=Number(scale);
    if(!isFinite(k)||k<=0)k=1;
    var dx=((Number(clientX)||0)-(Number(startX)||0))/k;
    var dy=((Number(clientY)||0)-(Number(startY)||0))/k;
    var width=Number(startW)||CODE_CARD_WIDTH;
    var height=Number(startH)||CODE_CARD_MIN_HEIGHT;
    if(edge==='e'||edge==='se')width+=dx;
    if(edge==='s'||edge==='se')height+=dy;
    return{width:width,height:height,dx:dx,dy:dy};
}

export function codeViewDragRefresh(phase){
    return phase==='release';
}

export function raiseCodeCardStack(order,path){
    var next=[];
    (order||[]).forEach(function(id){
        if(id&&id!==path)next.push(id);
    });
    if(path)next.push(path);
    return next;
}

export function codeCardZIndex(order,path){
    var i=(order||[]).indexOf(path);
    return i<0?1:i+2;
}

export function applyCodeCardStackOrder(layer,order){
    if(!layer||!layer.querySelectorAll)return 0;
    var cards=layer.querySelectorAll('[data-code-card]');
    var n=0;
    Array.prototype.forEach.call(cards,function(card){
        var path=card.getAttribute('data-code-card');
        card.style.zIndex=String(codeCardZIndex(order,path));
        n++;
    });
    return n;
}

export function findCodeCardElement(layer,path){
    if(!layer||!layer.querySelectorAll||!path)return null;
    var cards=layer.querySelectorAll('[data-code-card]');
    var i;
    for(i=0;i<cards.length;i++){
        if(cards[i].getAttribute('data-code-card')===path)return cards[i];
    }
    return null;
}

export function applyCodeCardDragFrame(layer,path,node,size){
    var card=findCodeCardElement(layer,path);
    if(!card)return false;
    var style=codeCardAnchorStyle(node,size);
    card.style.visibility=style.visibility;
    card.style.left=style.left;
    card.style.top=style.top;
    return style.visibility==='visible';
}

export function applyCodeCardResizeFrame(card,size){
    if(!card||!size)return false;
    card.style.width=size.width+'px';
    card.style.height=size.height+'px';
    if(card.classList){
        if(size.clipped&&card.classList.add)card.classList.add('clipped');
        else if(card.classList.remove)card.classList.remove('clipped');
    }
    return true;
}

export function codeViewWheelAction(event){
    if(event&&(event.ctrlKey||event.metaKey))return 'zoom';
    return 'pan';
}

export function codeViewWheelPanDelta(deltaX,deltaY,scale){
    var k=Number(scale);
    if(!isFinite(k)||k<=0)k=1;
    return{x:-(Number(deltaX)||0)/k,y:-(Number(deltaY)||0)/k};
}

export function codeCanvasTransformStyle(transform){
    var t=transform||{};
    var k=Number(t.k);
    if(!isFinite(k)||k<=0)k=1;
    var x=Number(t.x);
    if(!isFinite(x))x=0;
    var y=Number(t.y);
    if(!isFinite(y))y=0;
    return 'translate('+x+'px,'+y+'px) scale('+k+')';
}

export function codeCardAnchorStyle(node,size){
    size=size||codeCardSize(null);
    var xy=liveGraphNodeXY(node);
    if(!xy)return{visibility:'hidden',left:'0px',top:'0px'};
    return{
        visibility:'visible',
        left:(xy.x-size.width/2)+'px',
        top:(xy.y-size.height/2)+'px'
    };
}

export function applyCodeCardLayout(layer,nodesById,transform,sizesByPath,stackOrder){
    if(!layer)return{placed:0,titleScale:1};
    layer.style.transform=codeCanvasTransformStyle(transform);
    var k=transform&&isFinite(Number(transform.k))?Number(transform.k):1;
    var titleScale=readableLabelScale(k);
    var cards=layer.querySelectorAll?layer.querySelectorAll('[data-code-card]'):[];
    var placed=0;
    Array.prototype.forEach.call(cards,function(card){
        var path=card.getAttribute('data-code-card');
        var size=(sizesByPath&&sizesByPath[path])||codeCardSize(null);
        var style=codeCardAnchorStyle(nodesById&&nodesById[path],size);
        card.style.visibility=style.visibility;
        card.style.left=style.left;
        card.style.top=style.top;
        card.style.width=size.width+'px';
        card.style.height=size.height+'px';
        if(stackOrder)card.style.zIndex=String(codeCardZIndex(stackOrder,path));
        if(card.classList){
            if(size.clipped&&card.classList.add)card.classList.add('clipped');
            else if(card.classList.remove)card.classList.remove('clipped');
            if(size.expand&&card.classList.add)card.classList.add('expand');
            else if(card.classList.remove)card.classList.remove('expand');
            if(size.wrap&&card.classList.add)card.classList.add('wrap');
            else if(card.classList.remove)card.classList.remove('wrap');
        }
        var title=card.querySelector?card.querySelector('.code-card-name'):null;
        if(title)title.style.transform='scale('+titleScale+')';
        if(card.classList){
            if(zoomHidesCodeText(k)&&card.classList.add)card.classList.add('code-far');
            else if(card.classList.remove)card.classList.remove('code-far');
            if(zoomShowsColorBlocks(k)&&card.classList.add)card.classList.add('code-blocks');
            else if(card.classList.remove)card.classList.remove('code-blocks');
        }
        if(style.visibility==='visible')placed++;
    });
    return{placed:placed,titleScale:titleScale,colorBlocks:zoomShowsColorBlocks(k),codeFar:zoomHidesCodeText(k)};
}

export function readCodeCardBodyScroll(layer,path){
    if(!layer||!path)return 0;
    var cards=layer.querySelectorAll?layer.querySelectorAll('[data-code-card]'):[];
    for(var i=0;i<cards.length;i++){
        if(cards[i].getAttribute('data-code-card')!==path)continue;
        var body=cards[i].querySelector?cards[i].querySelector('.code-card-body'):null;
        var top=body?Number(body.scrollTop):0;
        return isFinite(top)?top:0;
    }
    return 0;
}

export function isCodeCanvasDeselectTarget(target,svg){
    if(!target||!svg)return false;
    if(target===svg)return true;
    if(target.getAttribute&&target.getAttribute('data-code-bg')==='1')return true;
    return !!(target.closest&&target.closest('[data-code-bg="1"]'));
}

export function isCodeCanvasNativeScrollTarget(target){
    if(!target||!target.closest)return false;
    if(target.closest('.code-sym-list'))return true;
    if(!target.closest('.code-card.clipped .code-card-body'))return false;
    return !target.closest('.code-card.code-far');
}

export function codeViewWheelUsesNativeScroll(event,target){
    if(codeViewWheelAction(event)==='zoom')return false;
    return isCodeCanvasNativeScrollTarget(target);
}
