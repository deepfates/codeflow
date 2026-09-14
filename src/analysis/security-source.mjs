export function getSecurityScanContent(file){
    return file&&file.content?file.content:'';
}

export function isSanitizedPreviewRenderer(content){
    return content.includes("function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}") &&
           content.includes("var escaped=esc(line);") &&
           content.includes("dangerouslySetInnerHTML:{__html:lineHtml||' '}");
}

// Keep literal-bearing source for credentials and SQL, while executable checks
// inspect syntax nodes. Comments and detector strings are never executable calls.
export function inspectJavaScriptSecurity(content,filename,{acorn,Babel,blocks}={}){
    if(!/\.(?:[cm]?js|jsx|tsx?|html?|xhtml|vue|svelte)$/i.test(filename||''))return null;
    if(!acorn)return null;
    var chunks=blocks||[{content:content,offset:0}];
    var facts={evalLines:[],functionLines:[],commandLines:[],consoleLines:[],xss:false,sql:false,todos:0};
    function property(node){return node&&node.type==='Identifier'?node.name:node&&node.type==='Literal'?node.value:null;}
    function calleeName(node){
        if(!node)return null;
        if(node.type==='ChainExpression')return calleeName(node.expression);
        if(node.type==='Identifier')return node.name;
        if(node.type==='SequenceExpression')return calleeName(node.expressions[node.expressions.length-1]);
        if(node.type==='MemberExpression'&&node.object.type==='Identifier'&&['window','globalThis','global'].includes(node.object.name))return property(node.property);
        return null;
    }
    function staticString(node){return node&&(node.type==='Literal'&&typeof node.value==='string'||node.type==='TemplateLiteral'&&node.expressions.length===0);}
    for(var chunk of chunks){
        var comments=[],ast;
        var options={ecmaVersion:'latest',sourceType:'module',locations:true,allowReturnOutsideFunction:true,onComment:comments};
        try{ast=acorn.parse(chunk.content,options);}
        catch(error){
            if(!Babel)return null;
            try{
                var transformed=Babel.transform(chunk.content,{filename:filename,presets:/\.[cm]?tsx?$/i.test(filename)?['typescript']:[],plugins:['transform-react-jsx'],retainLines:true,comments:true,sourceType:'unambiguous'});
                comments=[];ast=acorn.parse(transformed.code,Object.assign({},options,{onComment:comments}));
            }catch(transformError){return null;}
        }
        facts.todos+=comments.reduce(function(n,comment){return n+(comment.value.match(/TODO|FIXME|HACK|XXX/g)||[]).length;},0);
        function line(node){return node.loc.start.line+(chunk.offset||0);}
        function visit(node){
            if(!node||typeof node.type!=='string')return;
            if(node.type==='CallExpression'||node.type==='NewExpression'){
                var callee=node.callee,name=calleeName(callee);
                if(name==='eval')facts.evalLines.push(line(node));
                if(name==='Function')facts.functionLines.push(line(node));
                if(callee.type==='MemberExpression'){
                    var member=property(callee.property),receiver=callee.object;
                    if(receiver.type==='Identifier'&&receiver.name==='console'&&['log','debug','info'].includes(member))facts.consoleLines.push(line(node));
                    if(receiver.type==='Identifier'&&['cp','child_process'].includes(receiver.name)&&/exec/i.test(member||''))facts.commandLines.push(line(node));
                }
                if(name==='require'&&node.arguments[0]&&['child_process','node:child_process'].includes(node.arguments[0].value))facts.commandLines.push(line(node));
                var method=callee.type==='MemberExpression'?property(callee.property):name;
                if(['query','execute','raw'].includes(method))node.arguments.forEach(function(arg){
                    if(arg.type==='BinaryExpression'&&arg.operator==='+')facts.sql=true;
                    if(arg.type==='TemplateLiteral'&&arg.expressions.length&&arg.quasis.some(function(q){return /SELECT|INSERT|UPDATE|DELETE/i.test(q.value.raw);}))facts.sql=true;
                });
            }
            if(node.type==='ImportDeclaration'&&['child_process','node:child_process'].includes(node.source.value))facts.commandLines.push(line(node));
            if(node.type==='ImportExpression'&&node.source&&['child_process','node:child_process'].includes(node.source.value))facts.commandLines.push(line(node));
            if(node.type==='AssignmentExpression'&&node.left.type==='MemberExpression'&&property(node.left.property)==='innerHTML')facts.xss=true;
            if(node.type==='Property'&&property(node.key)==='dangerouslySetInnerHTML'){
                var html=node.value.type==='ObjectExpression'&&node.value.properties.find(function(prop){return prop.type==='Property'&&property(prop.key)==='__html';});
                if(!html||!staticString(html.value))facts.xss=true;
            }
            Object.keys(node).forEach(function(key){var value=node[key];if(Array.isArray(value))value.forEach(function(child){if(child&&typeof child.type==='string')visit(child);});else if(value&&typeof value.type==='string')visit(value);});
        }
        visit(ast);
    }
    return facts;
}
