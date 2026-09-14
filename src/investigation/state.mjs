import {recordNavigation,stepNavigation,folderFilterAfterCodeNav,openCodeCardPaths,hiddenOpenedCodePaths,ensureCodeViewOpenedPaths} from './navigation.mjs';

export function createInvestigationState(){
    return {selectedPath:null,scope:null,view:'graph',openedPaths:[],range:null,navigation:{entries:[],index:-1}};
}

function hasPath(data,path){return !!path&&(data?.files||[]).some(file=>file.path===path);}
function select(state,action,data){
    if(action.path===null)return {...state,selectedPath:null,range:null};
    if(!hasPath(data,action.path))return state;
    const scope=Object.hasOwn(action,'scope')?action.scope:state.scope;
    const view=action.view??state.view;
    const range=action.range??null;
    const location={path:action.path,scope,view,range,camera:null};
    return {...state,selectedPath:action.path,scope,view,range,
        navigation:action.record===false?state.navigation:recordNavigation(state.navigation,location,action.camera)};
}

// Navigation decisions commit together; renderer positions and DOM effects stay
// with the renderer. Only explicit view entry may seed an empty Code canvas.
export function reduceInvestigation(state,action,data){
    switch(action.type){
        case 'reset':return {...createInvestigationState(),view:action.view??'graph'};
        case 'select':return select(state,action,data);
        case 'open':{
            if(!hasPath(data,action.path))return state;
            const scope=folderFilterAfterCodeNav(action.path,data,state.scope);
            const openedPaths=openCodeCardPaths(state.openedPaths,action.path,Infinity,!!action.replace,hiddenOpenedCodePaths(state.openedPaths,data,scope));
            return select({...state,openedPaths},{...action,scope,view:'code'},data);
        }
        case 'close':{
            if(!state.openedPaths.includes(action.path))return state;
            const openedPaths=state.openedPaths.filter(path=>path!==action.path);
            const next={...state,openedPaths};
            if(state.selectedPath!==action.path)return next;
            const path=openedPaths.filter(path=>hasPath(data,path)).at(-1);
            if(!path)return select(next,{path:null},data);
            return select(next,{path,scope:folderFilterAfterCodeNav(path,data,state.scope),camera:action.camera},data);
        }
        case 'view':{
            const next={...state,view:action.view};
            if(!action.enter)return next;
            if(action.view==='architecture')return select(next,{path:null},data);
            if(action.view!=='code')return next;
            const entry=ensureCodeViewOpenedPaths(state.openedPaths,state.selectedPath,data,state.scope);
            return entry.opened?select({...next,openedPaths:entry.paths},{path:entry.seed,camera:action.camera},data):next;
        }
        case 'scope':return {...state,scope:action.scope};
        case 'history':{
            const navigation=stepNavigation(state.navigation,action.delta,action.camera);
            if(!navigation)return state;
            const location=navigation.entries[navigation.index];
            if(!hasPath(data,location.path))return state;
            const openedPaths=location.view==='code'?openCodeCardPaths(state.openedPaths,location.path,Infinity,false,hiddenOpenedCodePaths(state.openedPaths,data,location.scope)):state.openedPaths;
            return select({...state,navigation,openedPaths},{...location,record:false},data);
        }
        case 'restore':{
            const workspace=action.workspace;
            if(!workspace)return state;
            const navigation=workspace.navigation||{entries:[],index:-1};
            const location=navigation.entries[navigation.index];
            return {...state,selectedPath:workspace.selected??null,scope:workspace.scope??null,view:workspace.view,
                openedPaths:workspace.opened.slice(),navigation,
                range:location?.path===workspace.selected?location.range??null:null};
        }
        default:return state;
    }
}
