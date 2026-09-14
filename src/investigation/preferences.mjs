
export var UI_PREFS_STORAGE_KEY='codeflow-ui-prefs';

export var LINE_THICKNESS_MIN=1;

export var LINE_THICKNESS_MAX=6;

export var LINE_THICKNESS_DEFAULT=1;

export function clampLineThickness(value){
    var n=Number(value);
    if(!isFinite(n))return LINE_THICKNESS_DEFAULT;
    n=Math.round(n);
    if(n<LINE_THICKNESS_MIN)return LINE_THICKNESS_MIN;
    if(n>LINE_THICKNESS_MAX)return LINE_THICKNESS_MAX;
    return n;
}

export function defaultUiPrefs(){
    return{lineThickness:LINE_THICKNESS_DEFAULT};
}

export function normalizeUiPrefs(prefs){
    prefs=prefs&&typeof prefs==='object'?prefs:{};
    var next=defaultUiPrefs();
    if(prefs.lineThickness!=null)next.lineThickness=clampLineThickness(prefs.lineThickness);
    return next;
}

export function resolveUiPrefsStorage(storage){
    try{
        if(storage===undefined){
            if(typeof window==='undefined')return null;
            storage=window.localStorage;
        }
        if(!storage||typeof storage.getItem!=='function')return null;
        return storage;
    }catch(e){
        return null;
    }
}

export function readUiPrefs(storage){
    try{
        var store=resolveUiPrefsStorage(storage);
        if(!store)return defaultUiPrefs();
        var raw=store.getItem(UI_PREFS_STORAGE_KEY);
        if(!raw)return defaultUiPrefs();
        return normalizeUiPrefs(JSON.parse(raw));
    }catch(e){
        return defaultUiPrefs();
    }
}

export function writeUiPrefs(storage,prefs){
    var next=normalizeUiPrefs(Object.assign({},readUiPrefs(storage),prefs||{}));
    try{
        var store=resolveUiPrefsStorage(storage);
        if(store)store.setItem(UI_PREFS_STORAGE_KEY,JSON.stringify(next));
    }catch(e){}
    return next;
}

export function persistUiPrefs(prefs){
    return writeUiPrefs(undefined,prefs);
}
