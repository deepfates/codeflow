import { codeCardSize } from './card-size.mjs';

export var CODE_VIEW_MIN_FIT_SCALE=0.4;

export var CODE_VIEW_MAX_FIT_SCALE=1.15;

export function snapshotZoomTransform(transform){
    var t=transform||{};
    var k=Number(t.k);
    if(!isFinite(k)||k<=0)k=1;
    var x=Number(t.x);
    if(!isFinite(x))x=0;
    var y=Number(t.y);
    if(!isFinite(y))y=0;
    return {k:k,x:x,y:y};
}

export function shouldFitCodeCamera(cameraReady,vizType){
    return vizType==='code'&&!cameraReady;
}

export function clampCodeViewFitScale(scale){
    var value=Number(scale);
    if(!isFinite(value)||value<=0)return CODE_VIEW_MIN_FIT_SCALE;
    if(value<CODE_VIEW_MIN_FIT_SCALE)return CODE_VIEW_MIN_FIT_SCALE;
    if(value>CODE_VIEW_MAX_FIT_SCALE)return CODE_VIEW_MAX_FIT_SCALE;
    return value;
}

export function codeCardFitBounds(nodes,sizesByPath,cardPaths){
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    (nodes||[]).forEach(function(node){
        if(!node||!cardPaths||!cardPaths.has(node.id)||!isFinite(node.x)||!isFinite(node.y))return;
        var size=(sizesByPath&&sizesByPath[node.id])||codeCardSize(null);
        minX=Math.min(minX,node.x-size.width/2);
        minY=Math.min(minY,node.y-size.height/2);
        maxX=Math.max(maxX,node.x+size.width/2);
        maxY=Math.max(maxY,node.y+size.height/2);
    });
    if(!isFinite(minX))return null;
    return {minX:minX,minY:minY,maxX:maxX,maxY:maxY,cx:(minX+maxX)/2,cy:(minY+maxY)/2};
}
