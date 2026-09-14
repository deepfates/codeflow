import runtimeWasm from '../../vendor/tree-sitter/tree-sitter.wasm';
import elixirWasm from '../../vendor/tree-sitter-wasms/tree-sitter-elixir.wasm';
import pythonWasm from '../../vendor/tree-sitter-wasms/tree-sitter-python.wasm';

// Inline the grammars we actually use so opening index.html from disk retains
// the same source evidence as HTTP and Node (file:// fetch is unavailable).
export function browserSyntaxRuntime({TreeSitter,acorn,Babel}){
    return {TreeSitter,acorn,Babel,runtimeWasm,loadGrammar(grammar){
        if(grammar==='elixir')return elixirWasm;
        if(grammar==='python')return pythonWasm;
        throw new Error('No analysis grammar configured for '+grammar);
    }};
}
