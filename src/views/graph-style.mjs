import { clampLineThickness } from '../investigation/preferences.mjs';
import { vizUsesForceLinkParticles } from './capabilities.mjs';

export function graphLinkBaseWidth(count){
    return Math.max(1,Math.min(2,Math.sqrt(count||1)*0.3));
}

export function graphLinkStrokeWidth(count,thickness){
    return graphLinkBaseWidth(count)*clampLineThickness(thickness);
}

export function scaleStrokeWidth(base,thickness){
    var n=Number(base);
    if(!isFinite(n)||n<=0)n=1;
    return Math.max(0.4,n*clampLineThickness(thickness));
}

export function graph3dLinkWidth(link,selectedPath,thickness){
    link=link||{};
    var baseWidth=Math.max(0.8,Math.min(3,Math.sqrt(link.count||1)*0.4));
    if(selectedPath){
        var s=link.source&&(link.source.id||link.source);
        var t=link.target&&(link.target.id||link.target);
        if(s===selectedPath||t===selectedPath)return scaleStrokeWidth(baseWidth*2,thickness);
        return scaleStrokeWidth(baseWidth*0.3,thickness);
    }
    return scaleStrokeWidth(baseWidth,thickness);
}

export function forceLinkEndId(end){
    if(end==null)return '';
    if(typeof end==='object')return String(end.id||'');
    return String(end);
}

export function forceLinkRole(link,selectedPath){
    if(!link||!selectedPath)return '';
    if(forceLinkEndId(link.source)===selectedPath)return 'out';
    if(forceLinkEndId(link.target)===selectedPath)return 'in';
    return '';
}

export function prefersReducedMotion(query){
    try{
        if(query&&typeof query.matches==='boolean')return !!query.matches;
        var matchMedia=typeof query==='function'?query:(typeof window!=='undefined'?window.matchMedia:null);
        if(typeof matchMedia!=='function')return false;
        var owner=typeof window!=='undefined'?window:null;
        var res=matchMedia.call(owner,'(prefers-reduced-motion: reduce)');
        return !!(res&&res.matches);
    }catch(e){
        return false;
    }
}

export function subscribePrefersReducedMotion(onChange,matchMediaFn){
    if(typeof onChange!=='function')return function(){};
    try{
        var matchMedia=typeof matchMediaFn==='function'?matchMediaFn:(typeof window!=='undefined'?window.matchMedia:null);
        if(typeof matchMedia!=='function')return function(){};
        var owner=typeof window!=='undefined'?window:null;
        var mq=matchMedia.call(owner,'(prefers-reduced-motion: reduce)');
        if(!mq)return function(){};
        var handler=function(){onChange(!!mq.matches);};
        if(typeof mq.addEventListener==='function'){
            mq.addEventListener('change',handler);
            return function(){mq.removeEventListener('change',handler);};
        }
        if(typeof mq.addListener==='function'){
            mq.addListener(handler);
            return function(){mq.removeListener(handler);};
        }
    }catch(e){}
    return function(){};
}

export function forceLinkIdleStroke(theme){
    return theme==='light'?'#ccc':'#333';
}

export function forceLinkVisual(link,selectedPath,options){
    options=options||{};
    var theme=options.theme==='light'?'light':'dark';
    var reduced=!!options.reducedMotion;
    var allowParticles=options.particles!==false&&(options.vizType==null||vizUsesForceLinkParticles(options.vizType))&&!reduced;
    var width=graphLinkStrokeWidth(link&&link.count,options.thickness);
    var role=forceLinkRole(link,selectedPath);
    var idle=forceLinkIdleStroke(theme);
    if(selectedPath&&(role==='out'||role==='in')){
        return {
            role:role,
            active:true,
            stroke:role==='out'?'var(--orange)':'var(--purple)',
            opacity:0.9,
            width:width,
            particle:allowParticles,
            particleStroke:'#fff',
            particleWidth:Math.max(4,width+2.4),
            particleDash:allowParticles?'8 20':'',
            particleDuration:allowParticles?0.7:0
        };
    }
    if(selectedPath){
        return {
            role:'quiet',
            active:false,
            stroke:idle,
            opacity:0.08,
            width:width,
            particle:false,
            particleStroke:idle,
            particleWidth:width,
            particleDash:'',
            particleDuration:0
        };
    }
    return {
        role:'idle',
        active:false,
        stroke:idle,
        opacity:0.4,
        width:width,
        particle:false,
        particleStroke:idle,
        particleWidth:width,
        particleDash:'',
        particleDuration:0
    };
}

export function forceLinkParticlesNeedTickUpdate(selectedPath,options){
    if(!selectedPath)return false;
    options=options||{};
    if(options.reducedMotion)return false;
    if(options.vizType!=null&&!vizUsesForceLinkParticles(options.vizType))return false;
    return true;
}

export function readableLabelScale(k){
    var zoom=Number(k);
    if(!isFinite(zoom)||zoom<=0)return 1;
    if(zoom>=1)return 1;
    return Math.min(8,1/zoom);
}

export var COLOR_BLOCK_ZOOM=0.4;

export var CODE_FAR_ZOOM=0.22;

export function zoomShowsColorBlocks(k){
    var zoom=Number(k);
    if(!isFinite(zoom)||zoom<=0)return false;
    return zoom<=COLOR_BLOCK_ZOOM;
}

export function zoomHidesCodeText(k){
    var zoom=Number(k);
    if(!isFinite(zoom)||zoom<=0)return false;
    return zoom<CODE_FAR_ZOOM;
}

export function graphColorBlockSize(d){
    var r=Math.max(8,Math.min(24,5+((d&&d.fnCount)||0)*0.8));
    return Math.max(22,r*2+4);
}

export function graphColorBlockScale(k){
    var zoom=Number(k);
    if(!isFinite(zoom)||zoom<=0)return 1;
    var minScreen=16;
    var screen=22*zoom;
    if(screen>=minScreen)return 1;
    return Math.min(6,minScreen/screen);
}

export function parseCssHex(color){
    var raw=String(color||'').trim();
    var m=raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if(!m)return null;
    var h=m[1];
    if(h.length===3)h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return{r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)};
}

export function cssHexHue(color){
    var rgb=parseCssHex(color);
    if(!rgb)return NaN;
    var r=rgb.r/255,g=rgb.g/255,b=rgb.b/255;
    var max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    if(d===0)return 0;
    var h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;
    h=h*60;
    if(h<0)h+=360;
    return h;
}

export function colorBlockLooksLikeDiff(color){
    var h=cssHexHue(color);
    if(!isFinite(h))return false;
    return h<=25||h>=335||(h>=70&&h<=165);
}

export function graphColorBlockFill(color){
    var hex=String(color||'').trim();
    var known={
        '#00ff9d':'#38bdf8',
        '#00cc7d':'#67e8f9',
        '#00a86b':'#93c5fd',
        '#22c55e':'#2dd4bf',
        '#84cc16':'#e879f9',
        '#98c379':'#5eead4',
        '#ff5f5f':'#818cf8',
        '#e06c75':'#f472b6',
        '#ff6b6b':'#fbbf24'
    };
    var key=hex.toLowerCase();
    if(known[key])return known[key];
    if(!colorBlockLooksLikeDiff(hex))return hex||'#4d9fff';
    var h=cssHexHue(hex);
    return (h<=25||h>=335)?'#c4b5fd':'#7dd3fc';
}

export function codeColorBlockKindColor(kind){
    if(kind==='import')return '#c678dd';
    if(kind==='export')return '#56b6c2';
    if(kind==='var'||kind==='file')return '#d19a66';
    if(kind==='class')return '#e5c07b';
    return '#61afef';
}
