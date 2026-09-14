import { normalizeCodeCardPrefs, codeCardVisualLineIndex, codeCardVisualLineEndIndex, CODE_CARD_LINE_HEIGHT, codeCardSizeForDiff, CODE_CARD_HEAD_HEIGHT } from './card-size.mjs';
import { fileForCodeCardDiff, codeCardDiffLineIndex } from '../project/changes.mjs';
import { codeCardSymbolLine, codeCardLineY } from './card-links.mjs';
import { codeColorBlockKindColor } from './graph-style.mjs';

export function escapeRegExp(value){
    return String(value||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

export function isValidSymbolName(name){
    return /^[A-Za-z_$][\w$]*$/.test(String(name||''));
}

export function escapeHtmlAttr(value){
    return String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function safeSymbolKind(kind){
    return kind==='fn'||kind==='import'||kind==='export'||kind==='var'?kind:'var';
}

export function extractFileSymbols(file,connections){
    var symbols=[];
    var seen=Object.create(null);
    function add(name,kind){
        if(!isValidSymbolName(name)||seen[name])return;
        seen[name]=true;
        symbols.push({name:name,kind:kind||'var'});
    }
    (file&&file.functions||[]).forEach(function(fn){
        add(fn.name,fn.isExported?'export':'fn');
    });
    var content=String(file&&file.content||'');
    var match;
    var importRe=/\bimport\s+(?!\()([\s\S]*?)\s+from\s*['"`][^'"`]+['"`]/g;
    while((match=importRe.exec(content))){
        var spec=match[1]||'';
        if(/^\s*type\b/.test(spec))continue;
        var named=spec.match(/\{([\s\S]*?)\}/);
        if(named){
            named[1].split(',').forEach(function(part){
                part=part.trim().replace(/^type\s+/,'').trim();
                var alias=part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
                add(alias?alias[2]:part.replace(/[^\w$].*$/,''),'import');
            });
        }
        var ns=spec.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
        if(ns)add(ns[1],'import');
        var def=spec.split('{')[0].split('*')[0].split(',')[0].trim();
        if(isValidSymbolName(def))add(def,'import');
    }
    var exportRe=/\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
    while((match=exportRe.exec(content)))add(match[1],'export');
    var namedExportRe=/\bexport\s+(?:default\s+)?\{([\s\S]*?)\}/g;
    while((match=namedExportRe.exec(content))){
        match[1].split(',').forEach(function(part){
            part=part.trim();
            var alias=part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
            add(alias?alias[1]:part.replace(/[^\w$].*$/,''),'export');
        });
    }
    var pyFromRe=/^\s*from\s+[.\w]+\s+import\s+([^\n#]+)/gm;
    while((match=pyFromRe.exec(content))){
        match[1].replace(/[()]/g,'').split(',').forEach(function(part){
            var pieces=part.trim().split(/\s+as\s+/);
            add((pieces[1]||pieces[0]||'').trim(),'import');
        });
    }
    (connections||[]).forEach(function(c){
        var src=typeof c.source==='object'?c.source.id:c.source;
        var tgt=typeof c.target==='object'?c.target.id:c.target;
        if(file&&(src===file.path||tgt===file.path)&&c.fn)add(c.fn,'fn');
    });
    return symbols;
}

export function codeColorBlockLineCount(file){
    if(file&&typeof file.content==='string'&&file.content)return Math.max(1,file.content.split('\n').length);
    var lines=Number(file&&file.lines);
    if(isFinite(lines)&&lines>0)return Math.max(1,lines);
    var max=1;
    (file&&file.functions||[]).forEach(function(fn){
        var line=Number(fn&&fn.line);
        if(isFinite(line)&&line>max)max=line;
    });
    return max;
}

export function codeColorBlockSections(file,connections,prefs,diffRows){
    prefs=normalizeCodeCardPrefs(prefs);
    var paintFile=fileForCodeCardDiff(file,diffRows);
    var total=codeColorBlockLineCount(paintFile);
    var byLine=Object.create(null);
    (file&&file.functions||[]).forEach(function(fn){
        if(!fn||!fn.name||!fn.line)return;
        var kind=fn.type==='class'||fn.type==='dataclass'||fn.type==='abstract_class'?'class':(fn.isExported?'export':'fn');
        var line=codeCardDiffLineIndex(diffRows,fn.line);
        if(!byLine[line])byLine[line]={name:fn.name,kind:kind,startLine:line};
    });
    extractFileSymbols(file,connections).forEach(function(sym){
        var analyzed=codeCardSymbolLine(file,sym.name);
        if(!analyzed)return;
        var line=codeCardDiffLineIndex(diffRows,analyzed);
        if(!line||byLine[line])return;
        byLine[line]={name:sym.name,kind:sym.kind||'var',startLine:line};
    });
    var starts=Object.keys(byLine).map(Number).filter(isFinite).sort(function(a,b){return a-b;});
    var sections=[];
    if(!starts.length){
        sections.push({name:(file&&(file.name||file.path))||'file',kind:'file',startLine:1,endLine:total});
    }else{
        if(starts[0]>1){
            sections.push({name:(file&&(file.name||file.path))||'file',kind:'file',startLine:1,endLine:starts[0]-1});
        }
        starts.forEach(function(start,i){
            var item=byLine[start];
            var end=i+1<starts.length?starts[i+1]-1:total;
            if(end<start)end=start;
            sections.push({name:item.name,kind:item.kind,startLine:start,endLine:end});
        });
    }
    return sections.map(function(section){
        var startVisual=paintFile?codeCardVisualLineIndex(paintFile,section.startLine,prefs):section.startLine;
        var endVisual=paintFile?codeCardVisualLineEndIndex(paintFile,section.endLine,prefs):section.endLine;
        if(endVisual<startVisual)endVisual=startVisual;
        return Object.assign({},section,{
            color:codeColorBlockKindColor(section.kind),
            top:8+(startVisual-1)*CODE_CARD_LINE_HEIGHT,
            height:Math.max(6,(endVisual-startVisual+1)*CODE_CARD_LINE_HEIGHT)
        });
    });
}

export function codeCardSymbolPills(file,connections,prefs,diffRows){
    var paintFile=fileForCodeCardDiff(file,diffRows);
    var size=codeCardSizeForDiff(file,prefs,diffRows);
    return extractFileSymbols(file,connections).map(function(sym){
        var line=codeCardSymbolLine(file,sym.name);
        if(!line)return null;
        var visual=codeCardDiffLineIndex(diffRows,line);
        return{name:sym.name,kind:sym.kind,line:visual,top:codeCardLineY(size,visual,paintFile,prefs)};
    }).filter(Boolean);
}

export function codeCardPillViewTop(lineTop,scrollTop,cardHeight,headHeight){
    var y=Number(lineTop)-(Number(scrollTop)||0);
    var min=headHeight==null?CODE_CARD_HEAD_HEIGHT:Number(headHeight);
    var max=Number(cardHeight);
    if(!isFinite(y)||!isFinite(min)||!isFinite(max))return null;
    if(y<min||y>max)return null;
    return y;
}

export function collectCrossFileSymbols(files,connections){
    var byName=Object.create(null);
    (files||[]).forEach(function(file){
        extractFileSymbols(file,connections).forEach(function(sym){
            if(!byName[sym.name])byName[sym.name]={name:sym.name,kind:sym.kind,files:[]};
            if(byName[sym.name].files.indexOf(file.path)<0)byName[sym.name].files.push(file.path);
            if(sym.kind==='export')byName[sym.name].kind='export';
            else if(sym.kind==='import'&&byName[sym.name].kind!=='export')byName[sym.name].kind='import';
        });
    });
    return Object.keys(byName).map(function(name){return byName[name];})
        .sort(function(a,b){return (b.files.length-a.files.length)||a.name.localeCompare(b.name);});
}

export function annotateHtmlWithSymbols(html,symbols,activeSymbol){
    var source=String(html||'');
    if(!source||!symbols||!symbols.length)return source;
    var names=symbols.map(function(s){return s.name;}).filter(isValidSymbolName);
    if(!names.length)return source;
    var kindByName=Object.create(null);
    symbols.forEach(function(s){if(isValidSymbolName(s.name))kindByName[s.name]=s.kind||'var';});
    var re=new RegExp('\\b('+names.map(escapeRegExp).join('|')+')\\b','g');
    var out='';
    var last=0;
    var match;
    while((match=re.exec(source))){
        var idx=match.index;
        var before=source.slice(0,idx);
        var lastLt=before.lastIndexOf('<');
        var lastGt=before.lastIndexOf('>');
        if(lastLt>lastGt)continue;
        out+=source.slice(last,idx);
        var kind=safeSymbolKind(kindByName[match[1]]||'var');
        var active=activeSymbol&&activeSymbol===match[1]?' active':'';
        var safeName=escapeHtmlAttr(match[1]);
        out+='<span class="sym-mark '+kind+active+'" data-sym="'+safeName+'">'+safeName+'</span>';
        last=idx+match[0].length;
    }
    return out+source.slice(last);
}
