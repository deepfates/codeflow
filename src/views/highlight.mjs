export function highlightSyntax(code,filename){
        if(!code)return[''];
        var ext=(filename||'').split('.').pop().toLowerCase();
        var isJS=['js','jsx','ts','tsx','mjs','cjs'].includes(ext);
        var isPy=['py','pyw','pyi'].indexOf(ext)>=0;
        var isJava=['java','kt','scala','cs','go'].includes(ext);
        var isHTML=['html','htm','vue','svelte'].includes(ext);
        var isCSS=['css','scss','sass','less'].includes(ext);
        var isJSON=['json','yaml','yml','toml'].includes(ext);
        var isRuby=['rb','rake'].includes(ext);
        var isPHP=ext==='php';
        var isVBA=['vba','bas','cls','xlsm','xlam','xlsb','xla','xlw'].includes(ext);
        function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
        // Later rules must only inspect source text, never the span attributes
        // emitted by earlier rules (for example the JavaScript keyword class).
        function highlight(text,pattern,replacement){
            return text.split(/(<[^>]*>)/g).map(function(part,i){
                return i%2?part:part.replace(pattern,replacement);
            }).join('');
        }
        // Split into tokens while preserving structure
        var result=code.split('\n').map(function(line){
            var escaped=esc(line);
            // Comments
            if(isJS||isJava||isPHP||isCSS)escaped=highlight(escaped,/(\/\/.*$)/gm,'<span class="syn-com">$1</span>');
            if(isPy||isRuby)escaped=highlight(escaped,/(#.*$)/gm,'<span class="syn-com">$1</span>');
            if(isHTML)escaped=highlight(escaped,/(&lt;!--[\s\S]*?--&gt;)/g,'<span class="syn-com">$1</span>');
            // Strings - careful with order
            escaped=highlight(escaped,/(&quot;[^&]*&quot;|'[^']*'|`[^`]*`)/g,'<span class="syn-str">$1</span>');
            // Numbers
            escaped=highlight(escaped,/\b(\d+\.?\d*)\b/g,'<span class="syn-num">$1</span>');
            // Keywords
            if(isJS)escaped=highlight(escaped,/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|class|extends|import|export|from|default|async|await|yield|typeof|instanceof|in|of|this|super|null|undefined|true|false|void|static|get|set)\b/g,'<span class="syn-kw">$1</span>');
            if(isPy){
                escaped=highlight(escaped,/\b(async|await|def|class|return|if|elif|else|for|while|try|except|finally|raise|import|from|as|with|pass|break|continue|lambda|yield|global|nonlocal|assert|True|False|None|and|or|not|in|is|del|match|case|type)\b/g,'<span class="syn-kw">$1</span>');
                escaped=highlight(escaped,/(@\w+)/g,'<span class="syn-fn">$1</span>');
                escaped=highlight(escaped,/\b(self|cls)\b/g,'<span class="syn-kw" style="opacity:0.7">$1</span>');
            }
            if(isJava)escaped=highlight(escaped,/\b(public|private|protected|static|final|void|class|interface|extends|implements|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|new|import|package|this|super|null|true|false)\b/g,'<span class="syn-kw">$1</span>');
            if(isRuby)escaped=highlight(escaped,/\b(def|class|module|end|return|if|elsif|else|unless|case|when|for|while|until|do|begin|rescue|ensure|raise|require|include|extend|attr_accessor|attr_reader|attr_writer|true|false|nil|self)\b/g,'<span class="syn-kw">$1</span>');
            if(isPHP)escaped=highlight(escaped,/\b(function|class|return|if|else|elseif|for|foreach|while|do|switch|case|break|continue|try|catch|finally|throw|new|public|private|protected|static|const|use|namespace|extends|implements|true|false|null)\b/g,'<span class="syn-kw">$1</span>');
            if(isVBA)escaped=highlight(escaped,/\b(Public|Private|Friend|Static|Dim|Set|Let|Get|Call|Function|Sub|End Sub|End Function|Exit Sub|Exit Function|If|Then|Else|ElseIf|End If|For|To|Step|Next|Do|Loop|While|Wend|Select|Case|End Select|With|End With|On Error|Resume|GoTo|ByVal|ByRef|Optional|ParamArray|As|Type|Enum|Const|True|False|Nothing|Empty|Null|Me|Application|ThisWorkbook|Worksheets|Cells|Range|MsgBox|InputBox|Debug\.Print)\b/gi,'<span class="syn-kw">$1</span>');
            if(isCSS)escaped=highlight(escaped,/(@media|@import|@keyframes|@font-face|!important)/g,'<span class="syn-kw">$1</span>');
            if(isHTML){escaped=highlight(escaped,/(&lt;\/?)([\w-]+)/g,'$1<span class="syn-tag">$2</span>');escaped=highlight(escaped,/([\w-]+)(=)/g,'<span class="syn-attr">$1</span>$2');}
            // Function calls
            escaped=highlight(escaped,/\b([a-zA-Z_]\w*)(\s*)\(/g,'<span class="syn-fn">$1</span>$2(');
            // Types (capitalized words in certain contexts)
            if(isJS||isJava)escaped=highlight(escaped,/(:\s*)([A-Z]\w*)/g,'$1<span class="syn-type">$2</span>');
            return escaped;
        });
        return result;
    }
