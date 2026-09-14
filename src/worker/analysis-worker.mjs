import acorn from '../../vendor/acorn/acorn.min.js';
import Babel from '../../vendor/babel/babel.min.js';
import TreeSitter from '../../vendor/tree-sitter/tree-sitter.js';
import {browserSyntaxRuntime} from '../browser/syntax-runtime.mjs';
import {createParser} from '../analysis/parser.mjs';
import {createProjectAnalyzer} from '../analysis/project.mjs';

const Parser=createParser(browserSyntaxRuntime({TreeSitter,acorn,Babel}));
const {buildAnalysisData}=createProjectAnalyzer(Parser);
self.onmessage=async function(event){
    const payload=event.data||{};
    try{
        const data=await buildAnalysisData({
            analyzed:payload.analyzed||[],allFns:payload.allFns||[],excludePatterns:payload.excludePatterns||[],
            progress:message=>self.postMessage({type:'progress',message})
        });
        self.postMessage({type:'done',data});
    }catch(error){
        self.postMessage({type:'error',message:error?.message||String(error)});
    }
};
