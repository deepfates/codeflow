import {folderFilterAfterCodeNav,hiddenOpenedCodePaths,resolveOpenCodeCard} from './navigation.mjs';

// Explicit source navigation preserves the investigation and reveals its scope.
export function openSourceInvestigation(state,data,{path,replace=false,range}){
    const folderFilter=folderFilterAfterCodeNav(path,data,state.folderFilter);
    const hidden=hiddenOpenedCodePaths(state.openedCodePaths,data,folderFilter);
    const resolved=resolveOpenCodeCard(state.openedCodePaths,path,Infinity,!!replace,hidden);
    if(!resolved.opened)return null;
    return {...state,folderFilter,openedCodePaths:resolved.paths,
        location:{view:'code',scope:folderFilter,range}};
}
