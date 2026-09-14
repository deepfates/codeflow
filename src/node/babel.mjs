import {transformSync} from '@babel/core';
import react from '@babel/preset-react';
import typescript from '@babel/preset-typescript';
import transformReactJsx from '@babel/plugin-transform-react-jsx';

const presets={react,typescript};
const plugins={'transform-react-jsx':transformReactJsx};
function resolve(table,name){
    if(!table[name])throw new Error('Unsupported source-analysis Babel transform: '+name);
    return table[name];
}

// Node uses Babel's Node API. Standalone initializes browser globals, including
// Node 26's localStorage getter. Consumer Babel config is never executable input.
export const Babel={transform(source,options={}){
    return transformSync(source,{...options,
        configFile:false,babelrc:false,
        presets:(options.presets||[]).map(name=>resolve(presets,name)),
        plugins:(options.plugins||[]).map(name=>resolve(plugins,name))});
}};
