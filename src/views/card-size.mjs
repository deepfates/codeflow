import { fileForCodeCardDiff } from '../project/changes.mjs';

export function codeCardSizeForDiff(file,prefs,diffRows){
    prefs=normalizeCodeCardPrefs(prefs);
    var base=codeCardSize(file,prefs);
    if(!diffRows||!diffRows.length)return base;
    var painted=codeCardSize(fileForCodeCardDiff(file,diffRows),prefs);
    if(prefs.expand)return painted;
    return Object.assign({},base,{
        naturalHeight:Math.max(base.naturalHeight||0,painted.naturalHeight||0),
        naturalWidth:Math.max(base.naturalWidth||0,painted.naturalWidth||0),
        clipped:!!(base.clipped||painted.naturalHeight>base.height||painted.naturalWidth>base.width)
    });
}

export var CODE_CARD_MIN_WIDTH=320;

export var CODE_CARD_MAX_WIDTH=720;

export var CODE_CARD_MIN_HEIGHT=160;

export var CODE_CARD_MAX_HEIGHT=1840;

export var CODE_CARD_LINE_HEIGHT=19;

export var CODE_CARD_CHAR_WIDTH=7;

export var CODE_CARD_HEAD_HEIGHT=42;

export var CODE_CARD_BODY_PAD=16;

export var CODE_CARD_GUTTER=72;

export function codeCardContentMetrics(file){
    var content=file&&typeof file.content==='string'?file.content:'';
    var lines=content?content.split('\n'):[''];
    var maxLineChars=0;
    var lineChars=[];
    for(var i=0;i<lines.length;i++){
        var n=String(lines[i]).length;
        lineChars.push(n);
        if(n>maxLineChars)maxLineChars=n;
    }
    return{lines:Math.max(1,lines.length),maxLineChars:maxLineChars,lineChars:lineChars};
}

export var CODE_CARD_WIDTH=440;

export function normalizeCodeCardPrefs(prefs){
    prefs=prefs||{};
    return{expand:!!prefs.expand,wrap:!!prefs.wrap};
}

export function codeCardWrapColumns(){
    return Math.max(1,Math.floor((CODE_CARD_WIDTH-CODE_CARD_GUTTER-CODE_CARD_BODY_PAD)/CODE_CARD_CHAR_WIDTH));
}

export function codeCardWrappedLineCount(metrics,prefs){
    metrics=metrics||codeCardContentMetrics(null);
    prefs=normalizeCodeCardPrefs(prefs);
    if(!prefs.wrap)return Math.max(1,metrics.lines||1);
    var cols=codeCardWrapColumns();
    var chars=metrics.lineChars||[];
    var count=0;
    if(!chars.length)return Math.max(1,metrics.lines||1);
    for(var i=0;i<chars.length;i++){
        count+=Math.max(1,Math.ceil((chars[i]||0)/cols)||1);
    }
    return Math.max(1,count);
}

export function codeCardVisualLineIndex(file,line,prefs){
    var n=Math.max(1,Number(line)||1);
    prefs=normalizeCodeCardPrefs(prefs);
    if(!prefs.wrap)return n;
    var metrics=codeCardContentMetrics(file);
    var cols=codeCardWrapColumns();
    var chars=metrics.lineChars||[];
    var visual=0;
    var lim=Math.min(chars.length,n-1);
    for(var i=0;i<lim;i++){
        visual+=Math.max(1,Math.ceil((chars[i]||0)/cols)||1);
    }
    return visual+1;
}

export function codeCardVisualLineEndIndex(file,line,prefs){
    var n=Math.max(1,Number(line)||1);
    prefs=normalizeCodeCardPrefs(prefs);
    if(!prefs.wrap)return n;
    var metrics=codeCardContentMetrics(file);
    var total=codeCardWrappedLineCount(metrics,prefs);
    if(n>=Math.max(1,metrics.lines||1))return total;
    return Math.max(n,codeCardVisualLineIndex(file,n+1,prefs)-1);
}

export function codeCardNaturalWidth(metrics){
    metrics=metrics||{maxLineChars:0};
    return CODE_CARD_GUTTER+CODE_CARD_BODY_PAD+(metrics.maxLineChars||0)*CODE_CARD_CHAR_WIDTH;
}

export function codeCardSize(file,prefs){
    prefs=normalizeCodeCardPrefs(prefs);
    var metrics=codeCardContentMetrics(file);
    var width=CODE_CARD_WIDTH;
    var naturalWidth=codeCardNaturalWidth(metrics);
    var visualLines=codeCardWrappedLineCount(metrics,prefs);
    var naturalHeight=CODE_CARD_HEAD_HEIGHT+CODE_CARD_BODY_PAD+visualLines*CODE_CARD_LINE_HEIGHT;
    var height=Math.max(CODE_CARD_MIN_HEIGHT,prefs.expand?naturalHeight:Math.min(CODE_CARD_MAX_HEIGHT,naturalHeight));
    var heightClipped=!prefs.expand&&naturalHeight>CODE_CARD_MAX_HEIGHT;
    var widthClipped=!prefs.wrap&&naturalWidth>width;
    return{width:width,height:height,clipped:heightClipped||widthClipped,expand:prefs.expand,wrap:prefs.wrap,naturalHeight:naturalHeight,naturalWidth:naturalWidth};
}

export var CODE_CARD_RESIZE_MAX_WIDTH=1200;

export function clampCodeCardResize(width,height,prefs){
    prefs=normalizeCodeCardPrefs(prefs);
    var w=Math.max(CODE_CARD_MIN_WIDTH,Math.min(CODE_CARD_RESIZE_MAX_WIDTH,Number(width)||CODE_CARD_WIDTH));
    var h=Math.max(CODE_CARD_MIN_HEIGHT,Number(height)||CODE_CARD_MIN_HEIGHT);
    if(!prefs.expand)h=Math.min(CODE_CARD_MAX_HEIGHT,h);
    return{width:w,height:h};
}

export function applyCodeCardUserSize(base,override){
    base=base||codeCardSize(null);
    if(!override)return base;
    var next=clampCodeCardResize(override.width!=null?override.width:base.width,override.height!=null?override.height:base.height,base);
    var heightClipped=(base.naturalHeight||0)>next.height;
    var widthClipped=!base.wrap&&(base.naturalWidth||0)>next.width;
    return Object.assign({},base,{width:next.width,height:next.height,clipped:heightClipped||widthClipped});
}
