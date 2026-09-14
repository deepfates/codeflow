import {functionKey} from '../project/identity.mjs';
import {maxAnalyzableFileBytes,isOversized} from '../project/size-policy.mjs';
import { codeExts, scriptContainerExts, textExts, textNames, binExts, isCode, isText, isBinary, isIncluded, isScriptContainer, isVBA, isPascal, isHTML, isCSS, isJSON, isElixir, isMarkdown, isTestFile, detectLayer, isNonProductionPath, isArchitectureTestFile, isSecretScanExemptPath, isArchitectureBackendPath } from "./file-types.mjs";
import { getSecurityScanContent, isSanitizedPreviewRenderer, inspectJavaScriptSecurity } from "./security-source.mjs";

// web-tree-sitter 0.20.8 shares an Emscripten dynamic linker across languages.
// Concurrent Language.load calls corrupt its symbol resolution on Node 20
// ("bad export type for quoted_content_infos"). Serialize grammar linking per
// runtime, including separate analyzers, until the runtime supports concurrency.
const grammarLoads=new WeakMap();
function loadRuntimeLanguage(runtime,source){
    const previous=grammarLoads.get(runtime)||Promise.resolve();
    const pending=previous.then(()=>runtime.Language.load(source));
    grammarLoads.set(runtime,pending.catch(()=>{}));
    return pending;
}

// Syntax runtimes and grammar bytes are supplied by the browser or Node entry.
export function createParser({TreeSitter,acorn,Babel,vendorBase="vendor/",runtimeWasm,loadGrammar}={}) {
const Parser={
    // Tree-sitter parsers are loaded lazily from vendored WASM and used when a language has
    // a stable grammar path. Regex remains an explicit fallback, not a silent lie.
    _tsRuntimePromise:null,
    _tsLanguagePromises:Object.create(null),
    _tsLanguages:Object.create(null),
    _tsParsers:Object.create(null),
    _callCandidateThreshold:250,
    maxAnalyzableFileBytes,
    isOversized,
    treeSitterWasmBase:vendorBase+'tree-sitter-wasms/',
    treeSitterGrammars:{
        python:{grammar:'python',exts:['.py','.pyw','.pyi'],coverage:'calls'},
        javascript:{grammar:'javascript',exts:['.js','.jsx','.mjs','.cjs'],coverage:'available'},
        typescript:{grammar:'typescript',exts:['.ts'],coverage:'available'},
        tsx:{grammar:'tsx',exts:['.tsx'],coverage:'available'},
        go:{grammar:'go',exts:['.go'],coverage:'available'},
        rust:{grammar:'rust',exts:['.rs'],coverage:'available'},
        java:{grammar:'java',exts:['.java'],coverage:'available'},
        ruby:{grammar:'ruby',exts:['.rb'],coverage:'available'},
        php:{grammar:'php',exts:['.php'],coverage:'available'},
        c:{grammar:'c',exts:['.c','.h'],coverage:'available'},
        cpp:{grammar:'cpp',exts:['.cpp','.cc','.hpp'],coverage:'available'},
        csharp:{grammar:'c_sharp',exts:['.cs'],coverage:'available'},
        swift:{grammar:'swift',exts:['.swift'],coverage:'available'},
        kotlin:{grammar:'kotlin',exts:['.kt','.kts'],coverage:'available'},
        scala:{grammar:'scala',exts:['.scala'],coverage:'available'},
        elixir:{grammar:'elixir',exts:['.ex','.exs'],coverage:'calls'},
        lua:{grammar:'lua',exts:['.lua'],coverage:'available'},
        bash:{grammar:'bash',exts:['.sh','.bash','.zsh','.fish'],coverage:'available'}
    },
    treeSitterFetchTimeoutMs:8000,
    _withTimeout:function(promise,ms){
        return new Promise(function(resolve,reject){
            var timer=setTimeout(function(){reject(new Error('tree-sitter fetch timed out'));},ms);
            Promise.resolve(promise).then(function(value){clearTimeout(timer);resolve(value);},function(error){clearTimeout(timer);reject(error);});
        });
    },
    initTreeSitter:async function(){
        if(this._tsRuntimePromise)return this._tsRuntimePromise;
        this._tsRuntimePromise=(async()=>{
            if(typeof TreeSitter==='undefined')return null;
            try{
                await Parser._withTimeout(TreeSitter.init(Object.assign({
                    locateFile:function(scriptName){
                        return vendorBase+'tree-sitter/'+scriptName;
                    }
                },runtimeWasm?{wasmBinary:runtimeWasm}:{})),Parser.treeSitterFetchTimeoutMs);
                return TreeSitter;
            }catch(e){
                return null;
            }
        })();
        return this._tsRuntimePromise;
    },
    getTreeSitterConfig:function(filename){
        var lower=(filename||'').toLowerCase();
        var configs=Object.values(Parser.treeSitterGrammars);
        for(var i=0;i<configs.length;i++){
            if(configs[i].exts.some(function(ext){return lower.endsWith(ext);})){
                return configs[i];
            }
        }
        return null;
    },
    loadTreeSitterLanguage:async function(config){
        if(!config)return null;
        if(this._tsLanguages[config.grammar])return this._tsLanguages[config.grammar];
        if(this._tsLanguagePromises[config.grammar])return this._tsLanguagePromises[config.grammar];
        this._tsLanguagePromises[config.grammar]=(async()=>{
            var runtime=await Parser.initTreeSitter();
            if(!runtime)return null;
            try{
                var lang=await Parser._withTimeout(Promise.resolve(loadGrammar?loadGrammar(config.grammar):Parser.treeSitterWasmBase+'tree-sitter-'+config.grammar+'.wasm').then(function(source){return loadRuntimeLanguage(runtime,source);}),Parser.treeSitterFetchTimeoutMs);
                var parser=new runtime();
                parser.setLanguage(lang);
                Parser._tsLanguages[config.grammar]=lang;
                Parser._tsParsers[config.grammar]=parser;
                return lang;
            }catch(e){
                return null;
            }
        })();
        return this._tsLanguagePromises[config.grammar];
    },
    prepareTreeSitter:async function(files){
        var configs=new Map();
        (files||[]).forEach(function(file){
            var cfg=Parser.getTreeSitterConfig(file.path||file.name);
            if(cfg&&cfg.coverage==='calls')configs.set(cfg.grammar,cfg);
        });
        await Promise.all(Array.from(configs.values()).map(function(cfg){return Parser.loadTreeSitterLanguage(cfg);}));
    },
    getLoadedTreeSitterParser:function(filename){
        var cfg=Parser.getTreeSitterConfig(filename);
        return cfg?Parser._tsParsers[cfg.grammar]||null:null;
    },
    getParserProvenance:function(filename){
        var lower=(filename||'').toLowerCase();
        var cfg=Parser.getTreeSitterConfig(filename);
        if(cfg&&Parser._tsParsers[cfg.grammar])return cfg.coverage==='calls'?'tree-sitter:'+cfg.grammar+'-calls':'tree-sitter:'+cfg.grammar;
        if(['.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte'].some(function(ext){return lower.endsWith(ext);})&&typeof acorn!=='undefined')return 'acorn-babel';
        if(Parser.isMarkdown&&Parser.isMarkdown(filename))return 'markdown-link-parser';
        if(Parser.isCode(filename))return 'heuristic-regex';
        return 'text';
    },
    isElixir:isElixir,
    analyzeElixir:function(content,filename){
        var parser=Parser.getLoadedTreeSitterParser(filename);
        if(!parser)return {status:'unavailable',provenance:'heuristic-regex',modules:[],functions:[],calls:[],unresolved:[],reason:'Elixir grammar unavailable'};
        var tree=parser.parse(content);
        var result={status:tree.rootNode.hasError()?'partial':'ready',provenance:'tree-sitter:elixir',modules:[],functions:[],calls:[],unresolved:[]};
        var definitions=new Map();
        function field(node,name){return node&&node.childForFieldName(name);}
        function child(node,type){return node&&node.namedChildren.find(function(n){return n.type===type;});}
        function args(node){var a=child(node,'arguments');return a?a.namedChildren:[];}
        function op(node){var n=field(node,'operator');return n?n.text:'';}
        function range(node){return {start:{line:node.startPosition.row,character:node.startPosition.column},end:{line:node.endPosition.row,character:node.endPosition.column}};}
        function keyword(node,key){if(!node)return null;var pairs=node.type==='keywords'?node.namedChildren:[];var pair=pairs.find(function(p){var k=field(p,'key');return k&&k.text.trim()===key+':';});return field(pair,'value');}
        function fork(env){return {module:env.module,moduleRecord:env.moduleRecord,aliases:Object.assign({},env.aliases),imports:env.imports.slice(),inFunction:env.inFunction,functionName:env.functionName,bindings:new Set(env.bindings)};}
        function moduleName(node,env){
            if(!node)return null;
            if(node.type==='identifier'&&node.text==='__MODULE__')return env.module;
            if(node.type==='alias'){
                var parts=node.text.split('.');
                if(parts[0]==='Elixir')return parts.slice(1).join('.');
                if(env.aliases[parts[0]])parts[0]=env.aliases[parts[0]];
                return parts.join('.');
            }
            if(node.type==='atom')return node.text.slice(1);
            if(node.type==='dot'){
                var left=moduleName(field(node,'left'),env),right=field(node,'right');
                if(left&&right&&right.type==='alias')return left+'.'+right.text;
            }
            return null;
        }
        function recordCall(node,env,extra,arityOverride){
            var target=field(node,'target');if(!target)return;
            var name=null,module=null;
            if(target.type==='identifier')name=target.text;
            else if(target.type==='dot'){
                module=moduleName(field(target,'left'),env);
                var right=field(target,'right');if(right&&right.type==='identifier')name=right.text;
            }
            var call={module:module,function:name,arity:arityOverride===undefined?args(node).length+(child(node,'do_block')?1:0)+(extra||0):arityOverride,line:node.startPosition.row+1,column:node.startPosition.column,
                callerModule:env.module,imports:env.imports.slice(),source:node.text,evidence:'tree-sitter:elixir',resolution:module?'qualified':target.type==='identifier'?'local-or-import':'unresolved'};
            if(!name||target.type==='dot'&&!module){call.reason='Dynamic receiver';result.unresolved.push(call);}
            else result.calls.push(call);
        }
        function bind(node,env){
            if(!node)return;
            if(node.type==='binary_operator'&&['when','\\\\'].indexOf(op(node))>=0){bind(field(node,'left'),env);return;}
            if(node.type==='identifier'){env.bindings.add(node.text);return;}
            node.namedChildren.forEach(function(n){bind(n,env);});
        }
        function visit(node,env){
            if(node.type==='identifier'){
                if(env.inFunction&&!env.bindings.has(node.text)&&node.text!=='__MODULE__')result.calls.push({module:null,function:node.text,arity:0,line:node.startPosition.row+1,column:node.startPosition.column,callerModule:env.module,imports:env.imports.slice(),resolution:'local-or-import',evidence:'tree-sitter:elixir',source:node.text});
                return;
            }
            if(node.type==='stab_clause'){
                var scope=fork(env),pattern=field(node,'left');bind(pattern,scope);
                if(pattern&&pattern.type==='binary_operator'&&op(pattern)==='when')visit(field(pattern,'right'),scope);
                var body=field(node,'right');if(body)visit(body,scope);return;
            }
            if(node.type==='binary_operator'&&['=','<-'].indexOf(op(node))>=0){visit(field(node,'right'),env);bind(field(node,'left'),env);return;}
            if(node.type==='ERROR'){result.unresolved.push({line:node.startPosition.row+1,source:node.text,reason:'Parse error'});return;}
            if(node.type==='call'){
                var target=field(node,'target'),name=target&&target.type==='identifier'?target.text:null,a=args(node),block=child(node,'do_block');
                if(name==='defmodule'||name==='defprotocol'||name==='defimpl'){
                    var module=moduleName(a[0],env);
                    if(name==='defimpl'){
                        var implFor=moduleName(keyword(a.find(function(n){return n.type==='keywords';}),'for'),env);
                        module=module&&implFor?module+'.'+implFor:null;
                    }else if(module&&env.module&&a[0].type==='alias'&&a[0].text.split('.')[0]!=='Elixir'&&!env.aliases[a[0].text.split('.')[0]])module=env.module+'.'+module;
                    if(!module){result.unresolved.push({line:node.startPosition.row+1,source:node.text,reason:'Dynamic module definition'});return;}
                    var record={name:module,kind:name,line:node.startPosition.row+1,endLine:node.endPosition.row+1,range:range(node),uses:[],quotedUses:[],behaviours:[]};
                    result.modules.push(record);
                    var nested=fork(env);nested.module=module;nested.moduleRecord=record;nested.inFunction=false;
                    if(block)block.namedChildren.forEach(function(n){visit(n,nested);});
                    env.aliases[module.split('.').pop()]=module;return;
                }
                if(name==='alias'){
                    var aliasNode=a[0],kw=a.find(function(n){return n.type==='keywords';}),as=keyword(kw,'as');
                    if(aliasNode&&aliasNode.type==='dot'&&field(aliasNode,'right')&&field(aliasNode,'right').type==='tuple'){
                        var prefix=moduleName(field(aliasNode,'left'),env);
                        if(prefix)field(aliasNode,'right').namedChildren.forEach(function(n){if(n.type==='alias')env.aliases[n.text.split('.').pop()]=prefix+'.'+n.text;});
                    }else{var full=moduleName(aliasNode,env);if(full)env.aliases[as?as.text:full.split('.').pop()]=full;}
                    return;
                }
                if(name==='import'){
                    var imported=moduleName(a[0],env);
                    if(imported){var options=a.find(function(n){return n.type==='keywords';});var only=keyword(options,'only'),except=keyword(options,'except');
                        function signatures(list){return list?list.descendantsOfType('pair').map(function(p){var k=field(p,'key'),v=field(p,'value');return k&&v?k.text.trim().slice(0,-1)+'/'+v.text:null;}).filter(Boolean):null;}
                        env.imports.push({module:imported,only:signatures(only),except:signatures(except)});
                    }return;
                }
                if(name==='use'||name==='require'){
                    var used=moduleName(a[0],env);
                    if(name==='use'&&used&&env.moduleRecord)env.moduleRecord.uses.push({module:used,line:node.startPosition.row+1,arguments:a.slice(1).map(function(n){return n.text;})});
                    return;
                }
                if(['def','defp','defmacro','defmacrop','defguard','defguardp','defdelegate'].indexOf(name)>=0){
                    var head=a[0];if(head&&head.type==='binary_operator'&&op(head)==='when')head=field(head,'left');
                    var headTarget=head&&head.type==='call'?field(head,'target'):head;
                    if(!headTarget||headTarget.type!=='identifier'||['unquote','unquote_splicing'].indexOf(headTarget.text)>=0||!env.module){result.unresolved.push({line:node.startPosition.row+1,source:node.text,reason:'Dynamic function definition'});return;}
                    var params=head.type==='call'?args(head):[],arity=params.length,localName=headTarget.text,qualified=env.module+'.'+localName+'/'+arity;
                    var defaults=params.filter(function(p){return p.type==='binary_operator'&&op(p)==='\\\\';}).length;
                    var fn=definitions.get(qualified);
                    if(!fn){fn={name:qualified,localName:localName,module:env.module,arity:arity,acceptedArities:[],file:filename,line:node.startPosition.row+1,endLine:node.endPosition.row+1,range:range(node),
                        visibility:['defp','defmacrop','defguardp'].indexOf(name)>=0?'private':'public',type:name.indexOf('macro')>=0?'macro':name.indexOf('guard')>=0?'guard':'function',isTopLevel:true,isExported:['defp','defmacrop','defguardp'].indexOf(name)<0,
                        clauses:[],code:'',parserProvenance:'tree-sitter:elixir'};definitions.set(qualified,fn);result.functions.push(fn);}
                    for(var n=arity-defaults;n<=arity;n++)if(fn.acceptedArities.indexOf(n)<0)fn.acceptedArities.push(n);
                    fn.code+=(fn.code?'\n':'')+node.text;fn.endLine=node.endPosition.row+1;fn.range.end=range(node).end;fn.clauses.push({line:node.startPosition.row+1,endLine:node.endPosition.row+1,range:range(node)});
                    var bodyEnv=fork(env);bodyEnv.inFunction=true;bodyEnv.functionName=localName;params.forEach(function(p){bind(p,bodyEnv);});
                    if(block)block.namedChildren.forEach(function(n){visit(n,bodyEnv);});
                    var bodyKeywords=a.find(function(n){return n.type==='keywords';});
                    if(bodyKeywords)bodyKeywords.namedChildren.forEach(function(p){var k=field(p,'key');if(k&&['do:','rescue:','catch:','after:','else:'].indexOf(k.text.trim())>=0)visit(field(p,'value'),bodyEnv);});
                    // Guards and default expressions are executable expressions too.
                    if(a[0]&&a[0].type==='binary_operator')visit(field(a[0],'right'),bodyEnv);
                    params.forEach(function(p){if(p.type==='binary_operator'&&op(p)==='\\\\')visit(field(p,'right'),bodyEnv);});
                    if(name==='defdelegate'){
                        var to=moduleName(keyword(bodyKeywords,'to'),env),as=keyword(bodyKeywords,'as');
                        if(to)result.calls.push({module:to,function:as?as.text.slice(1):localName,arity:arity,line:node.startPosition.row+1,column:node.startPosition.column,callerModule:env.module,imports:[],resolution:'qualified',evidence:'tree-sitter:elixir',source:node.text});
                    }
                    return;
                }
                if(name==='quote'){
                    if(env.moduleRecord)node.descendantsOfType('call').forEach(function(quoted){var qt=field(quoted,'target'),qa=args(quoted);if(qt&&qt.text==='use'){var qm=moduleName(qa[0],env);if(qm)env.moduleRecord.quotedUses.push({module:qm,line:quoted.startPosition.row+1,arguments:qa.slice(1).map(function(n){return n.text;}),viaFunction:env.functionName||null});}});
                    result.unresolved.push({line:node.startPosition.row+1,source:node.text,reason:'Quoted code requires macro expansion'});return;
                }
                recordCall(node,env,0);
                a.forEach(function(n){visit(n,env);});if(block)block.namedChildren.forEach(function(n){visit(n,fork(env));});return;
            }
            if(node.type==='unary_operator'&&op(node)==='@'){
                var attr=field(node,'operand');var attrTarget=field(attr,'target');
                if(attrTarget&&attrTarget.text==='behaviour'&&env.moduleRecord){var behaviour=moduleName(args(attr)[0],env);if(behaviour)env.moduleRecord.behaviours.push({module:behaviour,line:node.startPosition.row+1});}
                return;
            }
            if(node.type==='binary_operator'&&op(node)==='|>'){
                visit(field(node,'left'),env);var right=field(node,'right');
                if(right&&right.type==='call'){recordCall(right,env,1);args(right).forEach(function(n){visit(n,env);});}else if(right)visit(right,env);return;
            }
            if(node.type==='unary_operator'&&op(node)==='&'){
                var operand=field(node,'operand');
                if(operand&&operand.type==='binary_operator'&&op(operand)==='/'){
                    var captured=field(operand,'left'),count=field(operand,'right');
                    if(captured&&captured.type==='call'&&count&&count.type==='integer'){recordCall(captured,env,0,Number(count.text));return;}
                    if(captured&&captured.type==='identifier'&&count&&count.type==='integer'){result.calls.push({module:null,function:captured.text,arity:Number(count.text),line:captured.startPosition.row+1,column:captured.startPosition.column,callerModule:env.module,imports:env.imports.slice(),resolution:'local-or-import',evidence:'tree-sitter:elixir',source:node.text});return;}
                }
            }
            node.namedChildren.forEach(function(n){visit(n,env);});
        }
        try{visit(tree.rootNode,{module:null,moduleRecord:null,aliases:{},imports:[],inFunction:false,bindings:new Set()});}
        finally{tree.delete();}
        return result;
    },
    codeExts:codeExts,
    scriptContainerExts:scriptContainerExts,
    textExts:textExts,
    textNames:textNames,
    binExts:binExts,
    isCode:isCode,
    isText:isText,
    isBinary:isBinary,
    isIncluded:isIncluded,
    isScriptContainer:isScriptContainer,
    isVBA:isVBA,
    isPascal:isPascal,
    isHTML:isHTML,
    isCSS:isCSS,
    isJSON:isJSON,
    parseHTMLAttributes:function(attrs){
        if(!attrs)return[];
        var parsed=[];
        var attrRegex=/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
        var match;
        while((match=attrRegex.exec(attrs))){
            var value=match[2]!==undefined?match[2]:(match[3]!==undefined?match[3]:match[4]);
            parsed.push({
                name:(match[1]||'').toLowerCase(),
                value:value===undefined?'':value,
                valueStart:value===undefined?-1:match.index+match[0].indexOf(value)
            });
        }
        return parsed;
    },
    getScriptTagAttribute:function(attrs,name){
        var parsed=Parser.parseHTMLAttributes(attrs);
        var lowered=name.toLowerCase();
        for(var i=0;i<parsed.length;i++){
            if(parsed[i].name===lowered)return parsed[i].value;
        }
        return'';
    },
    getScriptBlockInfo:function(attrs){
        var type=(Parser.getScriptTagAttribute(attrs,'type')||'').split(';')[0].trim().toLowerCase();
        var lang=(Parser.getScriptTagAttribute(attrs,'lang')||'').split(';')[0].trim().toLowerCase();
        var info={executable:false,isTS:false,sourceType:'script'};

        if(!type){
            info.executable=true;
        }else if(type==='module'){
            info.executable=true;
            info.sourceType='module';
        }else if(
            type.match(/^(?:text|application)\/(?:x-)?(?:java|ecma)script$/)||
            type==='text/babel'||type==='text/jsx'||type==='application/jsx'||
            type==='application/babel'
        ){
            info.executable=true;
        }else if(
            type.match(/^(?:text|application)\/(?:x-)?typescript$/)||
            type==='text/tsx'||type==='application/tsx'
        ){
            info.executable=true;
            info.isTS=true;
        }

        if(lang==='ts'||lang==='tsx'||lang==='typescript'){
            info.executable=true;
            info.isTS=true;
        }else if(lang==='js'||lang==='jsx'||lang==='javascript'||lang==='babel'){
            info.executable=true;
        }

        return info;
    },
    getEmbeddedCodeBlocks:function(content,filename,options){
        if(!content||!Parser.isScriptContainer(filename))return[];
        var blocks=[];
        var scriptRegex=/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi;
        var match;
        var scriptRanges=[];
        while((match=scriptRegex.exec(content))){
            var attrs=match[1]||'';
            var info=Parser.getScriptBlockInfo(attrs);
            var scriptContent=match[2]||'';
            scriptRanges.push({start:match.index,end:match.index+match[0].length});
            if(!info.executable||!scriptContent.trim())continue;
            var openTagEnd=match[0].indexOf('>');
            if(openTagEnd<0)continue;
            var bodyStart=match.index+openTagEnd+1;
            blocks.push({
                content:scriptContent,
                offset:content.slice(0,bodyStart).split('\n').length-1,
                isTS:info.isTS,
                sourceType:info.sourceType,
                kind:'script'
            });
        }

        if(options&&options.includeHandlers&&Parser.isHTML(filename)){
            var tagRegex=/<([a-z][\w:-]*)([^<>]*?)>/gi;
            while((match=tagRegex.exec(content))){
                var tagStart=match.index;
                var insideScript=false;
                for(var sri=0;sri<scriptRanges.length;sri++){
                    if(tagStart>=scriptRanges[sri].start&&tagStart<scriptRanges[sri].end){
                        insideScript=true;
                        break;
                    }
                }
                if(insideScript)continue;
                var attrs=match[2]||'';
                var attrsStart=match[0].indexOf(attrs);
                var parsedAttrs=Parser.parseHTMLAttributes(attrs);
                for(var ai=0;ai<parsedAttrs.length;ai++){
                    var attr=parsedAttrs[ai];
                    if(!/^on[a-z][\w:-]*$/i.test(attr.name)||attr.valueStart<0)continue;
                    if(!attr.value||!attr.value.trim())continue;
                    var valueStart=tagStart+attrsStart+attr.valueStart;
                    blocks.push({
                        content:attr.value,
                        offset:content.slice(0,valueStart).split('\n').length-1,
                        isTS:false,
                        sourceType:'script',
                        kind:'handler'
                    });
                }
            }
        }

        return blocks;
    },
    hasEmbeddedCode:function(content,filename){
        return Parser.getEmbeddedCodeBlocks(content,filename,{includeHandlers:true}).length>0;
    },
    isMarkdown:isMarkdown,
    // Multi-language test-file conventions: JS (.test./.spec./__tests__), Ruby
    // (spec/**/*_spec.rb, test/**/*_test.rb), Python (test_*.py, *_test.py),
    // Go (*_test.go), JVM/C#/PHP (*Test.java etc.), Elixir (*_test.exs).
    isTestFile:isTestFile,
    extractMarkdownLinks:function(content){
        if(!content)return[];
        var stripped=content.replace(/```[\s\S]*?```/g,'').replace(/~~~[\s\S]*?~~~/g,'').replace(/`[^`\n]*`/g,'');
        var links=[];
        var wikiRe=/\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
        var m;
        while((m=wikiRe.exec(stripped))!==null){
            links.push({kind:'wikilink',raw:m[0],target:m[1].trim()});
        }
        var mdRe=/(!?)\[((?:[^\[\]]|\[[^\[\]]*\])*)\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;
        while((m=mdRe.exec(stripped))!==null){
            if(m[1]==='!')continue;
            var url=m[3].trim();
            if(!url)continue;
            if(/^(?:https?:|mailto:|ftp:|file:|tel:|#)/i.test(url))continue;
            var clean=url.split('#')[0].split('?')[0];
            if(!clean)continue;
            links.push({kind:'mdlink',raw:m[0],target:url});
        }
        return links;
    },
    buildMarkdownPathIndex:function(allPaths){
        var exact=Object.create(null);
        var byBase=Object.create(null);
        var markdownByStem=Object.create(null);
        (allPaths||[]).forEach(function(path){
            var lower=path.toLowerCase();
            if(exact[lower]===undefined)exact[lower]=path;
            var base=lower.split('/').pop();
            if(byBase[base]===undefined)byBase[base]=path;
            var markdownMatch=base.match(/^(.*)\.(?:md|markdown)$/);
            if(markdownMatch&&markdownByStem[markdownMatch[1]]===undefined)markdownByStem[markdownMatch[1]]=path;
        });
        return{exact:exact,byBase:byBase,markdownByStem:markdownByStem};
    },
    resolveMarkdownLink:function(rawTarget,fromPath,allPathsOrIndex,kind){
        if(!rawTarget)return null;
        var pathIndex=allPathsOrIndex&&allPathsOrIndex.exact&&allPathsOrIndex.byBase
            ?allPathsOrIndex
            :(function(allPaths){
                var exact=Object.create(null),byBase=Object.create(null),markdownByStem=Object.create(null);
                allPaths.forEach(function(path){
                    var lower=path.toLowerCase();
                    if(exact[lower]===undefined)exact[lower]=path;
                    var base=lower.split('/').pop();
                    if(byBase[base]===undefined)byBase[base]=path;
                    var markdownMatch=base.match(/^(.*)\.(?:md|markdown)$/);
                    if(markdownMatch&&markdownByStem[markdownMatch[1]]===undefined)markdownByStem[markdownMatch[1]]=path;
                });
                return{exact:exact,byBase:byBase,markdownByStem:markdownByStem};
            })(allPathsOrIndex||[]);
        function findExact(candidate){
            var c=candidate.toLowerCase();
            return pathIndex.exact[c]===undefined?null:pathIndex.exact[c];
        }
        function findWithMd(candidate){
            var hit=findExact(candidate);
            if(hit)return hit;
            if(!/\.(md|markdown)$/i.test(candidate)){
                var mdHit=findExact(candidate+'.md');
                if(mdHit)return mdHit;
                return findExact(candidate+'.markdown');
            }
            return null;
        }
        if(kind==='mdlink'){
            var cleanTarget=rawTarget.split('#')[0].split('?')[0];
            var resolved;
            if(cleanTarget.charAt(0)==='/'){
                resolved=cleanTarget.slice(1);
            }else{
                var fromDir=fromPath.indexOf('/')>=0?fromPath.split('/').slice(0,-1).join('/'):'';
                var parts=(fromDir?fromDir.split('/'):[]).concat(cleanTarget.split('/'));
                var out=[];
                for(var pi=0;pi<parts.length;pi++){
                    var p=parts[pi];
                    if(p===''||p==='.')continue;
                    if(p==='..'){out.pop();continue;}
                    out.push(p);
                }
                resolved=out.join('/');
            }
            var direct=findWithMd(resolved);
            if(direct)return direct;
        }
        var baseName=rawTarget.split('#')[0].split('?')[0].split('/').pop();
        if(!baseName)return null;
        var lowerBase=baseName.toLowerCase();
        if(/\.(md|markdown)$/i.test(baseName)){
            return pathIndex.byBase[lowerBase]===undefined?null:pathIndex.byBase[lowerBase];
        }
        return pathIndex.markdownByStem[lowerBase]||null;
    },
    detectLayer:detectLayer,
    detectPatterns:function(files){
        var patterns=[];
        var singletons=files.filter(function(f){return f.content&&(f.content.includes('getInstance')||f.content.match(/let\s+instance\s*=/)||f.content.match(/private\s+static\s+instance/));});
        if(singletons.length)patterns.push({name:'Singleton',icon:'lock',desc:'Ensures a class has only one instance. Common for configuration, logging, or connection pools.',severity:'info',files:singletons.map(function(f){return{name:f.name,path:f.path};}),metrics:{instances:singletons.length}});
        var factories=files.filter(function(f){return f.content&&(f.name.toLowerCase().includes('factory')||f.content.match(/create[A-Z]\w*\s*\(/)||f.content.includes('return new'));});
        if(factories.length)patterns.push({name:'Factory',icon:'factory',desc:'Creates objects without specifying exact class. Enables loose coupling and extensibility.',severity:'info',files:factories.map(function(f){return{name:f.name,path:f.path};}),metrics:{factories:factories.length}});
        var observers=files.filter(function(f){return f.content&&(f.content.includes('subscribe')||f.content.includes('addEventListener')||f.content.includes('.on(')||f.content.includes('emit('));});
        if(observers.length)patterns.push({name:'Observer/Event',icon:'eye',desc:'Defines a subscription mechanism for event-driven architecture. Great for decoupling.',severity:'info',files:observers.map(function(f){return{name:f.name,path:f.path};}),metrics:{emitters:observers.length}});
        var hooks=files.filter(function(f){return f.content&&f.content.match(/export\s+(?:const|function)\s+use[A-Z]/);});
        if(hooks.length)patterns.push({name:'Custom Hooks',icon:'hook',desc:'React hooks for reusable stateful logic. Promotes code reuse and separation of concerns.',severity:'info',files:hooks.map(function(f){return{name:f.name,path:f.path};}),metrics:{hooks:hooks.length}});
        var hocs=files.filter(function(f){return f.content&&(f.content.match(/with[A-Z]\w*\s*=\s*\(/)||f.content.match(/export\s+default\s+connect/));});
        if(hocs.length)patterns.push({name:'Higher-Order Component',icon:'spark',desc:'Functions that take a component and return an enhanced component.',severity:'info',files:hocs.map(function(f){return{name:f.name,path:f.path};}),metrics:{hocs:hocs.length}});
        var providers=files.filter(function(f){return f.content&&(f.content.includes('createContext')||f.content.includes('Provider')||f.content.includes('useContext'));});
        if(providers.length)patterns.push({name:'Context Provider',icon:'globe',desc:'React Context for global state. Alternative to prop drilling.',severity:'info',files:providers.map(function(f){return{name:f.name,path:f.path};}),metrics:{contexts:providers.length}});
        // VBA-specific patterns
        var vbaUserForms=files.filter(function(f){return f.content&&(f.content.match(/Attribute\s+VB_Name\s*=\s*["']UserForm/i)||f.name.match(/UserForm/i));});
        if(vbaUserForms.length)patterns.push({name:'UserForms',icon:'layout',desc:'VBA UserForms for UI components. Common in Excel/Access automation.',severity:'info',files:vbaUserForms.map(function(f){return{name:f.name,path:f.path};}),metrics:{forms:vbaUserForms.length}});
        var vbaModules=files.filter(function(f){return f.content&&(f.content.match(/Attribute\s+VB_Name\s*=\s*["']Module/i)||f.name.match(/Module/i));});
        if(vbaModules.length)patterns.push({name:'Modules',icon:'box',desc:'VBA Modules for reusable code and business logic.',severity:'info',files:vbaModules.map(function(f){return{name:f.name,path:f.path};}),metrics:{modules:vbaModules.length}});
        var vbaClasses=files.filter(function(f){return f.content&&(f.content.match(/Attribute\s+VB_Name\s*=\s*["']Class/i)||f.name.match(/Class/i));});
        if(vbaClasses.length)patterns.push({name:'Class Modules',icon:'building',desc:'VBA Class Modules for object-oriented programming patterns.',severity:'info',files:vbaClasses.map(function(f){return{name:f.name,path:f.path};}),metrics:{classes:vbaClasses.length}});
        // Python-specific patterns
        var decoratorFiles=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&f.content.match(/@\w+\s*(?:\(.*\))?\s*\n\s*(?:def|class)/);});
        var pyDecorators=decoratorFiles.filter(function(f){return f.content.match(/@(?:app\.route|router\.|blueprint\.|get|post|put|delete|patch)\s*\(/);});
        if(pyDecorators.length)patterns.push({name:'Route Decorators',icon:'route',desc:'Flask/FastAPI/Django route decorators for URL routing. Common in Python web frameworks.',severity:'info',files:pyDecorators.map(function(f){return{name:f.name,path:f.path};}),metrics:{routes:pyDecorators.length}});
        var dataclasses=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&f.content.match(/@dataclass/);});
        if(dataclasses.length)patterns.push({name:'Dataclasses',icon:'database',desc:'Python dataclasses for structured data. Reduces boilerplate for data-holding classes.',severity:'info',files:dataclasses.map(function(f){return{name:f.name,path:f.path};}),metrics:{dataclasses:dataclasses.length}});
        var abcFiles=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/\bABC\b/)||f.content.match(/@abstractmethod/)||f.content.match(/ABCMeta/));});
        if(abcFiles.length)patterns.push({name:'Abstract Base Classes',icon:'layers',desc:'Python ABCs enforce interface contracts. Ensures subclasses implement required methods.',severity:'info',files:abcFiles.map(function(f){return{name:f.name,path:f.path};}),metrics:{abcs:abcFiles.length}});
        var ctxManagers=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/@contextmanager/)||f.content.match(/def\s+__enter__/));});
        if(ctxManagers.length)patterns.push({name:'Context Managers',icon:'refresh',desc:'Python context managers for resource management (with statement). Ensures proper cleanup.',severity:'info',files:ctxManagers.map(function(f){return{name:f.name,path:f.path};}),metrics:{managers:ctxManagers.length}});
        var pyMixins=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&f.content.match(/class\s+\w*Mixin\w*\s*[\(:]?/);});
        if(pyMixins.length)patterns.push({name:'Mixins',icon:'puzzle',desc:'Python mixins for reusable behavior through multiple inheritance.',severity:'info',files:pyMixins.map(function(f){return{name:f.name,path:f.path};}),metrics:{mixins:pyMixins.length}});
        var pySignals=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/Signal\s*\(/)||f.content.match(/@receiver\s*\(/)||f.content.match(/\.connect\s*\(/));});
        if(pySignals.length)patterns.push({name:'Django Signals',icon:'radio',desc:'Django signals for decoupled event-driven communication between components.',severity:'info',files:pySignals.map(function(f){return{name:f.name,path:f.path};}),metrics:{signals:pySignals.length}});
        var pyMiddleware=files.filter(function(f){return f.content&&f.name.endsWith('.py')&&(f.content.match(/class\s+\w*Middleware/)||f.content.match(/def\s+middleware\s*\(/)||f.name.toLowerCase().includes('middleware'));});
        if(pyMiddleware.length)patterns.push({name:'Middleware',icon:'link',desc:'Request/response middleware for cross-cutting concerns (auth, logging, CORS).',severity:'info',files:pyMiddleware.map(function(f){return{name:f.name,path:f.path};}),metrics:{middleware:pyMiddleware.length}});
        var godFiles=files.filter(function(f){return f.isCode!==false&&f.functions&&f.functions.length>15;});
        if(godFiles.length)patterns.push({name:'God Object',icon:'warning',desc:'Files with too many responsibilities (15+ functions). Consider splitting into smaller modules.',severity:'warning',isAnti:true,files:godFiles.map(function(f){return{name:f.name,path:f.path,fns:f.functions.length};}),metrics:{files:godFiles.length,avgFns:Math.round(godFiles.reduce(function(s,f){return s+f.functions.length;},0)/godFiles.length)}});
        var longFiles=files.filter(function(f){return f.isCode!==false&&f.lines&&f.lines>500;});
        if(longFiles.length)patterns.push({name:'Long File',icon:'scroll',desc:'Files over 500 lines are harder to maintain. Consider breaking into smaller modules.',severity:'warning',isAnti:true,files:longFiles.map(function(f){return{name:f.name,path:f.path,lines:f.lines};}),metrics:{files:longFiles.length,avgLines:Math.round(longFiles.reduce(function(s,f){return s+f.lines;},0)/longFiles.length)}});
        // VBA-specific anti-patterns
        var vbaGodFiles=files.filter(function(f){return f.isCode!==false&&f.functions&&f.functions.length>20;});
        if(vbaGodFiles.length)patterns.push({name:'VBA God Module',icon:'warning',desc:'VBA modules with 20+ procedures. Consider splitting into smaller modules.',severity:'warning',isAnti:true,files:vbaGodFiles.map(function(f){return{name:f.name,path:f.path,fns:f.functions.length,lines:f.lines};}),metrics:{files:vbaGodFiles.length,avgFns:Math.round(vbaGodFiles.reduce(function(s,f){return s+f.functions.length;},0)/vbaGodFiles.length)}});
        return patterns;
    },
    detectDuplicates:function(files,allFns){
        var duplicates=[];

        // Common function names that are expected to be duplicated across files
        // These are idiomatic patterns, not DRY violations
        var commonNames=new Set([
            // React lifecycle and handlers
            'render','componentDidMount','componentWillUnmount','componentDidUpdate',
            'shouldComponentUpdate','getDerivedStateFromProps','getSnapshotBeforeUpdate',
            'handleClick','handleChange','handleSubmit','handleInput','handleKeyDown',
            'handleKeyUp','handleKeyPress','handleBlur','handleFocus','handleScroll',
            'handleMouseEnter','handleMouseLeave','handleDrag','handleDrop',
            'onClick','onChange','onSubmit','onBlur','onFocus','onKeyDown',
            // Common utility names
            'init','setup','cleanup','destroy','reset','clear','update','refresh',
            'validate','parse','format','transform','convert','process','execute',
            'get','set','fetch','load','save','create','delete','remove','add',
            'find','filter','map','reduce','sort','merge','clone','copy',
            // Test patterns
            'beforeEach','afterEach','beforeAll','afterAll','describe','it','test',
            'setUp','tearDown','mock',
            // Common class methods
            'toString','valueOf','equals','hashCode','compare','clone',
            'serialize','deserialize','toJSON','fromJSON',
            // Express/API patterns
            'index','show','store','update','destroy','create','edit',
            // Python common patterns
            '__init__','__str__','__repr__','__len__','__eq__','__hash__','__enter__','__exit__',
            '__getattr__','__setattr__','__delattr__','__getitem__','__setitem__','__contains__',
            '__iter__','__next__','__call__','__bool__','__lt__','__gt__','__le__','__ge__',
            'upgrade','downgrade','setUp','tearDown','setUpClass','tearDownClass',
            'main','create_app','configure','register','on_startup','on_shutdown','lifespan',
            // Vue lifecycle
            'mounted','created','updated','destroyed','beforeCreate','beforeMount',
            // Angular lifecycle
            'ngOnInit','ngOnDestroy','ngOnChanges','ngAfterViewInit',
            // Svelte
            'onMount','onDestroy',
            // Next.js App Router route-handler & metadata exports (framework-mandated names)
            'GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS',
            'generateMetadata','generateStaticParams','generateImageMetadata','generateSitemaps','middleware'
        ]);

        // Group functions by name (excluding common names)
        var fnByName=Object.create(null);
        allFns.forEach(function(fn){
            // Skip functions outside shipped product code (tests, fixtures, tooling, docs)
            if(isNonProductionPath(fn.file))return;
            // Skip non-string names (e.g. numeric object-literal keys from the JS AST walker)
            if(typeof fn.name!=='string')return;
            // Skip common/idiomatic names
            if(commonNames.has(fn.name))return;
            // Skip very short names (likely false positives)
            if(fn.name.length<3)return;
            // Skip class methods (same method name in different classes is normal)
            if(fn.isClassMethod)return;
            // Skip Python class-scoped names (ClassName.method)
            if(fn.name.includes('.'))return;
            // Skip decorated functions (framework handlers have similar structures by design)
            if(fn.decorators&&fn.decorators.length>0)return;

            if(!fnByName[fn.name])fnByName[fn.name]=[];
            fnByName[fn.name].push(fn);
        });

        // Find duplicate names across different files - only report if suspicious
        Object.entries(fnByName).forEach(function(entry){
            var name=entry[0],fns=entry[1];
            var uniqueFiles=[...new Set(fns.map(function(f){return f.file;}))];

            // Only flag if in 3+ files (2 files might be intentional)
            if(uniqueFiles.length>=3){
                // Check if the code is actually similar (not just same name)
                var codeSamples=fns.filter(function(f){return f.code&&f.code.length>30;});
                if(codeSamples.length>=2){
                    // Compare first two code samples for similarity
                    var sim=Parser.codeSimilarity(codeSamples[0].code,codeSamples[1].code);
                    if(sim>0.5){  // More than 50% similar - likely a real duplicate
                        duplicates.push({
                            type:'name',
                            name:name,
                            count:uniqueFiles.length,
                            files:fns.map(function(f){return{file:f.file,line:f.line};}),
                            similarity:Math.round(sim*100),
                            suggestion:'Function "'+name+'" appears in '+uniqueFiles.length+' files with '+Math.round(sim*100)+'% similarity - consider consolidating'
                        });
                    }
                }
            }
        });

        // Find similar code blocks (improved algorithm)
        // Use structural hash that captures the essence of the code
        var codeGroups=Object.create(null);
        allFns.forEach(function(fn){
            if(!fn.code||fn.code.length<80)return;  // Skip very short functions

            // Create a structural fingerprint
            var fingerprint=Parser.codeFingerprint(fn.code);
            if(!fingerprint)return;

            if(!codeGroups[fingerprint])codeGroups[fingerprint]=[];
            codeGroups[fingerprint].push(fn);
        });

        Object.values(codeGroups).forEach(function(fns){
            if(fns.length>1){
                var uniqueFiles=[...new Set(fns.map(function(f){return f.file;}))];
                // Must be in different files to be a real duplication issue
                if(uniqueFiles.length>1){
                    // Verify with actual similarity check
                    var sim=Parser.codeSimilarity(fns[0].code,fns[1].code);
                    if(sim>0.7){  // 70% or more similar
                        duplicates.push({
                            type:'code',
                            name:fns.map(function(f){return f.name;}).join(', '),
                            count:fns.length,
                            files:fns.map(function(f){return{file:f.file,name:f.name,line:f.line};}),
                            similarity:Math.round(sim*100),
                            suggestion:'Similar code blocks ('+Math.round(sim*100)+'% match) - consider extracting to a shared utility'
                        });
                    }
                }
            }
        });

        return duplicates;
    },

    // Calculate code similarity using normalized comparison (0-1 scale)
    codeSimilarity:function(code1,code2){
        if(!code1||!code2)return 0;

        // Normalize both code blocks
        function normalize(code){
            return code
                .replace(/\/\/.*$/gm,'')           // Remove JS single-line comments
                .replace(/#.*$/gm,'')              // Remove Python/Ruby comments
                .replace(/\/\*[\s\S]*?\*\//g,'')   // Remove multi-line comments
                .replace(/"""[\s\S]*?"""/g,'S')    // Remove Python docstrings (triple double)
                .replace(/'''[\s\S]*?'''/g,'S')    // Remove Python docstrings (triple single)
                .replace(/['"`][^'"`]*['"`]/g,'S') // Normalize strings
                .replace(/\b\d+\.?\d*\b/g,'N')     // Normalize numbers
                .replace(/\s+/g,' ')               // Normalize whitespace
                .trim();
        }

        var n1=normalize(code1);
        var n2=normalize(code2);

        if(n1===n2)return 1;
        if(n1.length===0||n2.length===0)return 0;

        var lcs=Parser.lcsLength(n1,n2);
        return lcs/Math.max(n1.length,n2.length);
    },

    // Longest common subsequence length (optimized for similarity)
    lcsLength:function(s1,s2){
        // Use simplified approach for performance
        if(s1.length>500||s2.length>500){
            // For long strings, use sampling
            s1=s1.substring(0,500);
            s2=s2.substring(0,500);
        }

        var m=s1.length,n=s2.length;
        // Typed rows avoid allocating boxed numbers in the O(n*m) inner loop.
        // Values cannot exceed the 500-character sampling cap above.
        var prev=new Uint16Array(n+1);
        var curr=new Uint16Array(n+1);

        for(var i=1;i<=m;i++){
            var leftCode=s1.charCodeAt(i-1);
            for(var j=1;j<=n;j++){
                if(leftCode===s2.charCodeAt(j-1)){
                    curr[j]=prev[j-1]+1;
                }else{
                    curr[j]=prev[j]>curr[j-1]?prev[j]:curr[j-1];
                }
            }
            var tmp=prev;prev=curr;curr=tmp;
            curr.fill(0);
        }
        return prev[n];
    },

    // Create a structural fingerprint for code (for grouping similar code)
    codeFingerprint:function(code){
        if(!code||code.length<50)return null;

        // Extract structural elements
        var structure=code
            .replace(/\/\/.*$/gm,'')           // Remove comments
            .replace(/\/\*[\s\S]*?\*\//g,'')
            .replace(/['"`][^'"`]*['"`]/g,'')  // Remove string contents
            .replace(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g,'I')  // All identifiers -> I
            .replace(/\b\d+\.?\d*\b/g,'N')     // All numbers -> N
            .replace(/\s+/g,'');               // Remove whitespace

        // Take a hash-like fingerprint based on structure length and key patterns
        var patterns={
            loops:(structure.match(/for|while/g)||[]).length,
            conditions:(structure.match(/if|\?/g)||[]).length,
            calls:(structure.match(/I\(/g)||[]).length,
            returns:(structure.match(/return/g)||[]).length,
            len:Math.floor(structure.length/50)*50  // Bucket by length
        };

        // Create fingerprint string
        return 'L'+patterns.loops+'C'+patterns.conditions+'F'+patterns.calls+'R'+patterns.returns+'S'+patterns.len;
    },
    detectLayerViolations:function(files,connections){
        var violations=[];
        var layerOrder={presentation:0,ui:0,component:0,components:0,page:0,view:0,feature:1,service:2,services:2,api:2,data:3,model:3,util:4,utils:4,helper:4,lib:4,core:4,config:5,test:6,modules:5,forms:0,classes:3};
        var fileByPath={};
        files.forEach(function(f){fileByPath[f.path]=f;});
        connections.forEach(function(c){
            // Convention (see buildAnalysisData): source = file DEFINING the fn (imported),
            // target = file CALLING it (the importer). The importer is c.target.
            var importedFile=fileByPath[c.source];
            var importerFile=fileByPath[c.target];
            if(!importedFile||!importerFile)return;
            var importedLayer=(importedFile.layer||'').toLowerCase();
            var importerLayer=(importerFile.layer||'').toLowerCase();
            // Test files legitimately depend on every layer — never flag them as violators.
            // Use both classifiers: isArchitectureTestFile catches *.test/*.spec files outside
            // a tests/ dir; the 'test' layer catches Python test_*.py, conftest.py, and test-folders.
            if(isArchitectureTestFile(importerFile.path)||importerLayer==='test')return;
            var importedLevel=layerOrder[importedLayer];
            var importerLevel=layerOrder[importerLayer];
            // Violation: a more-foundational file (higher level number) imports from a higher-up layer.
            if(importerLevel!==undefined&&importedLevel!==undefined&&importerLevel>importedLevel&&importerLevel-importedLevel>1){
                violations.push({
                    from:importerFile.path,
                    fromLayer:importerFile.layer,
                    to:importedFile.path,
                    toLayer:importedFile.layer,
                    fn:c.fn,
                    suggestion:importerFile.layer+' should not import from '+importedFile.layer+'. Consider inverting the dependency or using dependency injection.'
                });
            }
        });
        return violations;
    },
    calcComplexity:function(content,filename){
        if(!content)return{score:0,level:'low'};
        if(filename&&Parser.isScriptContainer(filename)){
            var blocks=Parser.getEmbeddedCodeBlocks(content,filename,{includeHandlers:true});
            if(!blocks.length)return{score:0,level:'low'};
            content=blocks.map(function(block){return block.content;}).join('\n');
        }
        // Approximate cyclomatic complexity - supports JS, Python, Ruby, and other languages
        var complexity=1;
        // JS/C-style patterns
        var patterns=[/\bif\s*\(/g,/\belse\s+if\s*\(/g,/\bwhile\s*\(/g,/\bfor\s*\(/g,/\bcase\s+/g,/\bcatch\s*\(/g,/\?\s*[^:]+\s*:/g,/&&/g,/\|\|/g];
        // Python-specific patterns
        var pyPatterns=[/\bif\s+[^(]/g,/\belif\s+/g,/\bwhile\s+[^(]/g,/\bfor\s+\w+\s+in\s+/g,/\bexcept\s*/g,/\bwith\s+/g,/\band\b/g,/\bor\b/g,/\bif\s+.+\s+else\s+/g,/\bfor\s+.+\s+in\s+[^\n]*\]/g];
        // Ruby-specific branch keywords (if/while are covered by the Python patterns)
        var rbPatterns=[/\belsif\s+/g,/\bunless\s+/g,/\bwhen\s+/g,/\brescue\b/g,/\buntil\s+/g];
        patterns.concat(pyPatterns,rbPatterns).forEach(function(p){var m=content.match(p);if(m)complexity+=m.length;});
        // Deduplicate: if both `if (` and `if ` match the same lines, the count is inflated
        // but for a quick approximation this is acceptable
        var level='low';
        if(complexity>30)level='critical';
        else if(complexity>20)level='high';
        else if(complexity>10)level='medium';
        return{score:complexity,level:level};
    },
    generateSuggestions:function(data){
        var suggestions=[];
        // Based on dead functions
        if(data.stats.dead>10){
            suggestions.push({priority:'high',icon:'broom',title:'Remove Dead Code',desc:data.stats.dead+' unused functions detected. Removing them will improve maintainability and reduce bundle size.',action:'Review unused functions in the Issues panel',impact:'Reduces codebase by ~'+(data.stats.dead*15)+' lines'});
        }
        // Based on circular dependencies
        var circular=data.issues.filter(function(i){return i.title&&i.title.includes('Circular');});
        if(circular.length){
            suggestions.push({priority:'critical',icon:'refresh',title:'Break Circular Dependencies',desc:circular.length+' circular dependencies found. These cause tight coupling and make testing difficult.',action:'Extract shared code to a new module or use dependency injection',impact:'Improves testability and modularity'});
        }
        // Based on god files
        var godFiles=data.issues.filter(function(i){return i.title&&i.title.includes('Large');});
        if(godFiles.length){
            suggestions.push({priority:'high',icon:'split',title:'Split Large Files',desc:godFiles.length+' files have too many functions. Split by responsibility.',action:'Group related functions and extract to separate modules',impact:'Improves code navigation and testing'});
        }
        // Based on high coupling
        var coupling=data.issues.filter(function(i){return i.title&&i.title.includes('Coupled');});
        if(coupling.length){
            suggestions.push({priority:'medium',icon:'link',title:'Reduce Coupling',desc:coupling.length+' files are imported by many others. Consider if this is intentional.',action:'Review if these should be split or if importers should be consolidated',impact:'Reduces blast radius of changes'});
        }
        // Based on duplicates
        if(data.duplicates&&data.duplicates.length>0){
            var nameDups=data.duplicates.filter(function(d){return d.type==='name';});
            var codeDups=data.duplicates.filter(function(d){return d.type==='code';});
            if(nameDups.length){
                suggestions.push({priority:'medium',icon:'copy',title:'Resolve Naming Conflicts',desc:nameDups.length+' function names are duplicated across files. This can cause confusion.',action:'Rename functions to be more specific or consolidate into shared module',impact:'Prevents bugs from importing wrong function'});
            }
            if(codeDups.length){
                suggestions.push({priority:'high',icon:'box',title:'Extract Duplicated Code',desc:codeDups.length+' instances of similar code found. DRY principle violation.',action:'Create shared utility functions',impact:'Reduces maintenance burden and potential bugs'});
            }
        }
        // Based on layer violations
        if(data.layerViolations&&data.layerViolations.length>0){
            suggestions.push({priority:'high',icon:'layers',title:'Fix Architecture Violations',desc:data.layerViolations.length+' layer violations found. Lower layers should not depend on higher layers.',action:'Invert dependencies or use interfaces/events',impact:'Improves architecture and testability'});
        }
        // Based on security
        var highSec=data.securityIssues?data.securityIssues.filter(function(s){return s.severity==='high';}):[];
        if(highSec.length){
            suggestions.push({priority:'critical',icon:'shield',title:'Fix Security Issues',desc:highSec.length+' high-severity security issues found.',action:'Address hardcoded secrets, injection risks immediately',impact:'Prevents potential security breaches'});
        }
        // Test coverage hint
        var testFiles=data.files.filter(function(f){return Parser.isTestFile(f.path);});
        var testRatio=data.files.length>0?(testFiles.length/data.files.length*100):0;
        if(testRatio<10&&data.files.length>10){
            suggestions.push({priority:'medium',icon:'beaker',title:'Add Test Coverage',desc:'Only '+testFiles.length+' test files found ('+Math.round(testRatio)+'%). Consider adding more tests.',action:'Focus on testing critical paths and high-complexity files',impact:'Prevents regressions and improves confidence'});
        }
        return suggestions.sort(function(a,b){var p={critical:0,high:1,medium:2,low:3};return p[a.priority]-p[b.priority];});
    },
    detectSecurity:function(files){
        var issues=[];
        files.forEach(function(f){
            var scanContent=getSecurityScanContent(f);
            if(!scanContent)return;
            var syntax=inspectJavaScriptSecurity(scanContent,f.path||f.name,{acorn:acorn,Babel:Babel,
                blocks:Parser.isScriptContainer(f.path||f.name)?Parser.getEmbeddedCodeBlocks(scanContent,f.path||f.name,{includeHandlers:true}):undefined});
            var lines=scanContent.split('\n');
            lines.forEach(function(line,idx){
                if(!isSecretScanExemptPath(f.path)&&line.match(/(?:password|passwd|pwd|secret|api_key|apikey|token|auth)\s*[=:]\s*['"][^'"]{4,}['"]/i)&&!line.includes('process.env')&&!line.includes('config.')){
                    issues.push({severity:'high',title:'Hardcoded Secret',file:f.name,path:f.path,line:idx+1,desc:'Credentials should never be hardcoded. Use environment variables or a secrets manager.',code:line.trim().substring(0,80)});
                }
            });
            var hasSqlConcat=scanContent.match(/query\s*\(\s*['"`][^'"`]*\s*\+/)||scanContent.match(/execute\s*\(\s*['"`][^'"`]*\$\{/);
            var dbCallRegex=/\b(?:query|execute|raw)\s*\(([^)]*)\)/gi;
            var hasSqlTemplateInjection=false;
            var dbCall;
            while((dbCall=dbCallRegex.exec(scanContent))!==null){
                if(/\$\{/.test(dbCall[1])&&/(?:SELECT|INSERT|UPDATE|DELETE)/i.test(dbCall[1])){hasSqlTemplateInjection=true;break;}
            }
            if(f.isCode&&(syntax?syntax.sql:hasSqlConcat||hasSqlTemplateInjection)){
                var m=scanContent.match(/.*(query|execute|SELECT|INSERT|UPDATE|DELETE).*(\+|\$\{).*/i);
                issues.push({severity:'high',title:'SQL Injection Risk',file:f.name,path:f.path,desc:'String concatenation in SQL queries. Use parameterized queries instead.',code:m?m[0].trim().substring(0,80):''});
            }
            var hasInnerHtmlAssignment=scanContent.match(/innerHTML\s*=/);
            var hasDangerousHtmlRender=scanContent.match(/dangerouslySetInnerHTML/);
            var isSafePreviewRender=!hasInnerHtmlAssignment&&hasDangerousHtmlRender&&isSanitizedPreviewRenderer(f.content||'');
            var htmlValueRegex=/dangerouslySetInnerHTML\s*[:=]\s*\{\{?\s*__html\s*:\s*([^}]+)\}/g;
            var allHtmlValuesLiteral=true;
            var foundHtmlValue=false;
            var htmlMatch;
            while((htmlMatch=htmlValueRegex.exec(scanContent))!==null){
                foundHtmlValue=true;
                if(!/^(['"`])(?:(?!\1)[\s\S])*\1$/.test(htmlMatch[1].trim())){
                    allHtmlValuesLiteral=false;
                }
            }
            var isSafeStaticHtml=!hasInnerHtmlAssignment&&hasDangerousHtmlRender&&foundHtmlValue&&allHtmlValuesLiteral;
            if(!isNonProductionPath(f.path)&&(syntax?syntax.xss:(hasInnerHtmlAssignment||hasDangerousHtmlRender)&&!isSafePreviewRender&&!isSafeStaticHtml)){
                issues.push({severity:'high',title:'XSS Vulnerability',file:f.name,path:f.path,desc:'Direct HTML injection can lead to XSS attacks. Sanitize user input.',code:''});
            }
            if(syntax?syntax.evalLines.length:scanContent.includes('eval(')){
                var evalLine=syntax?syntax.evalLines[0]-1:lines.findIndex(function(l){return l.includes('eval(');});
                issues.push({severity:'medium',title:'Dynamic Code Execution',file:f.name,path:f.path,line:evalLine+1,desc:'eval() executes arbitrary code. Avoid if possible or validate input strictly.',code:evalLine>=0?lines[evalLine].trim().substring(0,80):''});
            }
            if(syntax?syntax.functionLines.length:scanContent.match(/\b(?:new\s+)?Function\s*\(/)){
                issues.push({severity:'medium',title:'Function Constructor',file:f.name,path:f.path,desc:'Function constructor is similar to eval(). Consider alternatives.',code:''});
            }
            var execMatch=scanContent.match(/(?:child_process|cp)\.\w*[Ee]xec\w*\s*\(/)||scanContent.match(/require\(\s*['"](?:node:)?child_process['"]\s*\)/)||scanContent.match(/from\s+['"](?:node:)?child_process['"]/);
            if(!isNonProductionPath(f.path)&&(syntax?syntax.commandLines.length:execMatch)){
                issues.push({severity:'medium',title:'Command Execution',file:f.name,path:f.path,desc:'Shell command execution detected. Ensure input is sanitized to prevent injection.',code:''});
            }
            if(syntax?syntax.consoleLines.length:scanContent.match(/console\.(log|debug|info)\(/)){
                var consoleCount=syntax?syntax.consoleLines.length:(scanContent.match(/console\.(log|debug|info)\(/g)||[]).length;
                if(consoleCount>3){
                    var debugSeverity=isArchitectureBackendPath(f.path)?'info':'low';
                    issues.push({severity:debugSeverity,title:'Debug Statements',file:f.name,path:f.path,desc:consoleCount+' console statements found. Remove before production.',code:''});
                }
            }
            // VBA-specific security checks
            if(Parser.isVBA(f.path||f.name)){
            if(scanContent.match(/SendKeys\s*\(/i)){
                issues.push({severity:'high',title:'SendKeys Usage',file:f.name,path:f.path,desc:'SendKeys can be exploited for code injection. Avoid using SendKeys.',code:''});
            }
            if(!isNonProductionPath(f.path)&&scanContent.match(/Shell\s*\(/i)){
                issues.push({severity:'high',title:'Shell Command Execution',file:f.name,path:f.path,desc:'Shell() executes system commands. Ensure input is validated.',code:''});
            }
            if(scanContent.match(/CreateObject\s*\(\s*["']WScript\.Shell["']/i)){
                issues.push({severity:'high',title:'WScript.Shell Creation',file:f.name,path:f.path,desc:'Creating WScript.Shell object allows command execution. Use with caution.',code:''});
            }
            if(scanContent.match(/Application\.Run\s*\(/i)){
                issues.push({severity:'medium',title:'Dynamic Code Execution',file:f.name,path:f.path,desc:'Application.Run can execute arbitrary code. Validate input.',code:''});
            }
            if(scanContent.match(/On Error Resume Next/i)){
                var errorResumeCount=(scanContent.match(/On Error Resume Next/gi)||[]).length;
                if(errorResumeCount>2){
                    issues.push({severity:'medium',title:'Excessive Error Suppression',file:f.name,path:f.path,desc:errorResumeCount+' instances of "On Error Resume Next" found. This can hide bugs.',code:''});
                }
            }
            }
            if(syntax?syntax.todos:scanContent.match(/TODO|FIXME|HACK|XXX/)){
                var todoCount=syntax?syntax.todos:(scanContent.match(/TODO|FIXME|HACK|XXX/g)||[]).length;
                issues.push({severity:'low',title:'Code Comments',file:f.name,path:f.path,desc:todoCount+' TODO/FIXME comments found. Address before release.',code:''});
            }
            // Python-specific security checks
            var isPyFile=f.name.endsWith('.py')||f.name.endsWith('.pyw');
            if(isPyFile&&scanContent){
                // eval() and exec() - arbitrary code execution
                if(scanContent.match(/\beval\s*\(/)){
                    var evalLine=lines.findIndex(function(l){return l.match(/\beval\s*\(/);});
                    issues.push({severity:'high',title:'Python eval()',file:f.name,path:f.path,line:evalLine>=0?evalLine+1:undefined,desc:'eval() executes arbitrary Python code. Use ast.literal_eval() for safe parsing.',code:evalLine>=0?lines[evalLine].trim().substring(0,80):''});
                }
                if(scanContent.match(/\bexec\s*\(/)){
                    var execLine=lines.findIndex(function(l){return l.match(/\bexec\s*\(/);});
                    issues.push({severity:'high',title:'Python exec()',file:f.name,path:f.path,line:execLine>=0?execLine+1:undefined,desc:'exec() executes arbitrary Python code. This is almost always a security risk.',code:execLine>=0?lines[execLine].trim().substring(0,80):''});
                }
                // pickle - deserialization attacks
                if(scanContent.match(/\bpickle\.load/)||scanContent.match(/\bunpickle/)){
                    issues.push({severity:'high',title:'Pickle Deserialization',file:f.name,path:f.path,desc:'pickle.load() can execute arbitrary code from untrusted data. Use JSON or safe alternatives.',code:''});
                }
                // subprocess with shell=True
                if(!isNonProductionPath(f.path)&&scanContent.match(/subprocess\.\w+\([^)]*shell\s*=\s*True/)){
                    issues.push({severity:'high',title:'Shell Injection Risk',file:f.name,path:f.path,desc:'subprocess with shell=True is vulnerable to command injection. Use shell=False with a list of args.',code:''});
                }
                // os.system / os.popen - command injection
                if(scanContent.match(/\bos\.system\s*\(/)||scanContent.match(/\bos\.popen\s*\(/)){
                    var osLine=lines.findIndex(function(l){return l.match(/\bos\.(system|popen)\s*\(/);});
                    issues.push({severity:'high',title:'OS Command Execution',file:f.name,path:f.path,line:osLine>=0?osLine+1:undefined,desc:'os.system()/os.popen() are vulnerable to command injection. Use subprocess with shell=False.',code:osLine>=0?lines[osLine].trim().substring(0,80):''});
                }
                // __import__ - dynamic imports
                if(scanContent.match(/__import__\s*\(/)){
                    issues.push({severity:'medium',title:'Dynamic Import',file:f.name,path:f.path,desc:'__import__() with user input can load arbitrary modules. Validate module names against an allowlist.',code:''});
                }
                // Bare except clauses
                var bareExcepts=(scanContent.match(/\bexcept\s*:/g)||[]).length;
                if(bareExcepts>2){
                    issues.push({severity:'medium',title:'Bare Except Clauses',file:f.name,path:f.path,desc:bareExcepts+' bare except: clauses found. These catch all exceptions including SystemExit and KeyboardInterrupt.',code:''});
                }
                // assert in non-test files
                if(!f.name.includes('test')&&!f.path.includes('test')){
                    var assertCount=(scanContent.match(/\bassert\s+/g)||[]).length;
                    if(assertCount>5){
                        issues.push({severity:'low',title:'Assert in Production',file:f.name,path:f.path,desc:assertCount+' assert statements found. Assertions are stripped with python -O. Use proper validation.',code:''});
                    }
                }
                // Hardcoded DEBUG = True
                if(scanContent.match(/\bDEBUG\s*=\s*True\b/)){
                    issues.push({severity:'medium',title:'Debug Mode Enabled',file:f.name,path:f.path,desc:'DEBUG = True found. Ensure this is disabled in production.',code:''});
                }
            }
        });
        return issues.sort(function(a,b){var sev={high:0,medium:1,low:2,info:3};return sev[a.severity]-sev[b.severity];});
    },
    // AST-based function extraction - accurate detection without false positives
    extract:function(content,filename){
        if(Parser.isElixir(filename)&&Parser.getLoadedTreeSitterParser(filename))return Parser.analyzeElixir(content,filename).functions;
        var fns=[];
        var lines=content.split('\n');

        // Helper to extract code snippet for a function
        function extractCode(startLine,endLine){
            var code=[];
            var start=Math.max(0,startLine-1);
            var end=Math.min(lines.length,endLine||startLine+20);
            for(var i=start;i<end&&code.length<15;i++){
                code.push(lines[i]);
            }
            if(code.length>=15)code.push('  // ...');
            return code.join('\n');
        }

        // Track functions by line to allow same name at different locations
        var seenAtLine={};
        function addFn(fnObj){
            var key=fnObj.name+'@'+fnObj.line;
            if(!seenAtLine[key]){
                seenAtLine[key]=true;
                fns.push(fnObj);
            }
        }

        var scriptBlocks=Parser.getEmbeddedCodeBlocks(content,filename,{includeHandlers:false}).filter(function(block){
            return block.kind==='script';
        });
        if(scriptBlocks.length){
            scriptBlocks.forEach(function(block){
                Parser.extractJSFunctions(block.content,filename,block.offset,addFn,extractCode,block.isTS);
            });
            return fns;
        }
        if(Parser.isScriptContainer(filename)){
            return fns;
        }

        // Check file type
        var ext=filename.toLowerCase();
        var isJS=ext.endsWith('.js')||ext.endsWith('.jsx')||ext.endsWith('.mjs')||ext.endsWith('.cjs');
        var isTS=ext.endsWith('.ts')||ext.endsWith('.tsx');
        var isVue=ext.endsWith('.vue');
        var isSvelte=ext.endsWith('.svelte');
        var isPython=ext.endsWith('.py')||ext.endsWith('.pyw')||ext.endsWith('.pyi');

        // Extract script content from Vue/Svelte files
        var scriptContent=content;
        var scriptOffset=0;
        if(isVue||isSvelte){
            var scriptMatch=content.match(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/i);
            if(scriptMatch){
                scriptContent=scriptMatch[1];
                scriptOffset=content.substring(0,content.indexOf(scriptMatch[1])).split('\n').length-1;
                isJS=true;  // Treat extracted script as JS
                // Check if it's TypeScript
                if(content.match(/<script\b[^>]*\blang=["']ts["'][^>]*>/i)){
                    isTS=true;
                    isJS=false;
                }
            }else{
                // No script tag found
                return fns;
            }
            lines=scriptContent.split('\n');
        }

        // Try AST parsing for JS/TS files using real parsers
        if((isJS||isTS)&&typeof acorn!=='undefined'){
            var parseContent=scriptContent;
            var parseSuccess=false;

            // Use Babel (real parser) to handle JSX and TypeScript properly
            // Babel transforms JSX → React.createElement and strips TS types,
            // producing clean JS that acorn can parse into a proper AST
            if(typeof Babel!=='undefined'){
                try{
                    var babelPresets=['react'];
                    if(isTS)babelPresets.push('typescript');
                    var babelResult=Babel.transform(parseContent,{
                        presets:babelPresets,
                        filename:filename||'file.js',
                        sourceType:'module',
                        retainLines:true
                    });
                    parseContent=babelResult.code;
                }catch(babelErr){
                    // Babel failed, fall back to manual TypeScript stripping
                    if(isTS){
                        parseContent=Parser.stripTypeScript(scriptContent);
                    }
                }
            }else if(isTS){
                parseContent=Parser.stripTypeScript(scriptContent);
            }

            // Parse clean JS with acorn
            try{
                var ast=acorn.parse(parseContent,{
                    ecmaVersion:2022,
                    sourceType:'module',
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    allowReturnOutsideFunction:true,
                    locations:true
                });
                parseSuccess=true;

                // Walk the AST to find ALL function definitions
                function walk(node,scope,parentIsExport){
                    if(!node||typeof node!=='object')return;

                    var isTopLevel=(scope===0);

                    // FunctionDeclaration: function foo() {}
                    if(node.type==='FunctionDeclaration'&&node.id&&node.id.name){
                        var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                        var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                        addFn({
                            name:node.id.name,
                            file:filename,
                            line:line,
                            code:extractCode(line,endLine),
                            isTopLevel:isTopLevel,
                            isExported:parentIsExport||false,
                            type:'function'
                        });
                    }

                    // VariableDeclaration: const foo = () => {} or const foo = function() {}
                    if(node.type==='VariableDeclaration'){
                        node.declarations.forEach(function(decl){
                            if(decl.id&&decl.id.type==='Identifier'&&decl.init){
                                var init=decl.init;
                                // Direct function expression or arrow function ONLY
                                // NOT CallExpression (e.g., array.map(x => x))
                                if(init.type==='FunctionExpression'||init.type==='ArrowFunctionExpression'){
                                    var line=(decl.loc?decl.loc.start.line:1)+scriptOffset;
                                    var endLine=(decl.loc?decl.loc.end.line:line)+scriptOffset;
                                    addFn({
                                        name:decl.id.name,
                                        file:filename,
                                        line:line,
                                        code:extractCode(line,endLine),
                                        isTopLevel:isTopLevel,
                                        isExported:parentIsExport||false,
                                        type:init.type==='ArrowFunctionExpression'?'arrow':'function'
                                    });
                                }
                            }
                        });
                    }

                    // MethodDefinition in classes
                    if(node.type==='MethodDefinition'&&node.key){
                        var name=node.key.name||node.key.value;
                        if(name&&name!=='constructor'){
                            var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                            var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                            addFn({
                                name:name,
                                file:filename,
                                line:line,
                                code:extractCode(line,endLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method',
                                isClassMethod:true,
                                isGetter:node.kind==='get',
                                isSetter:node.kind==='set'
                            });
                        }
                    }

                    // Property with method shorthand: { foo() {} }
                    if(node.type==='Property'&&node.method&&node.key){
                        var name=node.key.name||node.key.value;
                        if(name){
                            var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                            var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                            addFn({
                                name:name,
                                file:filename,
                                line:line,
                                code:extractCode(line,endLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method'
                            });
                        }
                    }

                    // Property with function value: { foo: function() {} } or { foo: () => {} }
                    if(node.type==='Property'&&!node.method&&node.value&&node.key){
                        var val=node.value;
                        if(val.type==='FunctionExpression'||val.type==='ArrowFunctionExpression'){
                            var name=node.key.name||node.key.value;
                            if(name){
                                var line=(node.loc?node.loc.start.line:1)+scriptOffset;
                                var endLine=(node.loc?node.loc.end.line:line)+scriptOffset;
                                addFn({
                                    name:name,
                                    file:filename,
                                    line:line,
                                    code:extractCode(line,endLine),
                                    isTopLevel:false,
                                    isExported:false,
                                    type:'method'
                                });
                            }
                        }
                    }

                    // Handle exports
                    var nextIsExport=false;
                    if(node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration'){
                        nextIsExport=true;
                        if(node.declaration){
                            walk(node.declaration,scope,true);
                            return;
                        }
                    }

                    // Recurse - increase scope for function bodies
                    var newScope=scope;
                    if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||
                       node.type==='ArrowFunctionExpression'||node.type==='ClassDeclaration'||
                       node.type==='ClassExpression'){
                        newScope=scope+1;
                    }

                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end'||key==='raw')continue;
                        var child=node[key];
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,newScope,nextIsExport);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,newScope,nextIsExport);
                        }
                    }
                }

                walk(ast,0,false);

            }catch(e){
                // AST parsing failed
                parseSuccess=false;
            }

            // If AST parsing failed, use comprehensive regex fallback
            if(!parseSuccess){
                Parser.extractWithRegex(scriptContent,filename,scriptOffset,addFn,extractCode);
            }
        }else if(isPython){
            // Python: extract classes, functions, async functions, decorators, and methods
            var currentClass=null;
            var classIndent=-1;
            var decorators=[];
            lines.forEach(function(line,idx){
                var trimmed=line.trimStart();
                var indent=(line.match(/^(\s*)/)||['',''])[1].length;

                // Track decorators
                if(trimmed.match(/^@\w/)){
                    decorators.push(trimmed);
                    return;
                }

                // Detect class definitions
                var classMatch=line.match(/^(\s*)class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[\(:]?/);
                if(classMatch){
                    var cIndent=classMatch[1].length;
                    var className=classMatch[2];
                    var cEndLine=idx+1;
                    for(var i=idx+1;i<lines.length;i++){
                        var nl=lines[i];
                        if(nl.trim()===''||nl.match(/^\s*#/))continue;
                        var ni=(nl.match(/^(\s*)/)||['',''])[1].length;
                        if(ni<=cIndent&&nl.trim()!==''){cEndLine=i;break;}
                        cEndLine=i+1;
                    }
                    var hasDecorator=decorators.length>0;
                    var isDataclass=decorators.some(function(d){return d.includes('dataclass');});
                    var isABC=line.includes('ABC')||line.includes('ABCMeta');
                    addFn({
                        name:className,
                        file:filename,
                        line:idx+1,
                        code:extractCode(idx+1,Math.min(idx+20,cEndLine)),
                        isTopLevel:cIndent===0,
                        isExported:cIndent===0,
                        type:isDataclass?'dataclass':isABC?'abstract_class':'class',
                        decorators:hasDecorator?decorators.slice():undefined
                    });
                    currentClass=className;
                    classIndent=cIndent;
                    decorators=[];
                    return;
                }

                // Reset class context when dedented
                if(currentClass!==null&&indent<=classIndent&&trimmed!==''&&!trimmed.startsWith('#')){
                    currentClass=null;
                    classIndent=-1;
                }

                // Detect function/method definitions (including async def)
                var m=line.match(/^(\s*)(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
                if(m){
                    var fIndent=m[1].length;
                    var name=m[2];
                    var isAsync=line.match(/\basync\s+def\b/)!==null;
                    var isMethod=currentClass!==null&&fIndent>classIndent;
                    var isDunder=name.startsWith('__')&&name.endsWith('__');
                    var isPrivate=name.startsWith('_')&&!isDunder;
                    var isSelf=line.match(/def\s+\w+\s*\(\s*self[\s,)]/);
                    var isCls=line.match(/def\s+\w+\s*\(\s*cls[\s,)]/);
                    var hasDecorator=decorators.length>0;
                    var isProperty=decorators.some(function(d){return d.includes('@property');});
                    var isStaticmethod=decorators.some(function(d){return d.includes('@staticmethod');});
                    var isClassmethod=decorators.some(function(d){return d.includes('@classmethod');});

                    var endLine=idx+1;
                    for(var i=idx+1;i<lines.length;i++){
                        var nextLine=lines[i];
                        if(nextLine.trim()===''||nextLine.match(/^\s*#/))continue;
                        var nextIndent=(nextLine.match(/^(\s*)/)||['',''])[1].length;
                        if(nextIndent<=fIndent&&nextLine.trim()!==''){endLine=i;break;}
                        endLine=i+1;
                    }

                    var fnType='function';
                    if(isMethod){
                        if(isProperty)fnType='property';
                        else if(isStaticmethod)fnType='staticmethod';
                        else if(isClassmethod)fnType='classmethod';
                        else fnType='method';
                    }
                    if(isAsync)fnType='async_'+fnType;

                    addFn({
                        name:isMethod&&currentClass?currentClass+'.'+name:name,
                        file:filename,
                        line:idx+1,
                        code:extractCode(idx+1,endLine),
                        isTopLevel:fIndent===0,
                        isExported:fIndent===0&&!isPrivate,
                        isClassMethod:isMethod,
                        type:fnType,
                        className:isMethod?currentClass:undefined,
                        decorators:hasDecorator?decorators.slice():undefined
                    });
                    decorators=[];
                }else if(!classMatch){
                    // Reset decorators if line is not a def or class
                    if(trimmed!==''&&!trimmed.startsWith('#')&&!trimmed.startsWith('@')){
                        decorators=[];
                    }
                }
            });
        }else{
            // Other languages: use language-specific regex
            Parser.extractOtherLanguages(content,filename,addFn,extractCode);
        }

        return fns;
    },

    // Strip Python string literals and comments for accurate token-level analysis
    // This is a proper tokenizer approach: preserves code structure while removing non-code content
    stripPythonNonCode:function(content){
        var result=[];
        var i=0;
        var len=content.length;
        while(i<len){
            // Triple-quoted strings (must check before single quotes)
            if(i<len-2&&((content[i]==='"'&&content[i+1]==='"'&&content[i+2]==='"')||(content[i]==="'"&&content[i+1]==="'"&&content[i+2]==="'"))){
                var q3=content[i];
                i+=3;
                while(i<len-2){
                    if(content[i]===q3&&content[i+1]===q3&&content[i+2]===q3){i+=3;break;}
                    result.push(content[i]==='\n'?'\n':' ');
                    i++;
                }
            }
            // String prefixes (f/r/b/u and combinations like rb, fr, etc.)
            else if(i<len-1&&/^[frbuFRBU]{1,2}$/.test(content.slice(i,i+1+(content[i+1]&&/[frbuFRBU"']/.test(content[i+1])?1:0)).replace(/["']/g,''))&&
                    (content[i+1]==='"'||content[i+1]==="'"||content[i+2]==='"'||content[i+2]==="'")){
                // Skip prefix chars
                while(i<len&&content[i]!=='"'&&content[i]!=="'"){result.push(' ');i++;}
                // Fall through to string handling below (don't continue)
                if(i>=len)break;
                // Check for triple-quoted prefixed string
                if(i<len-2&&content[i+1]===content[i]&&content[i+2]===content[i]){
                    var pq3=content[i];i+=3;
                    while(i<len-2){
                        if(content[i]===pq3&&content[i+1]===pq3&&content[i+2]===pq3){i+=3;break;}
                        result.push(content[i]==='\n'?'\n':' ');i++;
                    }
                }else{
                    var pq=content[i];result.push(' ');i++;
                    while(i<len&&content[i]!==pq&&content[i]!=='\n'){
                        if(content[i]==='\\'){result.push(' ');i++;}
                        if(i<len){result.push(content[i]==='\n'?'\n':' ');i++;}
                    }
                    if(i<len&&content[i]===pq){result.push(' ');i++;}
                }
            }
            // Regular single/double quoted strings
            else if(content[i]==='"'||content[i]==="'"){
                var q=content[i];result.push(' ');i++;
                while(i<len&&content[i]!==q&&content[i]!=='\n'){
                    if(content[i]==='\\'){result.push(' ');i++;}
                    if(i<len){result.push(content[i]==='\n'?'\n':' ');i++;}
                }
                if(i<len&&content[i]===q){result.push(' ');i++;}
            }
            // Comments
            else if(content[i]==='#'){
                while(i<len&&content[i]!=='\n'){result.push(' ');i++;}
            }
            // Normal code - pass through
            else{
                result.push(content[i]);i++;
            }
        }
        return result.join('');
    },

    // Strip Object Pascal strings and all three comment forms while preserving
    // line breaks. This keeps heuristic call detection out of prose and examples.
    stripPascalNonCode:function(content){
        var result=[];
        var i=0;
        var len=content.length;
        while(i<len){
            if(content[i]==="'"){
                result.push(' ');i++;
                while(i<len){
                    if(content[i]==="'"&&content[i+1]==="'"){
                        result.push(' ',' ');i+=2;continue;
                    }
                    if(content[i]==="'"){result.push(' ');i++;break;}
                    result.push(content[i]==='\n'?'\n':' ');i++;
                }
            }else if(content[i]==='/'&&content[i+1]==='/'){
                result.push(' ',' ');i+=2;
                while(i<len&&content[i]!=='\n'){result.push(' ');i++;}
            }else if(content[i]==='{'){
                result.push(' ');i++;
                while(i<len&&content[i]!=='}'){
                    result.push(content[i]==='\n'?'\n':' ');i++;
                }
                if(i<len){result.push(' ');i++;}
            }else if(content[i]==='('&&content[i+1]==='*'){
                result.push(' ',' ');i+=2;
                while(i<len&&!(content[i]==='*'&&content[i+1]===')')){
                    result.push(content[i]==='\n'?'\n':' ');i++;
                }
                if(i<len){result.push(' ',' ');i+=2;}
            }else{
                result.push(content[i]);i++;
            }
        }
        return result.join('');
    },

    // Strip TypeScript syntax for Acorn parsing
    stripTypeScript:function(content){
        // Process line by line for more control
        var lines=content.split('\n');
        var result=[];
        var inInterface=false;
        var braceDepth=0;

        for(var i=0;i<lines.length;i++){
            var line=lines[i];

            // Skip type-only imports/exports
            if(line.match(/^\s*import\s+type\s/)||line.match(/^\s*export\s+type\s/)){
                result.push('');
                continue;
            }

            // Track interface/type blocks to skip
            if(line.match(/^\s*(?:export\s+)?interface\s+/)||line.match(/^\s*(?:export\s+)?type\s+\w+\s*=/)){
                inInterface=true;
                braceDepth=0;
            }

            if(inInterface){
                for(var j=0;j<line.length;j++){
                    if(line[j]==='{')braceDepth++;
                    if(line[j]==='}')braceDepth--;
                }
                if(braceDepth<=0&&(line.includes('}')||line.includes(';')||!line.match(/[{;]/))){
                    inInterface=false;
                }
                result.push('');
                continue;
            }

            // Remove type annotations carefully
            // Function params: (x: Type) -> (x)
            line=line.replace(/(\w)\s*:\s*[A-Za-z_$<>[\]|&\s,]+(?=[,\)])/g,'$1');
            // Return types: ): Type => -> ) =>  or ): Type { -> ) {
            line=line.replace(/\)\s*:\s*[A-Za-z_$<>[\]|&\s]+(?=\s*[{=>])/g,')');
            // Variable types: let x: Type = -> let x =
            line=line.replace(/(let|const|var)\s+(\w+)\s*:\s*[A-Za-z_$<>[\]|&\s]+\s*=/g,'$1 $2 =');
            // Generic type params: func<T>( -> func(
            // Apply repeatedly to handle nested or multiple occurrences
            var prevLine;
            do{
                prevLine=line;
                line=line.replace(/<[A-Za-z_$,\s]+>(?=\s*\()/g,'');
            }while(line!==prevLine);
            // As casts: x as Type -> x
            line=line.replace(/\s+as\s+[A-Za-z_$<>[\]|&\s]+(?=[,;\)\]\}]|$)/g,'');
            // Non-null assertions: x! -> x
            line=line.replace(/!(?=[\.\[\)\],;\s])/g,'');
            // Declare statements
            if(line.match(/^\s*declare\s+/)){
                result.push('');
                continue;
            }

            result.push(line);
        }

        return result.join('\n');
    },

    // Comprehensive regex fallback for JS/TS when AST fails
    extractWithRegex:function(content,filename,offset,addFn,extractCode){
        var lines=content.split('\n');

        lines.forEach(function(line,idx){
            var lineNum=idx+1+offset;
            var m;

            // Named function declarations (capture export keyword for isExported)
            if((m=line.match(/(export\s+(?:default\s+)?)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'function'});

            // Arrow functions assigned to const/let/var at START of meaningful content
            // Must have = directly followed by arrow function pattern
            if((m=line.match(/(export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'arrow'});

            // Arrow functions with single param (no parens): const foo = x =>
            if((m=line.match(/(export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'arrow'});

            // Function expressions: const foo = function
            if((m=line.match(/(export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?function\s*[(\w]/)))
                addFn({name:m[2],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,isExported:!!m[1],type:'function'});

            // Class methods (inside class body): methodName() { or async methodName() {
            if((m=line.match(/^\s+(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{/))&&!line.match(/^s*(if|for|while|switch|catch|function|const|let|var)/))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method',isClassMethod:true});

            // Object method shorthand (indented): foo() { or foo: function
            if((m=line.match(/^\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?function/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method'});

            // Object property arrow: foo: () =>
            if((m=line.match(/^\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method'});
        });
    },

    // Extract functions from other languages
    extractOtherLanguages:function(content,filename,addFn,extractCode){
        var lines=content.split('\n');
        var isPascal=Parser.isPascal(filename);
        var pascalContent=isPascal?Parser.stripPascalNonCode(content):'';
        var pascalLines=isPascal?pascalContent.split('\n'):null;
        var pascalHasImplementation=isPascal&&/^\s*implementation\b/im.test(pascalContent);
        var inPascalImplementation=!pascalHasImplementation;

        lines.forEach(function(line,idx){
            var lineNum=idx+1;
            var m;

            if(isPascal){
                var pascalLine=pascalLines[idx];
                if(/^\s*implementation\b/i.test(pascalLine)){
                    inPascalImplementation=true;
                    return;
                }
                if(!inPascalImplementation)return;
                if(!/^\s*(?:(?:class|static)\s+)?(?:procedure|function|constructor|destructor|operator)\b/i.test(pascalLine))return;
                var signature=pascalLine;
                for(var si=idx+1;si<lines.length&&si<=idx+8&&!/;/.test(signature);si++){
                    signature+=' '+pascalLines[si].trim();
                }
                m=signature.match(/^\s*(?:(?:class|static)\s+)?(procedure|function|constructor|destructor|operator)\s+([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)/i);
                if(m&&!/\b(?:forward|external)\b/i.test(signature)){
                    var qualifiedName=m[2];
                    var pascalName=qualifiedName.split('.').pop();
                    var isMethod=qualifiedName.indexOf('.')>=0;
                    addFn({
                        name:pascalName,
                        file:filename,
                        line:lineNum,
                        code:extractCode(lineNum),
                        isTopLevel:!isMethod,
                        isExported:true,
                        isClassMethod:isMethod,
                        type:m[1].toLowerCase(),
                        className:isMethod?qualifiedName.split('.')[0]:undefined
                    });
                }
                return;
            }

            // Go: func name(
            if((m=line.match(/^func\s+(?:\([^)]+\)\s*)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Java/C#/Kotlin: public void methodName( or similar
            if((m=line.match(/(?:public|private|protected|internal|static|final|override|virtual|abstract|async)\s+(?:(?:static|final|override|virtual|abstract|async)\s+)*(?:\w+\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:false,type:'method'});

            // Kotlin: fun name(
            if((m=line.match(/(?:suspend\s+)?fun\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[<(]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Ruby: def name / def self.name (singleton methods keep the real
            // method name — reporting them as "self" makes findings unreadable)
            if((m=line.match(/^\s*def\s+(?:self\s*\.\s*)?([a-zA-Z_][a-zA-Z0-9_]*[?!=]?)/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Rust: fn name or pub fn name
            if((m=line.match(/(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[<(]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // PHP: function name( or public function name(
            if((m=line.match(/(?:public|private|protected|static)?\s*function\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // C/C++: type name( at start or with visibility
            if((m=line.match(/^(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:\w+\s+)+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^;]*$/)))
                if(!line.match(/^\s*(if|for|while|switch|return|sizeof|typeof)/))
                    addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Swift: func name
            if((m=line.match(/(?:public|private|internal|fileprivate|open)?\s*(?:static\s+)?(?:class\s+)?func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[<(]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Scala: def name
            if((m=line.match(/\bdef\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[(\[]/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Elixir: def name or defp name
            if((m=line.match(/\bdefp?\s+([a-zA-Z_][a-zA-Z0-9_?!]*)/)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // Lua: function name( or local function name(
            if((m=line.match(/(?:local\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_.:]*)\s*\(/)))
                addFn({name:m[1].split(/[.:]/).pop(),file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});

            // VBA: Sub Name() or Function Name()
            if((m=line.match(/(?:Public|Private|Friend)?\s*(?:Sub|Function)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/i)))
                addFn({name:m[1],file:filename,line:lineNum,code:extractCode(lineNum),isTopLevel:true,type:'function'});
        });
    },
    extractJSFunctions:function(content,filename,offset,addFn,extractCode,isTS){
        if(!content||!content.trim())return;
        if(typeof acorn!=='undefined'){
            var parseContent=content;
            var parseSuccess=false;

            if(typeof Babel!=='undefined'){
                try{
                    var babelPresets=['react'];
                    if(isTS)babelPresets.push('typescript');
                    var babelResult=Babel.transform(parseContent,{
                        presets:babelPresets,
                        filename:filename||'file.js',
                        sourceType:'module',
                        retainLines:true
                    });
                    parseContent=babelResult.code;
                }catch(babelErr){
                    if(isTS){
                        parseContent=Parser.stripTypeScript(content);
                    }
                }
            }else if(isTS){
                parseContent=Parser.stripTypeScript(content);
            }

            try{
                var ast=acorn.parse(parseContent,{
                    ecmaVersion:2022,
                    sourceType:'module',
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    allowReturnOutsideFunction:true,
                    locations:true
                });
                parseSuccess=true;

                function walk(node,scope,parentIsExport){
                    if(!node||typeof node!=='object')return;
                    var isTopLevel=(scope===0);

                    if(node.type==='FunctionDeclaration'&&node.id&&node.id.name){
                        var line=(node.loc?node.loc.start.line:1)+offset;
                        var endLine=(node.loc?node.loc.end.line:line)+offset;
                        addFn({
                            name:node.id.name,
                            file:filename,
                            line:line,
                            code:extractCode(line,endLine),
                            isTopLevel:isTopLevel,
                            isExported:parentIsExport||false,
                            type:'function'
                        });
                    }

                    if(node.type==='VariableDeclaration'){
                        node.declarations.forEach(function(decl){
                            if(decl.id&&decl.id.type==='Identifier'&&decl.init){
                                var init=decl.init;
                                if(init.type==='FunctionExpression'||init.type==='ArrowFunctionExpression'){
                                    var line=(decl.loc?decl.loc.start.line:1)+offset;
                                    var endLine=(decl.loc?decl.loc.end.line:line)+offset;
                                    addFn({
                                        name:decl.id.name,
                                        file:filename,
                                        line:line,
                                        code:extractCode(line,endLine),
                                        isTopLevel:isTopLevel,
                                        isExported:parentIsExport||false,
                                        type:init.type==='ArrowFunctionExpression'?'arrow':'function'
                                    });
                                }
                            }
                        });
                    }

                    if(node.type==='MethodDefinition'&&node.key){
                        var methodName=node.key.name||(node.key.value!=null?String(node.key.value):null);
                        if(methodName&&methodName!=='constructor'){
                            var methodLine=(node.loc?node.loc.start.line:1)+offset;
                            var methodEndLine=(node.loc?node.loc.end.line:methodLine)+offset;
                            addFn({
                                name:methodName,
                                file:filename,
                                line:methodLine,
                                code:extractCode(methodLine,methodEndLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method',
                                isClassMethod:true,
                                isGetter:node.kind==='get',
                                isSetter:node.kind==='set'
                            });
                        }
                    }

                    if(node.type==='Property'&&node.method&&node.key){
                        var shorthandName=node.key.name||(node.key.value!=null?String(node.key.value):null);
                        if(shorthandName){
                            var shorthandLine=(node.loc?node.loc.start.line:1)+offset;
                            var shorthandEndLine=(node.loc?node.loc.end.line:shorthandLine)+offset;
                            addFn({
                                name:shorthandName,
                                file:filename,
                                line:shorthandLine,
                                code:extractCode(shorthandLine,shorthandEndLine),
                                isTopLevel:false,
                                isExported:false,
                                type:'method'
                            });
                        }
                    }

                    if(node.type==='Property'&&!node.method&&node.value&&node.key){
                        var val=node.value;
                        if(val.type==='FunctionExpression'||val.type==='ArrowFunctionExpression'){
                            var propName=node.key.name||(node.key.value!=null?String(node.key.value):null);
                            if(propName){
                                var propLine=(node.loc?node.loc.start.line:1)+offset;
                                var propEndLine=(node.loc?node.loc.end.line:propLine)+offset;
                                addFn({
                                    name:propName,
                                    file:filename,
                                    line:propLine,
                                    code:extractCode(propLine,propEndLine),
                                    isTopLevel:false,
                                    isExported:false,
                                    type:'method'
                                });
                            }
                        }
                    }

                    var nextIsExport=false;
                    if(node.type==='ExportNamedDeclaration'||node.type==='ExportDefaultDeclaration'){
                        nextIsExport=true;
                        if(node.declaration){
                            walk(node.declaration,scope,true);
                            return;
                        }
                    }

                    var newScope=scope;
                    if(node.type==='FunctionDeclaration'||node.type==='FunctionExpression'||
                       node.type==='ArrowFunctionExpression'||node.type==='ClassDeclaration'||
                       node.type==='ClassExpression'){
                        newScope=scope+1;
                    }

                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end'||key==='raw')continue;
                        var child=node[key];
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,newScope,nextIsExport);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,newScope,nextIsExport);
                        }
                    }
                }

                walk(ast,0,false);
            }catch(e){
                parseSuccess=false;
            }

            if(!parseSuccess){
                Parser.extractWithRegex(content,filename,offset,addFn,extractCode);
            }
            return;
        }

        Parser.extractWithRegex(content,filename,offset,addFn,extractCode);
    },
    findJSCalls:function(content,fnNames,defLines,options){
        fnNames=Parser.candidateFunctionNames(content,fnNames);
        var calls={};
        var refs={};
        if(!fnNames.length)return calls;
        fnNames.forEach(function(fn){calls[fn]=0;refs[fn]=0;});

        var sourceType=options&&options.sourceType==='script'?'script':'module';
        var isTS=!!(options&&options.isTS);

        if(typeof acorn!=='undefined'){
            try{
                var jsContent=content;
                if(typeof Babel!=='undefined'){
                    try{
                        var babelPresets=['react'];
                        if(isTS)babelPresets.push('typescript');
                        var babelResult=Babel.transform(content,{
                            presets:babelPresets,
                            filename:options&&options.filename?options.filename:'file.js',
                            sourceType:sourceType,
                            retainLines:true
                        });
                        jsContent=babelResult.code;
                    }catch(babelErr){
                        jsContent=isTS?Parser.stripTypeScript(content):content;
                    }
                }else if(isTS){
                    jsContent=Parser.stripTypeScript(content);
                }

                var ast=acorn.parse(jsContent,{
                    ecmaVersion:2022,
                    sourceType:sourceType,
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    allowReturnOutsideFunction:true,
                    locations:true,
                    tolerant:true
                });
                var fnSet=new Set(fnNames);

                function walk(node,inDeclaration){
                    if(!node||typeof node!=='object')return;
                    var isDecl=node.type==='FunctionDeclaration'||node.type==='VariableDeclarator';

                    if(node.type==='CallExpression'){
                        var callee=node.callee;
                        if(callee.type==='Identifier'&&fnSet.has(callee.name)){
                            var line=callee.loc?callee.loc.start.line:0;
                            if(!defLines[callee.name]||defLines[callee.name]!==line){
                                calls[callee.name]++;
                            }
                        }
                        node.arguments.forEach(function(arg){
                            if(arg.type==='Identifier'&&fnSet.has(arg.name)){
                                refs[arg.name]++;
                            }
                        });
                    }

                    if(node.type==='ArrayExpression'){
                        node.elements.forEach(function(el){
                            if(el&&el.type==='Identifier'&&fnSet.has(el.name)){
                                refs[el.name]++;
                            }
                        });
                    }
                    if(node.type==='Property'&&node.value&&node.value.type==='Identifier'&&fnSet.has(node.value.name)){
                        refs[node.value.name]++;
                    }

                    if(node.type==='Identifier'&&fnSet.has(node.name)&&!inDeclaration){
                        // Identifier references are handled via the surrounding parent nodes.
                    }

                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end')continue;
                        var child=node[key];
                        var nextInDecl=isDecl&&(key==='id'||key==='key');
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,nextInDecl);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,nextInDecl);
                        }
                    }
                }

                walk(ast,false);
                fnNames.forEach(function(fn){
                    calls[fn]=calls[fn]+(refs[fn]||0);
                });
                return calls;
            }catch(e){
                // Fall back to regex below.
            }
        }

        return Parser.countCandidateCalls(content,fnNames,{isJS:true});
    },

    buildFunctionNameIndex:function(fnNames){
        var exact=new Set();
        var byBase=Object.create(null);
        (fnNames||[]).forEach(function(fn){
            if(typeof fn!=='string'||!fn)return;
            exact.add(fn);
            if(fn.indexOf('.')>=0){
                var parts=fn.split('.');
                var base=parts[parts.length-1];
                if(!byBase[base])byBase[base]=[];
                byBase[base].push(fn);
            }
        });
        return{exact:exact,byBase:byBase};
    },

    buildFunctionDefLineIndex:function(fnDefs){
        var byFile=Object.create(null);
        (fnDefs||[]).forEach(function(fn){
            if(!byFile[fn.file])byFile[fn.file]=Object.create(null);
            byFile[fn.file][fn.name]=fn.line;
        });
        return byFile;
    },

    functionKey:functionKey,

    buildFunctionDefinitionIndex:function(fnDefs){
        var byName=Object.create(null);
        var byPascalName=Object.create(null);
        var byElixirMFA=Object.create(null);
        var byKey=Object.create(null);
        (fnDefs||[]).forEach(function(fn){
            if(!fn||typeof fn.name!=='string'||!fn.name)return;
            var key=Parser.functionKey(fn);
            fn.key=key;
            if(byKey[key])return;
            byKey[key]=fn;
            if(!byName[fn.name])byName[fn.name]=[];
            byName[fn.name].push(fn);
            if(fn.module&&fn.localName&&Array.isArray(fn.acceptedArities)){fn.acceptedArities.forEach(function(arity){var mfa=fn.module+'.'+fn.localName+'/'+arity;if(!byElixirMFA[mfa])byElixirMFA[mfa]=[];byElixirMFA[mfa].push(fn);});}
            if(Parser.isPascal(fn.file)){
                var pascalName=fn.name.toLowerCase();
                if(!byPascalName[pascalName])byPascalName[pascalName]=[];
                byPascalName[pascalName].push(fn);
            }
        });
        return{byName:byName,byPascalName:byPascalName,byElixirMFA:byElixirMFA,byKey:byKey};
    },

    buildCallGraphPathIndex:function(files){
        var pathMap=Object.create(null);
        (files||[]).forEach(function(file){
            var p=String(file.path||file.name||'').replace(/\\/g,'/').replace(/^\/+/,'');
            if(p)pathMap[p.toLowerCase()]=p;
        });
        return{pathMap:pathMap};
    },

    resolveCallGraphImportPath:function(importPath,fromFile,filesOrIndex){
        if(!importPath||/^(?:node:|https?:|data:|mailto:)/i.test(importPath))return null;
        var fromPath=String(fromFile||'').replace(/\\/g,'/').replace(/^\/+/,'');
        var fromDir=fromPath.indexOf('/')>=0?fromPath.split('/').slice(0,-1).join('/'):'';
        var fromExt=(fromPath.split('.').pop()||'').toLowerCase();
        var isPython=['py','pyw','pyi'].indexOf(fromExt)>=0;
        var isPascal=['pas','pp','dpr','dpk','lpr','inc'].indexOf(fromExt)>=0;
        var isRuby=['rb','rake'].indexOf(fromExt)>=0;
        var candidates=[];
        function normalizePath(path){
            var out=[];
            String(path||'').replace(/\\/g,'/').split('/').forEach(function(part){
                if(!part||part==='.')return;
                if(part==='..')out.pop();
                else out.push(part);
            });
            return out.join('/');
        }
        function addCandidate(path){
            path=normalizePath(path);
            if(path&&candidates.indexOf(path)<0)candidates.push(path);
        }

        if(importPath.startsWith('@/'))addCandidate('src/'+importPath.slice(2));
        else if(importPath.startsWith('~/'))addCandidate('src/'+importPath.slice(2));
        else if(importPath.startsWith('./')||importPath.startsWith('../'))addCandidate((fromDir?fromDir+'/':'')+importPath);
        else if(isPython&&/^\.+/.test(importPath)){
            var dotCount=(importPath.match(/^\.+/)||[''])[0].length;
            var rest=importPath.slice(dotCount).replace(/\./g,'/');
            var parts=fromDir?fromDir.split('/'):[];
            for(var di=1;di<dotCount;di++)parts.pop();
            addCandidate(parts.concat(rest?rest.split('/'):[]).join('/'));
        }else if(isPython){
            var modulePath=importPath.replace(/\./g,'/');
            addCandidate((fromDir?fromDir+'/':'')+modulePath);
            addCandidate(modulePath);
        }else if(isPascal){
            var unitPath=importPath.replace(/\./g,'/');
            addCandidate((fromDir?fromDir+'/':'')+unitPath);
            addCandidate(unitPath);
        }else if(isRuby){
            // Plain `require "ruby_llm/contract"` resolves from the gem load
            // path — for repos that is conventionally lib/ (or the repo root).
            addCandidate('lib/'+importPath);
            addCandidate(importPath);
        }else{
            return null;
        }

        var pathMap=filesOrIndex&&filesOrIndex.pathMap
            ?filesOrIndex.pathMap
            :Parser.buildCallGraphPathIndex(filesOrIndex).pathMap;
        var exts=['','.js','.jsx','.ts','.tsx','.mjs','.cjs','.vue','.svelte','.py','.pyw','.pyi','.rb','.vba','.bas','.cls','.pas','.pp','.inc','/index.js','/index.jsx','/index.ts','/index.tsx','/__init__.py'];
        for(var i=0;i<candidates.length;i++){
            for(var j=0;j<exts.length;j++){
                var candidate=normalizePath(candidates[i]+exts[j]).toLowerCase();
                if(pathMap[candidate])return pathMap[candidate];
            }
        }
        return null;
    },

    extractCallGraphImportMap:function(content,fromFile,filesOrIndex){
        var locals=Object.create(null);
        var targets=new Set();
        function addLocal(localName,resolved){
            if(!localName||!resolved)return;
            if(!locals[localName])locals[localName]=new Set();
            locals[localName].add(resolved);
            targets.add(resolved);
        }
        function addTarget(resolved){
            if(resolved)targets.add(resolved);
        }
        function parseImportNames(spec,resolved){
            (spec||'').split(',').forEach(function(part){
                part=part.trim().replace(/^type\s+/,'').trim();
                if(!part||part==='default')return;
                var alias=part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
                if(alias){addLocal(alias[2],resolved);return;}
                var destructured=part.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
                if(destructured){addLocal(destructured[2],resolved);return;}
                var name=part.match(/^([A-Za-z_$][\w$]*)$/);
                if(name)addLocal(name[1],resolved);
            });
        }
        function parseJsImportSpec(spec,resolved){
            spec=(spec||'').trim().replace(/^type\s+/,'').trim();
            if(!spec)return;
            var named=spec.match(/\{([\s\S]*?)\}/);
            if(named)parseImportNames(named[1],resolved);
            var ns=spec.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
            if(ns)addLocal(ns[1],resolved);
            var defaultPart=spec.split('{')[0].split('*')[0].split(',')[0].trim();
            if(/^[A-Za-z_$][\w$]*$/.test(defaultPart))addLocal(defaultPart,resolved);
        }

        var source=String(content||'');
        var match;
        var jsImportRe=/\bimport\s+(?!\()([\s\S]*?)\s+from\s*['"`]([^'"`]+)['"`]/g;
        while((match=jsImportRe.exec(source))!==null){
            var importSpec=match[1]||'';
            if(/^\s*type\b/.test(importSpec))continue;
            var resolved=Parser.resolveCallGraphImportPath(match[2],fromFile,filesOrIndex);
            addTarget(resolved);
            parseJsImportSpec(importSpec,resolved);
        }
        var cjsNamedRe=/\b(?:const|let|var)\s+\{([\s\S]*?)\}\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        while((match=cjsNamedRe.exec(source))!==null){
            var namedResolved=Parser.resolveCallGraphImportPath(match[2],fromFile,filesOrIndex);
            addTarget(namedResolved);
            parseImportNames(match[1],namedResolved);
        }
        var cjsDefaultRe=/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
        while((match=cjsDefaultRe.exec(source))!==null){
            var defaultResolved=Parser.resolveCallGraphImportPath(match[2],fromFile,filesOrIndex);
            addLocal(match[1],defaultResolved);
        }

        var pyFromRe=/^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm;
        while((match=pyFromRe.exec(source))!==null){
            var pyResolved=Parser.resolveCallGraphImportPath(match[1],fromFile,filesOrIndex);
            addTarget(pyResolved);
            parseImportNames(match[2].replace(/[()]/g,''),pyResolved);
        }
        var pyImportRe=/^\s*import\s+([^\n#]+)/gm;
        while((match=pyImportRe.exec(source))!==null){
            match[1].split(',').forEach(function(part){
                part=part.trim();
                var pieces=part.split(/\s+as\s+/);
                var moduleName=(pieces[0]||'').trim();
                var localName=(pieces[1]||moduleName.split('.').pop()||'').trim();
                var moduleResolved=Parser.resolveCallGraphImportPath(moduleName,fromFile,filesOrIndex);
                addLocal(localName,moduleResolved);
            });
        }

        if(/\.(rb|rake)$/i.test(String(fromFile||''))){
            var rubyReqRe=/^\s*require(_relative)?\s*\(?\s*['"]([^'"]+)['"]/gm;
            while((match=rubyReqRe.exec(source))!==null){
                // require_relative resolves against the requiring file's dir;
                // route it through the existing ./ handling.
                var rubyPath=match[1]?(/^\.\.?\//.test(match[2])?match[2]:'./'+match[2]):match[2];
                addTarget(Parser.resolveCallGraphImportPath(rubyPath,fromFile,filesOrIndex));
            }
        }

        if(Parser.isPascal(fromFile)){
            var pascalSource=Parser.stripPascalNonCode(source);
            var pascalUsesRe=/\buses\s+([\s\S]*?);/gi;
            while((match=pascalUsesRe.exec(pascalSource))!==null){
                match[1].split(',').forEach(function(part){
                    var unitMatch=part.trim().match(/^([A-Za-z_][A-Za-z0-9_.]*)/);
                    if(!unitMatch)return;
                    var unitResolved=Parser.resolveCallGraphImportPath(unitMatch[1],fromFile,filesOrIndex);
                    addTarget(unitResolved);
                    addLocal(unitMatch[1].toLowerCase(),unitResolved);
                });
            }
        }

        var localFiles=Object.create(null);
        Object.keys(locals).forEach(function(name){
            localFiles[name]=Array.from(locals[name]);
        });
        return{locals:localFiles,targets:targets};
    },

    candidateFunctionNames:function(content,fnNames,fnIndex,options){
        if(!content||!fnNames||!fnNames.length)return[];
        if(fnNames.length<=Parser._callCandidateThreshold)return fnNames;
        var caseInsensitive=!!(options&&options.caseInsensitive);
        var words=String(content).match(/\b[a-zA-Z_$][\w$]*\b/g)||[];
        var wordSet=new Set(caseInsensitive?words.map(function(word){return word.toLowerCase();}):words);
        if(!wordSet.size)return[];
        if(caseInsensitive){
            return fnNames.filter(function(fn){
                if(typeof fn!=='string')return false;
                var lower=fn.toLowerCase();
                var base=lower.indexOf('.')>=0?lower.split('.').pop():lower;
                return wordSet.has(lower)||wordSet.has(base);
            });
        }
        var index=fnIndex||Parser.buildFunctionNameIndex(fnNames);
        var out=[];
        var seen=new Set();
        wordSet.forEach(function(word){
            if(index.exact.has(word)&&!seen.has(word)){
                seen.add(word);
                out.push(word);
            }
            var baseMatches=index.byBase[word];
            if(baseMatches){
                baseMatches.forEach(function(fn){
                    if(!seen.has(fn)){
                        seen.add(fn);
                        out.push(fn);
                    }
                });
            }
        });
        // Ruby predicate/bang methods (foo?, foo!) tokenize without the suffix —
        // keep them as candidates when the bare word appears in the content.
        fnNames.forEach(function(fn){
            if(typeof fn!=='string'||seen.has(fn))return;
            if(/[?!]$/.test(fn)&&wordSet.has(fn.slice(0,-1))){
                seen.add(fn);
                out.push(fn);
            }
        });
        return out;
    },

    countCandidateCalls:function(content,fnNames,options){
        var calls=Object.create(null);
        var refs=Object.create(null);
        var source=String(content||'');
        var opts=options||{};
        var canonicalNamesByToken=Object.create(null);
        (fnNames||[]).forEach(function(fn){
            var token=opts.isPascal?fn.toLowerCase():fn;
            if(opts.isPascal){
                calls[token]=0;
                refs[token]=0;
                canonicalNamesByToken[token]=[token];
            }else{
                calls[fn]=0;
                refs[fn]=0;
                canonicalNamesByToken[token]=[fn];
            }
        });
        var candidateSet=new Set(Object.keys(canonicalNamesByToken));
        if(!source||!candidateSet.size)return calls;

        function pascalQualifierBefore(index){
            var cursor=index-1;
            while(cursor>=0&&/\s/.test(source[cursor]))cursor--;
            if(source[cursor]!=='.')return'';
            cursor--;
            var parts=[];
            while(cursor>=0){
                while(cursor>=0&&/\s/.test(source[cursor]))cursor--;
                var end=cursor+1;
                while(cursor>=0&&/[A-Za-z0-9_]/.test(source[cursor]))cursor--;
                var part=source.slice(cursor+1,end);
                if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))break;
                parts.unshift(part);
                while(cursor>=0&&/\s/.test(source[cursor]))cursor--;
                if(source[cursor]!=='.')break;
                cursor--;
            }
            return parts.length?parts.join('.').toLowerCase():'@member';
        }

        // Ruby method names may end in ? or ! (eval_defined?, load_evals!) —
        // the default \b token regex would strip the suffix and never match them.
        var tokenRe=opts.isRuby?/\b[a-zA-Z_][\w]*[?!]?/g:/\b[a-zA-Z_$][\w$]*\b/g;
        var match;
        while((match=tokenRe.exec(source))!==null){
            var tokenName=opts.isPascal?match[0].toLowerCase():match[0];
            if(!candidateSet.has(tokenName))continue;
            var matchedNames=canonicalNamesByToken[tokenName];
            var start=match.index;
            var end=start+match[0].length;
            var prev=start-1;
            while(prev>=0&&/\s/.test(source[prev]))prev--;
            var next=end;
            while(next<source.length&&/\s/.test(source[next]))next++;
            var nextChar=source[next]||'';
            var prevChar=prev>=0?source[prev]:'';
            var lineStart=source.lastIndexOf('\n',start-1)+1;
            var prefix=source.slice(lineStart,start);
            var pascalQualifier=opts.isPascal?pascalQualifierBefore(start):'';
            if(pascalQualifier){
                var qualifiedName=pascalQualifier+'.'+tokenName;
                if(calls[qualifiedName]===undefined){
                    calls[qualifiedName]=0;
                    refs[qualifiedName]=0;
                }
                matchedNames=[qualifiedName];
            }
            var isDefinition=false;
            if(/\b(function|class|def)\s*$/.test(prefix))isDefinition=true;
            if(opts.isRuby&&/\bdef\s+self\s*\.\s*$/.test(prefix))isDefinition=true;
            if(opts.isPython&&/\b(async\s+def|def|class)\s*$/.test(prefix))isDefinition=true;
            if(opts.isVBA&&/\b(Sub|Function)\s+$/i.test(prefix))isDefinition=true;
            if(opts.isPascal){
                var declarationContext=source.slice(Math.max(0,start-512),start);
                if(/\b(?:procedure|function|constructor|destructor|operator)\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)*$/i.test(declarationContext))isDefinition=true;
            }
            if(nextChar==='('&&!isDefinition){
                matchedNames.forEach(function(name){calls[name]++;});
            }else if(opts.isRuby&&prevChar==='.'&&!isDefinition){
                // Ruby method calls need no parens: RubyLLM::Contract.eval_hosts,
                // host.run_eval — a dotted receiver means invocation, not access.
                matchedNames.forEach(function(name){calls[name]++;});
            }else if(opts.isPascal&&nextChar===';'&&!isDefinition&&(pascalQualifier||/^(?:[A-Za-z_]\w*\.)*\s*$/.test(prefix.trim()))){
                matchedNames.forEach(function(name){calls[name]++;});
            }else if(!isDefinition&&'[,[:(={'.indexOf(prevChar)>=0&&' ,])};\n\r'.indexOf(nextChar)>=0){
                matchedNames.forEach(function(name){refs[name]++;});
            }else if(opts.isPython&&prevChar==='@'&&!isDefinition){
                matchedNames.forEach(function(name){refs[name]++;});
            }else if(opts.isRuby&&!isDefinition){
                // In Ruby a bare identifier that is not a local variable IS a
                // method call (implicit receiver: `build_table.each`, `run_serial`).
                // Mirror the Python tree-sitter policy: any non-definition
                // occurrence of a known method name counts as a usage.
                matchedNames.forEach(function(name){refs[name]++;});
            }
        }

        if(opts.isJS&&source.indexOf('<')>=0){
            var jsxTagRe=/<\/?\s*([A-Za-z_$][\w$]*)[\s>\/{]/g;
            while((match=jsxTagRe.exec(source))!==null){
                if(candidateSet.has(match[1]))refs[match[1]]++;
            }
            var jsxExprRe=/[{=]\s*([A-Za-z_$][\w$]*)\s*[}(,;\s]/g;
            while((match=jsxExprRe.exec(source))!==null){
                if(candidateSet.has(match[1]))refs[match[1]]++;
            }
        }

        if(opts.isPython){
            var importRe=/^(?:from\s+\S+\s+import\s+(?:\([^)]+\)|[^\n]+)|import\s+[^\n]+)$/gm;
            while((match=importRe.exec(source))!==null){
                var importWords=match[0].match(/\b[a-zA-Z_]\w*\b/g)||[];
                importWords.forEach(function(word){if(candidateSet.has(word))refs[word]++;});
            }
        }

        if(opts.isVBA){
            var vbaRunRe=/Application\.Run\s*["']([A-Za-z_]\w*)["']/gi;
            while((match=vbaRunRe.exec(source))!==null){
                if(candidateSet.has(match[1]))calls[match[1]]++;
            }
        }

        Object.keys(calls).forEach(function(fn){
            calls[fn]=Math.max(0,calls[fn]||0)+(refs[fn]||0);
        });
        return calls;
    },

    // AST-based call detection - finds actual function calls and references
    findCalls:function(content,fnNames,definingFile,fnDefs,fnIndex){
        var pascalFile=Parser.isPascal(definingFile);
        fnNames=Parser.candidateFunctionNames(content,fnNames,fnIndex,{caseInsensitive:pascalFile});
        var calls={};
        var refs={};  // Functions used as callbacks/references without ()
        if(!fnNames.length)return calls;
        fnNames.forEach(function(fn){calls[fn]=0;refs[fn]=0;});

        // Build a set of definition lines to exclude
        var defLines={};
        if(fnDefs&&!Array.isArray(fnDefs)){
            defLines=fnDefs[definingFile]||{};
        }else if(fnDefs){
            fnDefs.forEach(function(fn){
                if(fn.file===definingFile){
                    defLines[fn.name]=fn.line;
                }
            });
        }

        if(Parser.isScriptContainer(definingFile)){
            var blocks=Parser.getEmbeddedCodeBlocks(content,definingFile,{includeHandlers:true});
            if(!blocks.length)return calls;
            blocks.forEach(function(block){
                var blockCalls=Parser.findJSCalls(block.content,fnNames,defLines,{
                    filename:definingFile,
                    isTS:block.isTS,
                    sourceType:block.kind==='handler'?'script':block.sourceType
                });
                fnNames.forEach(function(fn){
                    calls[fn]+=blockCalls[fn]||0;
                });
            });
            return calls;
        }

        // Detect file language from defining file extension
        var ext=definingFile?definingFile.split('.').pop().toLowerCase():'';
        var isPython=['py','pyw','pyi'].indexOf(ext)>=0;
        var isJS=['js','jsx','ts','tsx','mjs','cjs','vue','svelte'].indexOf(ext)>=0;
        var isVBA=['vba','bas','cls','xlsm','xlam'].indexOf(ext)>=0;
        var isPascal=pascalFile;

        // Python: use tree-sitter real parser (WASM) for accurate AST-based detection
        if(isPython){
            var tsParser=Parser.getLoadedTreeSitterParser(definingFile);
            if(tsParser){
                try{
                    var tree=tsParser.parse(content);
                    var root=tree.rootNode;
                    var fnSet=new Set(fnNames);

                    // Determine if an identifier node is a definition name (not a usage)
                    function isPyDefName(node){
                        var p=node.parent;
                        if(!p)return false;
                        // Function/class definition name: def foo / class Foo
                        if((p.type==='function_definition'||p.type==='class_definition')&&
                            p.childForFieldName('name')===node)return true;
                        // Parameter names in function signatures
                        if(p.type==='parameters'||p.type==='lambda_parameters')return true;
                        if((p.type==='typed_parameter'||p.type==='default_parameter'||
                            p.type==='typed_default_parameter')&&p.children[0]===node)return true;
                        if(p.type==='list_splat_pattern'||p.type==='dictionary_splat_pattern')return true;
                        // For loop target: for x in ...
                        if(p.type==='for_statement'&&p.childForFieldName('left')===node)return true;
                        // With statement target: with x as y
                        if(p.type==='as_pattern'&&p.childForFieldName('alias')===node)return true;
                        // Exception handler: except E as e
                        if(p.type==='except_clause')return false; // the exception type IS a reference
                        // Comprehension targets: [x for x in ...]
                        if(p.type==='for_in_clause'&&p.childForFieldName('left')===node)return true;
                        return false;
                    }

                    // Walk the CST: every identifier that matches a function name
                    // and is NOT a definition is counted as a usage reference.
                    // tree-sitter naturally excludes identifiers inside strings/comments
                    // because those are parsed as string/comment nodes, not identifiers.
                    function walkPy(node){
                        if(node.type==='identifier'&&fnSet.has(node.text)&&!isPyDefName(node)){
                            calls[node.text]++;
                        }
                        for(var i=0;i<node.childCount;i++){
                            walkPy(node.child(i));
                        }
                    }
                    walkPy(root);
                    tree.delete();
                    return calls;
                }catch(tsErr){
                    // tree-sitter parse failed, fall through to tokenizer fallback
                }
            }

            // Fallback: token-level analysis with string/comment stripping
            var cleanContent=Parser.stripPythonNonCode(content);
            return Parser.countCandidateCalls(cleanContent,fnNames,{isPython:true});
        }

        if(isPascal){
            var cleanPascal=Parser.stripPascalNonCode(content);
            return Parser.countCandidateCalls(cleanPascal,fnNames,{isPascal:true});
        }

        if(ext==='rb'||ext==='rake'){
            // Strip # comments (but not #{...} interpolation) so commented-out
            // code does not count as a call site.
            var cleanRuby=content.replace(/#(?!\{)[^\n]*/g,'');
            return Parser.countCandidateCalls(cleanRuby,fnNames,{isRuby:true});
        }

        if(isJS&&typeof acorn!=='undefined'){
            try{
                // Use Babel (real parser) to handle JSX and TypeScript
                // Babel transforms JSX → React.createElement calls and strips TS types,
                // so acorn can parse the result into a proper AST for accurate call detection
                var jsContent=content;
                if(typeof Babel!=='undefined'){
                    try{
                        var babelPresets=['react'];
                        if(ext==='ts'||ext==='tsx')babelPresets.push('typescript');
                        var babelResult=Babel.transform(content,{
                            presets:babelPresets,
                            filename:definingFile||'file.js',
                            sourceType:'module',
                            retainLines:true
                        });
                        jsContent=babelResult.code;
                    }catch(babelErr){
                        // Babel failed, fall back to manual TypeScript stripping
                        jsContent=content
                            .replace(/:\s*[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[=,\)\}\];])/g,'')
                            .replace(/\bas\s+[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[,\)\}\];])/g,'')
                            .replace(/<[A-Za-z_$][\w$<>,\s|&\[\]]*>(?=\s*\()/g,'')
                            .replace(/^import\s+type\s+.*/gm,'')
                            .replace(/^export\s+type\s+.*/gm,'')
                            .replace(/^export\s+interface\s+.*/gm,'')
                            .replace(/interface\s+[A-Za-z_$][\w$]*\s*\{[^}]*\}/g,'')
                            .replace(/type\s+[A-Za-z_$][\w$]*\s*=\s*[^;]+;/g,'');
                    }
                }else{
                    jsContent=content
                        .replace(/:\s*[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[=,\)\}\];])/g,'')
                        .replace(/\bas\s+[A-Za-z_$][\w$<>,\s|&\[\]]*(?=\s*[,\)\}\];])/g,'')
                        .replace(/<[A-Za-z_$][\w$<>,\s|&\[\]]*>(?=\s*\()/g,'')
                        .replace(/^import\s+type\s+.*/gm,'')
                        .replace(/^export\s+type\s+.*/gm,'')
                        .replace(/^export\s+interface\s+.*/gm,'')
                        .replace(/interface\s+[A-Za-z_$][\w$]*\s*\{[^}]*\}/g,'')
                        .replace(/type\s+[A-Za-z_$][\w$]*\s*=\s*[^;]+;/g,'');
                }

                var ast=acorn.parse(jsContent,{
                    ecmaVersion:2022,
                    sourceType:'module',
                    allowHashBang:true,
                    allowAwaitOutsideFunction:true,
                    allowImportExportEverywhere:true,
                    locations:true,
                    tolerant:true
                });

                var fnSet=new Set(fnNames);

                function walk(node,inDeclaration){
                    if(!node||typeof node!=='object')return;

                    // Track if we're in a function declaration to skip counting the name
                    var isDecl=node.type==='FunctionDeclaration'||node.type==='VariableDeclarator';

                    // CallExpression: foo() or foo.bar()
                    if(node.type==='CallExpression'){
                        var callee=node.callee;
                        if(callee.type==='Identifier'&&fnSet.has(callee.name)){
                            var line=callee.loc?callee.loc.start.line:0;
                            // Don't count if this is the definition line
                            if(!defLines[callee.name]||defLines[callee.name]!==line){
                                calls[callee.name]++;
                            }
                        }
                        // Also check arguments for function references
                        node.arguments.forEach(function(arg){
                            if(arg.type==='Identifier'&&fnSet.has(arg.name)){
                                refs[arg.name]++;
                            }
                        });
                    }

                    // Function passed as reference (callback): arr.map(fn), addEventListener('click', fn)
                    if(node.type==='Identifier'&&fnSet.has(node.name)&&!inDeclaration){
                        // This is handled via parent context - check if parent is not a CallExpression callee
                        // refs tracking happens in CallExpression arguments above
                    }

                    // Array element or object property value containing function ref
                    if(node.type==='ArrayExpression'){
                        node.elements.forEach(function(el){
                            if(el&&el.type==='Identifier'&&fnSet.has(el.name)){
                                refs[el.name]++;
                            }
                        });
                    }
                    if(node.type==='Property'&&node.value&&node.value.type==='Identifier'&&fnSet.has(node.value.name)){
                        refs[node.value.name]++;
                    }

                    // Recurse
                    for(var key in node){
                        if(key==='loc'||key==='range'||key==='start'||key==='end')continue;
                        var child=node[key];
                        var nextInDecl=isDecl&&(key==='id'||key==='key');
                        if(Array.isArray(child)){
                            child.forEach(function(c){walk(c,nextInDecl);});
                        }else if(child&&typeof child==='object'&&child.type){
                            walk(child,nextInDecl);
                        }
                    }
                }

                walk(ast,false);

                // Combine calls and refs
                fnNames.forEach(function(fn){
                    calls[fn]=calls[fn]+(refs[fn]||0);
                });

                return calls;

            }catch(e){
                // Fall back to regex but be more careful
            }
        }

        // Fallback: regex-based but more careful
        return Parser.countCandidateCalls(content,fnNames,{isJS:isJS,isVBA:isVBA});
    }
};
return Parser;
}
