import { snapshotZoomTransform } from '../views/camera.mjs';

export function restoreWorkspace(saved,data){
    if(!saved||saved.version!==1)return null;
    var paths=new Set(data.files.map(function(f){return f.path;}));
    var result={version:1,scope:typeof saved.scope==='string'&&data.files.some(function(f){return f.path.startsWith(saved.scope+'/');})?saved.scope:null,
        selected:paths.has(saved.selected)?saved.selected:null,opened:(Array.isArray(saved.opened)?saved.opened:[]).filter(function(p){return paths.has(p);}),
        view:['graph','code','graph3d','treemap','matrix','dendro','sankey','disjoint','bundle','architecture'].includes(saved.view)?saved.view:'graph',architectureBlockId:(data.architectureDiagram&&data.architectureDiagram.blocks||[]).some(function(block){return block.id===saved.architectureBlockId;})?saved.architectureBlockId:null,placements:{},sizes:{},pinned:[],camera:snapshotZoomTransform(saved.camera)};
    Object.keys(saved.placements||{}).forEach(function(path){var p=saved.placements[path];if(paths.has(path)&&p&&Number.isFinite(p.x)&&Number.isFinite(p.y))result.placements[path]=p;});
    Object.keys(saved.sizes||{}).forEach(function(path){var size=saved.sizes[path];if(paths.has(path)&&size&&typeof size==='object')result.sizes[path]=size;});
    result.pinned=(Array.isArray(saved.pinned)?saved.pinned:[]).filter(function(path){return paths.has(path);});
    if(saved.navigation&&Array.isArray(saved.navigation.entries)){
        var before=saved.navigation.entries.slice(0,saved.navigation.index+1).filter(function(entry){return paths.has(entry.path);});
        var after=saved.navigation.entries.slice(saved.navigation.index+1).filter(function(entry){return paths.has(entry.path);});
        result.navigation={entries:before.concat(after),index:before.length-1};
    }
    return result;
}
