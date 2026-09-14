import { codeCardVisualLineIndex, CODE_CARD_HEAD_HEIGHT, CODE_CARD_LINE_HEIGHT, codeCardSize } from './card-size.mjs';

export function codeCardSymbolLine(file,name){
    if(!file||!name)return null;
    var fns=file.functions||[];
    var i;
    for(i=0;i<fns.length;i++){
        if(fns[i]&&fns[i].name===name&&fns[i].line)return fns[i].line;
    }
    var content=String(file.content||'');
    if(!content)return null;
    var escaped=String(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    var re=new RegExp('(?:^|[^A-Za-z0-9_$])'+escaped+'(?:[^A-Za-z0-9_$]|$)');
    var lines=content.split('\n');
    for(i=0;i<lines.length;i++){
        if(re.test(lines[i]))return i+1;
    }
    return null;
}

export function codeCardLineY(size,line,file,prefs){
    var n=Math.max(1,Number(line)||1);
    var visual=file?codeCardVisualLineIndex(file,n,prefs):n;
    return CODE_CARD_HEAD_HEIGHT+8+(visual-0.5)*CODE_CARD_LINE_HEIGHT;
}

export function codeLinkPrefersVertical(src,tgt){
    if(!src||!tgt||!isFinite(src.x)||!isFinite(tgt.x))return false;
    return Math.abs(src.x-tgt.x)<1;
}

export function codeEdgeBezier(x1,y1,x2,y2){
    var dxAbs=Math.abs(x2-x1);
    var dyAbs=Math.abs(y2-y1);
    if(dxAbs<1&&dyAbs>0){
        var vspan=Math.max(80,dyAbs*0.45);
        var dy=(y2<y1?-1:1)*vspan;
        return 'M'+x1+','+y1+'C'+x1+','+(y1+dy)+' '+x2+','+(y2-dy)+' '+x2+','+y2;
    }
    var span=Math.max(80,dxAbs*0.45);
    var dx=(x2<x1?-1:1)*span;
    return 'M'+x1+','+y1+'C'+(x1+dx)+','+y1+' '+(x2-dx)+','+y2+' '+x2+','+y2;
}

export function codeCardAnchorY(node,size,line){
    size=size||codeCardSize(null);
    var y=line?codeCardLineY(size,line):CODE_CARD_HEAD_HEIGHT+(size.height-CODE_CARD_HEAD_HEIGHT)/2;
    if(!isFinite(y))y=size.height/2;
    y=Math.max(CODE_CARD_HEAD_HEIGHT+6,Math.min(size.height-8,y));
    return (node&&isFinite(node.y)?node.y:0)-size.height/2+y;
}

export function codeCardLinkEndpoint(node,size,file,other,fn,isCard,vertical){
    if(!isCard)return{x:node.x,y:node.y};
    size=size||codeCardSize(file);
    if(vertical){
        var top=node.y-size.height/2;
        var bottom=node.y+size.height/2;
        var towardY=other&&isFinite(other.y)?other.y:bottom+1;
        return{x:node.x,y:towardY<node.y?top:bottom};
    }
    var line=fn?codeCardSymbolLine(file,fn):null;
    var y=codeCardAnchorY(node,size,line);
    var left=node.x-size.width/2;
    var right=node.x+size.width/2;
    var toward=other&&isFinite(other.x)?other.x:right+1;
    return{x:toward<node.x?left:right,y:y};
}

export function codeCardLinkPath(link,sizesByPath,filesByPath,cardPaths){
    var src=link&&link.source;
    var tgt=link&&link.target;
    if(!src||!tgt||typeof src!=='object'||typeof tgt!=='object')return null;
    var srcIsCard=!!(cardPaths&&cardPaths.has(src.id));
    var tgtIsCard=!!(cardPaths&&cardPaths.has(tgt.id));
    if(!srcIsCard&&!tgtIsCard)return null;
    if(!isFinite(src.x)||!isFinite(src.y)||!isFinite(tgt.x)||!isFinite(tgt.y))return null;
    var srcFile=filesByPath&&filesByPath[src.id];
    var tgtFile=filesByPath&&filesByPath[tgt.id];
    var srcSize=(sizesByPath&&sizesByPath[src.id])||codeCardSize(srcFile);
    var tgtSize=(sizesByPath&&sizesByPath[tgt.id])||codeCardSize(tgtFile);
    var fn=link.fn;
    var vertical=codeLinkPrefersVertical(src,tgt);
    var p1=codeCardLinkEndpoint(src,srcSize,srcFile,tgt,fn,srcIsCard,vertical);
    var p2=codeCardLinkEndpoint(tgt,tgtSize,tgtFile,src,fn,tgtIsCard,vertical);
    return codeEdgeBezier(p1.x,p1.y,p2.x,p2.y);
}
