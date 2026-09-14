import babelRuntime from '../../dist/node-babel.cjs';
const {Babel}=babelRuntime;
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createParser} from '../analysis/parser.mjs';
import {createProjectAnalyzer} from '../analysis/project.mjs';
import {calcBlast,calcHealth} from '../analysis/metrics.mjs';

const require=createRequire(import.meta.url);
const vendor=new URL('../../vendor/',import.meta.url);
// web-tree-sitter's Emscripten init replaces its CommonJS module.exports.
// Capture the public constructor once, before initialization, so subsequent
// investigations share the runtime instead of receiving its internal Module.
const TreeSitter=require('../../vendor/tree-sitter/tree-sitter.js');

// The package supplies executable tooling. A consumer repository supplies data only.
export function createNodeAnalyzer(){
    const Parser=createParser({
        acorn:require('../../vendor/acorn/acorn.min.js'),
        Babel,
        TreeSitter,
        vendorBase:fileURLToPath(vendor),
        runtimeWasm:readFileSync(new URL('tree-sitter/tree-sitter.wasm',vendor)),
        loadGrammar:grammar=>readFileSync(new URL('tree-sitter-wasms/tree-sitter-'+grammar+'.wasm',vendor))
    });
    return {Parser,...createProjectAnalyzer(Parser),calcBlast,calcHealth};
}
