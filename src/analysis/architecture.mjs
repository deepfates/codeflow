import { normalizeArchitecturePath, isArchitectureBuildOutput, isArchitectureTestFile, isArchitectureFixtureFile, isDocumentationPath, isDevToolingPath, isSecretScanExemptPath, isNonProductionPath, isArchitectureBackendPath, detectLayer, isHTML, isCode } from "./file-types.mjs";
export { normalizeArchitecturePath, isArchitectureBuildOutput, isArchitectureTestFile, isArchitectureFixtureFile, isDocumentationPath, isDevToolingPath, isSecretScanExemptPath, isNonProductionPath, isArchitectureBackendPath } from "./file-types.mjs";

export const ARCHITECTURE_MAX_BLOCKS=64;
export const ARCHITECTURE_GROUP_ORDER_CODEFLOW=['Browser App','GitHub Action','Analysis Core','Repository Collection','Rendering / Reports','Testing','Fixtures / Examples','Application','Storage'];
export const ARCHITECTURE_GROUP_ORDER_WEBAPP=['App Entry / Shell','Frontend Routes / Views','Frontend Components','Backend / API Layer','Services / Business Logic','Data / Storage','Shared / Utilities','Configuration','Content / Data','External Integrations','Build Output','Testing','Fixtures / Examples'];
export const ARCHITECTURE_GROUP_ORDER_GENERIC=['Application','Shared Services / Utils','Configuration','Content / Data','Build Output','Testing','Fixtures / Examples','Storage'];

export function getArchitectureGroupOrder(profile){
    if(profile==='codeflow')return ARCHITECTURE_GROUP_ORDER_CODEFLOW;
    if(profile==='web-app')return ARCHITECTURE_GROUP_ORDER_WEBAPP;
    return ARCHITECTURE_GROUP_ORDER_GENERIC;
}

export function detectArchitectureProfile(files,framework){
    var paths=(files||[]).map(function(f){return normalizeArchitecturePath(f.path||f.name).toLowerCase();});
    if(paths.some(function(p){return /(^|\/)index\.html?$/i.test(p);})&&paths.some(function(p){return /(^|\/)card\/(lib|render)\//i.test(p);}))return'codeflow';
    if(framework==='Next.js')return'web-app';
    if(paths.some(function(p){
        return /(^|\/)src\/app\//i.test(p)||/(^|\/)pages\//i.test(p)||/(^|\/)(backend|server|api|services?|middleware|routes?|platforms?)\b/i.test(p);
    }))return'web-app';
    if(framework==='Browser App')return'web-app';
    return'generic';
}











// Secrets are dangerous wherever the code executes — CI workflows, hooks and
// deploy scripts included — so the Hardcoded Secret rule exempts only
// tests/fixtures (stub credentials) and docs (examples), NOT dev tooling.




export function isArchitectureBarrelIndex(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    return /\/index\.(js|mjs|cjs|ts)$/i.test(p)&&!/\/index\.(tsx|jsx)$/i.test(p);
}

export function isNonRouteFolderSegment(segment){
    return ['hooks','components','ui','views','schemas','schema','controllers','middleware','services','routes','utils','lib','common','analytics','types','constants','validators','models','repositories','config','core','api','server','backend','workers','functions','platforms','tabs','charts','widgets','providers','layouts','shared','domain','usecases','processors','jobs','db','database','content','posts','blog','docs','tests','fixtures','node_modules','public','static','assets','styles','themes'].indexOf(segment)>=0;
}



export function canBeFrontendRoute(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(isArchitectureBuildOutput(path)||isArchitectureBackendPath(path)||isArchitectureBarrelIndex(path))return false;
    if(/(^|\/)src\/app\/.*\/page\.(jsx|tsx)$/i.test(p))return true;
    if(/^src\/app\/page\.(jsx|tsx)$/i.test(p))return true;
    if(/^src\/site-pages\/.+\/index\.(tsx|jsx)$/i.test(p))return true;
    if(/(^|\/)pages\/.*\.(jsx|tsx)$/i.test(p)&&!/(^|\/)pages\/api\//i.test(p))return true;
    var flat=p.match(/^([a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,4})\/index\.(tsx|jsx)$/);
    if(flat){
        var segments=flat[1].split('/').filter(Boolean);
        if(!segments.some(isNonRouteFolderSegment))return true;
    }
    return false;
}

export function isArchitectureFrontendPath(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(isArchitectureBuildOutput(path)||isArchitectureBackendPath(path))return false;
    if(/(^|\/)src\/app\//i.test(p)||/(^|\/)src\/site-pages\//i.test(p))return true;
    if(/(^|\/)pages\//i.test(p)&&/\.(jsx|tsx)$/i.test(p))return true;
    if(/(^|\/)(components|ui|views|widgets)\//i.test(p)&&/\.(jsx|tsx)$/i.test(p))return true;
    if(canBeFrontendRoute(path))return true;
    return false;
}

export function inferNextSpecialFile(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(/\/global-error\.(tsx|jsx)$/.test(p))return{role:'frontend-component',title:'Global Error Boundary',route:null,kind:'component'};
    if(/\/not-found\.(tsx|jsx)$/.test(p))return{role:'frontend-route',title:'404 Not Found',route:'/404',kind:'page'};
    if(/\/error\.(tsx|jsx)$/.test(p))return{role:'frontend-component',title:'Error Boundary',route:null,kind:'component'};
    if(/\/loading\.(tsx|jsx)$/.test(p))return{role:'frontend-component',title:'Loading UI',route:null,kind:'component'};
    if(/\/template\.(tsx|jsx)$/.test(p))return{role:'app-shell',title:'App Template',route:null,kind:'shell'};
    if(/\/layout\.(tsx|jsx)$/.test(p))return{role:'app-shell',title:'App Layout',route:null,kind:'shell'};
    if(/\/providers\.(tsx|jsx)$/.test(p))return{role:'app-shell',title:'App Providers',route:null,kind:'shell'};
    return null;
}

export function isArchitectureConfigPath(path,name){
    var p=normalizeArchitecturePath(path).toLowerCase();
    var base=String(name||'').toLowerCase();
    return /(^|\/)config(\/|$)/i.test(p)||/\.config\.(js|ts|mjs|cjs)$/.test(p)||base==='package.json'||base==='wrangler.toml'||base==='tsconfig.json';
}

export function isArchitectureContentPath(path,name){
    var p=normalizeArchitecturePath(path).toLowerCase();
    return /(^|\/)(blog|posts|content|data|static\/content)\b/i.test(p)||/\.(md|mdx)$/i.test(name||'');
}

export function isLikelyUiComponentSource(content){
    return /(from\s+['"`]react['"`]|React\.)/.test(content||'')&&(/export\s+(?:default\s+)?function\s+[A-Z]/.test(content||'')||/export\s+(?:default\s+)?(?:const|class)\s+[A-Z]/.test(content||'')||/<[A-Z][A-Za-z0-9_]*\b/.test(content||''));
}

export function inferWebAppRoute(path){
    if(!canBeFrontendRoute(path))return null;
    var p=normalizeArchitecturePath(path);
    var nextRoute=inferArchitectureRoute(p);
    if(nextRoute&&!isArchitectureBackendPath(path))return nextRoute;
    var match=p.match(/^(?:src\/)?site-pages\/(.+)\/index\.(tsx|jsx)$/i);
    if(match)return normalizeArchitectureRoute('/'+match[1].split('/').filter(Boolean).join('/'));
    match=p.match(/^([a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*){0,4})\/index\.(tsx|jsx)$/i);
    if(match&&!isNonRouteFolderSegment(match[1].split('/')[0])){
        var segments=match[1].split('/').filter(Boolean);
        if(!segments.some(isNonRouteFolderSegment))return normalizeArchitectureRoute('/'+segments.join('/'));
    }
    return null;
}

export function inferCodeflowArchitectureRole(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(isArchitectureTestFile(path))return'test';
    if(isArchitectureFixtureFile(path))return'fixture';
    if(/(^|\/)index\.html?$/i.test(p))return'browser-shell';
    if(/(^|\/)card\/index\.(js|mjs|cjs)$/i.test(p))return'action-entry';
    if(/\/analyzer\.(js|mjs|cjs)$/i.test(p))return'analyzer-loader';
    if(/\/collect\.(js|mjs|cjs)$/i.test(p))return'collector';
    if(/\/git\.(js|mjs|cjs)$/i.test(p))return'git';
    if(/\/inputs\.(js|mjs|cjs)$/i.test(p))return'inputs';
    if(/\/pr\.(js|mjs|cjs)$/i.test(p))return'pr';
    if(/\/state\.(js|mjs|cjs)$/i.test(p))return'state';
    if(/\/card\/render\/card\.(js|mjs|cjs)$/i.test(p))return'renderer';
    if(/(^|\/)card\/render\//i.test(p))return'render-support';
    if(/(^|\/)card\/lib\//i.test(p))return'module';
    return'module';
}

export function inferWebAppArchitectureRole(path,classified,content){
    var p=normalizeArchitecturePath(path).toLowerCase();
    var base=architectureFileBaseName(path);
    var special=inferNextSpecialFile(path);
    if(special)return special.role;
    if(isArchitectureTestFile(path))return'test';
    if(isArchitectureFixtureFile(path))return'fixture';
    if(isArchitectureBuildOutput(path))return'build-output';
    if(isArchitectureBackendPath(path)){
        if(/\/middleware(\/|$)/.test(p)||base.toLowerCase()==='middleware')return'backend-middleware';
        if(/\/routes(\/|$)/.test(p)||base.toLowerCase()==='routes')return'backend-routes';
        if(/\/services(\/|$)/.test(p)||base.toLowerCase()==='services'||base.toLowerCase()==='service')return'backend-services';
        if(/\/config(\/|$)/.test(p)||base.toLowerCase()==='config')return'config';
        if(/\/core(\/|$)/.test(p)||base.toLowerCase()==='core')return'config';
        if(/\/platforms\/[^/]+\//.test(p)&&(/analyzer|controller|api/.test(p)||/analyzer|controller/i.test(base)))return'platform-analyzer';
        if(/\/analyzer/.test(p)||/analyzer/i.test(base))return'platform-analyzer';
        if(/api[-_]?client/i.test(p)||/api[-_]?client/i.test(base))return'api-client';
        return'backend-module';
    }
    if(isArchitectureConfigPath(path,base))return'config';
    if(isArchitectureContentPath(path,base))return'content';
    if(/(^|\/)src\/app\/(layout|template|providers|page)\./i.test(p))return'app-shell';
    if(classified.kind==='api'||/^src\/app\/api\//.test(p))return'backend-routes';
    if(classified.kind==='page'&&classified.route&&canBeFrontendRoute(path))return'frontend-route';
    if(/\/hooks(\/|$)/.test(p)||/\/schemas?(\/|$)/.test(p)||/\/validators?(\/|$)/.test(p))return'shared-module';
    if(/\/components(\/|$)/.test(p)||/\/ui\/components(\/|$)/.test(p)||/\/views(\/|$)/.test(p)){
        if(/\.(tsx|jsx)$/i.test(p)&&isLikelyUiComponentSource(content))return'frontend-component';
        return'shared-module';
    }
    if((classified.kind==='component'||classified.kind==='hook')&&/\.(tsx|jsx)$/i.test(p)&&isLikelyUiComponentSource(content))return'frontend-component';
    if(/(^|\/)utils?\b/i.test(p)||/(^|\/)lib\//i.test(p)||/(^|\/)common\//i.test(p)||/(^|\/)constants?\b/i.test(p))return'shared-module';
    return'shared-module';
}

export function inferArchitectureRole(path,profile,classified,content){
    if(profile==='codeflow')return inferCodeflowArchitectureRole(path);
    return inferWebAppArchitectureRole(path,classified||{kind:'utility',route:null},content||'');
}

export function inferArchitectureGroup(role,fact,profile){
    if(profile==='codeflow'){
        if(role==='browser-shell')return'Browser App';
        if(role==='action-entry')return'GitHub Action';
        if(role==='analyzer-loader'||role==='state')return'Analysis Core';
        if(role==='collector'||role==='git'||role==='inputs'||role==='pr')return'Repository Collection';
        if(role==='renderer'||role==='render-support')return'Rendering / Reports';
        if(role==='test')return'Testing';
        if(role==='fixture')return'Fixtures / Examples';
        if(fact&&fact.kind==='page')return'Browser App';
        if(fact&&fact.kind==='api')return'Application';
        if(fact&&(fact.kind==='database-adapter'||fact.kind==='database'))return'Storage';
        return'Application';
    }
    if(role==='app-shell')return'App Entry / Shell';
    if(role==='frontend-route')return'Frontend Routes / Views';
    if(role==='frontend-component')return'Frontend Components';
    if(role==='platform-analyzer')return'Services / Business Logic';
    if(role==='backend-routes'||role==='backend-middleware'||role==='api-client')return'Backend / API Layer';
    if(role==='backend-services'||role==='backend-module')return'Services / Business Logic';
    if(role==='config')return'Configuration';
    if(role==='content')return'Content / Data';
    if(role==='build-output')return'Build Output';
    if(role==='test')return'Testing';
    if(role==='fixture')return'Fixtures / Examples';
    if(role==='shared-module')return'Shared / Utilities';
    if(fact&&(fact.kind==='database-adapter'||fact.kind==='database'))return'Data / Storage';
    return'Shared / Utilities';
}

export function isArchitectureSignificantFile(path,role,fact,framework,profile,importedByCore){
    if(isArchitectureTestFile(path)||isArchitectureFixtureFile(path)||isArchitectureBuildOutput(path))return false;
    if(profile==='codeflow'){
        if(role==='browser-shell'||role==='action-entry')return true;
        if(role==='analyzer-loader'||role==='collector'||role==='git'||role==='inputs'||role==='pr'||role==='state'||role==='renderer'||role==='render-support')return true;
        if(/(^|\/)card\/(lib|render)\//i.test(path))return true;
        if(fact.kind==='page'||fact.kind==='api')return true;
        if(fact.kind==='database-adapter'&&fact.dbUsage)return true;
        return false;
    }
    if(role==='app-shell')return true;
    if(role==='frontend-route'&&fact.route&&canBeFrontendRoute(path))return true;
    if(role==='frontend-component'&&/\.(tsx|jsx)$/i.test(path))return true;
    if(role==='backend-routes'||role==='backend-middleware'||role==='backend-services'||role==='platform-analyzer'||role==='api-client')return true;
    if(role==='config'||role==='content')return true;
    if(role==='backend-module'&&/(middleware|routes?|services?|analyzer|platform)/i.test(path))return true;
    if(fact.kind==='page'&&fact.route&&canBeFrontendRoute(path))return true;
    if(fact.kind==='api')return true;
    if(fact.kind==='database-adapter'&&fact.dbUsage)return true;
    if(importedByCore)return true;
    return false;
}

export function extractExportedComponentName(content){
    var match=(content||'').match(/export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/);
    if(match)return match[1];
    match=(content||'').match(/export\s+default\s+(?:const|class)\s+([A-Z][A-Za-z0-9_]*)/);
    if(match)return match[1];
    match=(content||'').match(/export\s+function\s+([A-Z][A-Za-z0-9_]*)/);
    if(match)return match[1];
    return null;
}

export function inferPageComponentTitle(path,route,content){
    var special=inferNextSpecialFile(path);
    if(special&&special.title)return special.title;
    var exported=extractExportedComponentName(content);
    if(exported)return exported;
    var base=architectureFileBaseName(path);
    if(/^[A-Z]/.test(base)&&base!=='Index'&&base!=='Page')return base;
    if(route&&route!=='/'){
        var segment=route.split('/').filter(Boolean).pop()||'';
        if(segment)return segment.charAt(0).toUpperCase()+segment.slice(1).replace(/[-_](\w)/g,function(m,c){return c.toUpperCase();})+' Page';
    }
    if(/layout/i.test(base))return'App Layout';
    if(/page/i.test(base))return'Page Module';
    return'UI Module';
}

export function testFileReferencesCore(content){
    return /CODEFLOW_ANALYZER|buildAnalysisData|loadAnalyzer|locateIndexHtml|const Parser=\{/.test(content||'');
}

export function inferTestTargetPaths(testPath){
    var base=architectureFileBaseName(testPath).toLowerCase();
    var targets=[];
    if(/golden/.test(base))targets.push('card/lib/analyzer.js');
    if(/repo-smoke|smoke/.test(base))targets.push('card/lib/collect.js');
    if(/md-extractor|sync-with-html|html-inline/.test(base))targets.push('index.html');
    return targets;
}

export function architectureDependencyLabel(sourceRole,targetRole,importPath){
    if(sourceRole==='test')return'tests';
    if(sourceRole==='browser-shell'&&targetRole==='analyzer-loader')return'runs analysis';
    if(sourceRole==='browser-shell'&&targetRole==='collector')return'loads repo data';
    if(sourceRole==='action-entry'&&targetRole==='browser-shell')return'loads analyzer from';
    if(sourceRole==='action-entry'&&targetRole==='collector')return'collects repo';
    if(sourceRole==='action-entry'&&targetRole==='analyzer-loader')return'runs analysis';
    if(sourceRole==='action-entry'&&targetRole==='state')return'stores derived state';
    if(sourceRole==='action-entry'&&targetRole==='renderer')return'renders report';
    if(sourceRole==='collector'&&targetRole==='git')return'uses GitHub API';
    if(sourceRole==='collector'&&targetRole==='inputs')return'normalizes input';
    if(sourceRole==='pr'&&targetRole==='git')return'analyzes pull requests';
    if(sourceRole==='analyzer-loader'&&targetRole==='state')return'stores derived state';
    if(sourceRole==='renderer'&&targetRole==='render-support')return'uses visual helpers';
    if(sourceRole==='render-support'&&targetRole==='render-support'){
        if(/receipt-md/.test(importPath||''))return'exports markdown';
        if(/theme/.test(importPath||''))return'uses';
        return'uses';
    }
    if(targetRole==='database')return'queries';
    if(sourceRole==='browser-shell'&&targetRole==='api')return'calls';
    if(sourceRole==='app-shell'&&targetRole==='frontend-route')return'bootstraps';
    if(sourceRole==='frontend-route'&&targetRole==='frontend-component')return'renders';
    if(sourceRole==='frontend-component'&&targetRole==='platform-analyzer')return'calls';
    if(sourceRole==='frontend-component'&&targetRole==='backend-services')return'calls';
    if(sourceRole==='backend-routes'&&targetRole==='backend-middleware')return'passes through';
    if(sourceRole==='backend-routes'&&targetRole==='backend-services')return'dispatches';
    if(sourceRole==='backend-services'&&targetRole==='platform-analyzer')return'uses';
    if(sourceRole==='platform-analyzer'&&targetRole==='api-client')return'uses API';
    if(sourceRole==='frontend-component'&&targetRole==='content')return'reads content';
    if((sourceRole==='app-shell'||sourceRole==='backend-module')&&targetRole==='config')return'depends on';
    return'depends on';
}



export function architectureDirname(path){
    path=normalizeArchitecturePath(path);
    return path.includes('/')?path.split('/').slice(0,-1).join('/'):'';
}

export function stripArchitectureExt(path){
    return normalizeArchitecturePath(path).replace(/\.(jsx?|tsx?|mjs|cjs|html?|css|scss|sass|less|py|pyw|pyi|rb|go|java|php|rs|cs|swift|kt|kts)$/i,'');
}

export function architectureFileBaseName(path){
    var base=stripArchitectureExt(path).split('/').pop()||'Block';
    return base==='index'?(stripArchitectureExt(path).split('/').slice(-2,-1)[0]||base):base;
}

export function normalizeArchitectureRoute(route){
    route=String(route||'').split('#')[0].split('?')[0].trim();
    if(!route)return'';
    if(route[0]!=='/')route='/'+route;
    route=route.replace(/\/{2,}/g,'/');
    if(route.length>1)route=route.replace(/\/$/,'');
    return route||'/';
}

export function routeSegmentsMatch(patternRoute,targetRoute){
    patternRoute=normalizeArchitectureRoute(patternRoute);
    targetRoute=normalizeArchitectureRoute(targetRoute);
    if(patternRoute===targetRoute)return true;
    var pattern=patternRoute.split('/').filter(Boolean);
    var target=targetRoute.split('/').filter(Boolean);
    for(var i=0;i<pattern.length;i++){
        var segment=pattern[i];
        if(segment.charAt(0)===':'&&segment.endsWith('*'))return true;
        if(i>=target.length)return false;
        if(segment.charAt(0)===':')continue;
        if(segment!==target[i])return false;
    }
    return pattern.length===target.length;
}

export function getArchitectureScanFiles(files){
    return (files||[]).filter(function(file){
        var path=normalizeArchitecturePath(file.path||file.name);
        return !isArchitectureTestFile(path)&&!isArchitectureFixtureFile(path);
    });
}

export function detectArchitectureFramework(files){
    var paths=getArchitectureScanFiles(files).map(function(f){return normalizeArchitecturePath(f.path||f.name).toLowerCase();});
    if(paths.indexOf('mix.exs')>=0){
        var phoenix=(files||[]).some(function(file){
            return /^lib\//.test(file.path||'')&&((file.elixir&&file.elixir.modules)||[]).some(function(m){
                return (m.uses||[]).concat(m.quotedUses||[]).some(function(d){return /^Phoenix\./.test(d.module);});
            });
        });
        return phoenix?'Phoenix':'Elixir / OTP';
    }
    var hasNextConfig=paths.some(function(p){return /(^|\/)next\.config\.(js|mjs|ts|cjs)$/.test(p);});
    var hasAppRouter=paths.some(function(p){return /(^|\/)(src\/)?app\/.*(page|route)\.(js|jsx|ts|tsx)$/.test(p);});
    var hasPagesRouter=paths.some(function(p){return /(^|\/)(src\/)?pages\/.*\.(js|jsx|ts|tsx)$/.test(p);});
    if(hasNextConfig||hasAppRouter||hasPagesRouter)return'Next.js';
    if(paths.some(function(p){return /\.(html?|xhtml)$/.test(p);}))return'Browser App';
    if(paths.some(function(p){return /\.(jsx?|tsx?|mjs|cjs)$/.test(p);}))return'JavaScript/TypeScript';
    if(paths.some(function(p){return /\.(py|pyw|pyi)$/.test(p);}))return'Python';
    if(paths.some(function(p){return /\.exs?$/.test(p);}))return'Elixir / OTP';
    return'Generic';
}

export function convertNextRouteSegment(segment){
    if(!segment||/^\(.*\)$/.test(segment))return null;
    var optionalCatchAll=segment.match(/^\[\[\.\.\.(.+)\]\]$/);
    if(optionalCatchAll)return':'+optionalCatchAll[1]+'*';
    var catchAll=segment.match(/^\[\.\.\.(.+)\]$/);
    if(catchAll)return':'+catchAll[1]+'*';
    var dynamic=segment.match(/^\[(.+)\]$/);
    if(dynamic)return':'+dynamic[1];
    return segment;
}

export function nextRouteFromSegments(segments){
    var clean=[];
    (segments||[]).forEach(function(segment){
        var converted=convertNextRouteSegment(segment);
        if(converted)clean.push(converted);
    });
    return normalizeArchitectureRoute('/'+clean.join('/'));
}

export function inferArchitectureRoute(path){
    var p=normalizeArchitecturePath(path);
    var match;

    match=p.match(/^(?:src\/)?app\/api\/(.+)\/route\.(js|jsx|ts|tsx)$/i);
    if(match)return nextRouteFromSegments(['api'].concat(match[1].split('/')));

    match=p.match(/^(?:src\/)?app\/api\/route\.(js|jsx|ts|tsx)$/i);
    if(match)return'/api';

    match=p.match(/^(?:src\/)?app\/(.+)\/page\.(js|jsx|ts|tsx)$/i);
    if(match)return nextRouteFromSegments(match[1].split('/'));

    match=p.match(/^(?:src\/)?app\/page\.(js|jsx|ts|tsx)$/i);
    if(match)return'/';

    match=p.match(/^(?:src\/)?pages\/api\/(.+)\.(js|jsx|ts|tsx)$/i);
    if(match){
        var apiParts=stripArchitectureExt(match[1]).split('/').filter(Boolean);
        if(apiParts[apiParts.length-1]==='index')apiParts.pop();
        return nextRouteFromSegments(['api'].concat(apiParts));
    }

    match=p.match(/^(?:src\/)?pages\/(.+)\.(js|jsx|ts|tsx)$/i);
    if(match){
        var routePath=stripArchitectureExt(match[1]);
        var parts=routePath.split('/').filter(Boolean);
        var first=parts[0]||'';
        if(first.charAt(0)==='_')return null;
        if(parts[parts.length-1]==='index')parts.pop();
        return nextRouteFromSegments(parts);
    }

    return null;
}

export function extractArchitectureImports(content){
    var imports=[];
    var regexes=[
        /import\s+[\s\S]*?\s+from\s+['"`]([^'"`]+)['"`]/g,
        /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
        /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g
    ];
    regexes.forEach(function(regex){
        var match;
        while((match=regex.exec(content||'')))imports.push(match[1]);
    });
    return Array.from(new Set(imports));
}

export function extractJsxComponents(content){
    var components=[];
    var ignored=new Set(['Fragment','React','Suspense','StrictMode']);
    var regex=/<([A-Z][A-Za-z0-9_]*)\b/g;
    var match;
    while((match=regex.exec(content||''))){
        if(!ignored.has(match[1]))components.push(match[1]);
    }
    return Array.from(new Set(components));
}

export function extractNavigationLinks(content){
    var links=[];
    var regexes=[
        /<Link[^>]+href=["'`]([^"'`]+)["'`]/g,
        /<a[^>]+href=["'`]([^"'`]+)["'`]/g,
        /router\.(?:push|replace)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
        /navigate\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
    ];
    regexes.forEach(function(regex){
        var match;
        while((match=regex.exec(content||''))){
            var route=normalizeArchitectureRoute(match[1]);
            if(route&&route.charAt(0)==='/'&&!route.startsWith('/api'))links.push(route);
        }
    });
    return Array.from(new Set(links));
}

export function extractApiCalls(content){
    var calls=[];
    var match;
    var fetchRegex=/fetch\s*\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*\{([\s\S]{0,180}?)\})?/g;
    while((match=fetchRegex.exec(content||''))){
        var method='GET';
        var methodMatch=(match[2]||'').match(/method\s*:\s*["'`]([A-Za-z]+)["'`]/);
        if(methodMatch)method=methodMatch[1].toUpperCase();
        calls.push({method:method,url:normalizeArchitectureRoute(match[1])});
    }
    var axiosRegex=/axios\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while((match=axiosRegex.exec(content||''))){
        calls.push({method:match[1].toUpperCase(),url:normalizeArchitectureRoute(match[2])});
    }
    return calls.filter(function(call){return call.url&&call.url.startsWith('/api');});
}

export function detectDatabaseUsage(content){
    return [
        /\bnew\s+PrismaClient\s*\(/,
        /\bprisma\.\w+\.(findMany|findUnique|findFirst|create|update|delete|upsert|count|aggregate)\s*\(/,
        /\bsupabase\.from\s*\(/,
        /\bmongoose\.model\b/,
        /\bpool\.query\s*\(/,
        /\bdb\.(select|insert|update|delete|query)\s*\(/,
        /\bcollection\s*\(/
    ].some(function(pattern){return pattern.test(content||'');});
}

export function isLikelyReactComponentFile(path,content){
    var p=normalizeArchitecturePath(path);
    var base=architectureFileBaseName(p);
    return /(^|\/)(components|ui)\//i.test(p)||
        /^[A-Z]/.test(base)||
        /\.(jsx|tsx)$/i.test(p)||
        (/(from\s+['"`]react['"`]|React\.)/.test(content||'')&&/<[A-Z][A-Za-z0-9_]*\b/.test(content||''));
}

export function classifyArchitectureFile(path,content){
    var p=normalizeArchitecturePath(path);
    var route=inferArchitectureRoute(p);
    if(route){
        return route.startsWith('/api')?{kind:'api',route:route}:{kind:'page',route:route};
    }
    var base=architectureFileBaseName(p);
    var dbUsage=detectDatabaseUsage(content);
    if(/^use[A-Z0-9_]/.test(base)||/(^|\/)hooks?\//i.test(p))return{kind:'hook',route:null};
    if(dbUsage&&/(^|\/)(db|database|prisma|models?|schema|repositories?|data)\b/i.test(p))return{kind:'database-adapter',route:null};
    if(/(^|\/)(services?|controllers?|server|actions)\//i.test(p))return{kind:'service',route:null};
    if(isLikelyReactComponentFile(p,content))return{kind:'component',route:null};
    if(dbUsage)return{kind:'database-adapter',route:null};
    return{kind:'utility',route:null};
}

export function inferGenericArchitectureRoute(path){
    var p=normalizeArchitecturePath(path);
    if(/(^|\/)index\.html?$/i.test(p))return'/';
    if(/\.(html?|xhtml)$/i.test(p)){
        return normalizeArchitectureRoute('/'+stripArchitectureExt(p).replace(/\/index$/i,''));
    }
    return null;
}

export function classifyGenericArchitectureFile(file,content){
    var p=normalizeArchitecturePath(file.path||file.name);
    var name=file.name||p.split('/').pop()||'';
    var layer=(file.layer||detectLayer(p)||'utils').toLowerCase();
    var dbUsage=detectDatabaseUsage(content);
    var route=inferGenericArchitectureRoute(p);

    if(route||isHTML(name))return{kind:'page',route:route||'/'+stripArchitectureExt(name)};
    if(dbUsage||layer==='data'||layer==='classes')return{kind:'database-adapter',route:null};
    if(layer==='ui'||layer==='forms'||layer==='components')return{kind:'component',route:null};
    if(layer==='services')return{kind:'service',route:null};
    if(layer==='config')return{kind:'utility',route:null};
    if(file.functions&&file.functions.length>0)return{kind:'module',route:null};
    return{kind:'utility',route:null};
}

// Elixir declarations are supplied by the shared Tree-sitter analysis. These
// enrich the same facts, blocks and exports as every other language.
export function architectureModuleFacts(file,phoenixWrappers){
    var metadata=file.elixir;
    if(!metadata||!Array.isArray(metadata.modules)||!metadata.modules.length)return null;
    var modules=metadata.modules.filter(function(m){return m&&typeof m.name==='string';});
    if(!modules.length)return null;
    var names=modules.map(function(m){return m.name;}).sort(function(a,b){return a.length-b.length||a.localeCompare(b);});
    var declarations=[];
    modules.forEach(function(m){
        declarations.push({kind:'module',module:m.name,line:m.line,path:file.path,evidence:metadata.provenance});
        ['uses','behaviours'].forEach(function(key){(m[key]||[]).forEach(function(d){
            declarations.push({kind:key==='uses'?'use':'behaviour',module:d.module,line:d.line,path:file.path,arguments:d.arguments||[],evidence:metadata.provenance});
        });});
    });
    var declared=declarations.map(function(d){return d.module;});
    var phoenixRole={':live_view':'Phoenix.LiveView',':live_component':'Phoenix.LiveComponent',':controller':'Phoenix.Controller',':router':'Phoenix.Router'};
    declarations.forEach(function(d){
        if(d.kind==='use'&&phoenixWrappers&&phoenixWrappers.has(d.module)){
            var argument=(d.arguments||[])[0],via=phoenixRole[argument];
            if(via&&phoenixWrappers.get(d.module).some(function(q){return q.module===via&&q.viaFunction===argument.slice(1);}))declared.push(via);
        }
    });
    var role='module',kind='module',group='Shared / Utilities';
    if(declared.indexOf('Application')>=0){role='otp-application';group='Application';}
    else if(declared.some(function(m){return m==='Supervisor'||m==='DynamicSupervisor'||m==='supervisor';})){role='otp-supervisor';group='Application';}
    else if(declared.some(function(m){return m==='GenServer'||m==='GenStateMachine'||m==='gen_server'||m==='gen_statem';})){role='otp-process';kind='service';group='Services / Business Logic';}
    else if(declared.indexOf('Phoenix.Endpoint')>=0||declared.indexOf('Phoenix.Router')>=0){role='phoenix-endpoint';kind='api';group='Backend / API Layer';}
    else if(declared.indexOf('Phoenix.LiveView')>=0||declared.indexOf('Phoenix.LiveComponent')>=0){role='phoenix-live-view';kind='component';group='Frontend Routes / Views';}
    else if(declared.indexOf('Phoenix.Controller')>=0){role='phoenix-controller';kind='api';group='Backend / API Layer';}
    else if(declared.indexOf('Ecto.Repo')>=0){role='ecto-repo';kind='database-adapter';group='Data / Storage';}
    else if(declared.indexOf('Mix.Task')>=0){role='mix-task';group='Application';}
    return{names:names,title:names[0],role:role,kind:kind,group:group,declarations:declarations,calls:metadata.calls||[]};
}

export function extractArchitectureFacts(files,framework){
    var profile=detectArchitectureProfile(files,framework);
    var phoenixWrappers=new Map();
    (files||[]).forEach(function(file){((file.elixir&&file.elixir.modules)||[]).forEach(function(m){
        var quoted=(m.quotedUses||[]).filter(function(d){return /^Phoenix\./.test(d.module);});
        if(quoted.length)phoenixWrappers.set(m.name,quoted);
    });});
    var rawFacts=(files||[]).filter(function(file){
        return file&&file.content&&isCode(file.name||file.path||'');
    }).map(function(file){
        var path=normalizeArchitecturePath(file.path||file.name);
        var content=file.content||'';
        if(isArchitectureBuildOutput(path,file.name)){
            return{
                path:path,
                name:file.name||path.split('/').pop(),
                kind:'build-output',
                route:null,
                role:'build-output',
                group:'Build Output',
                profile:profile,
                isTest:false,
                isFixture:false,
                isBuildOutput:true,
                isCore:false,
                imports:[],
                jsxComponents:[],
                links:[],
                apiCalls:[],
                dbUsage:false,
                content:content,
                loc:file.lines||0
            };
        }
        var special=inferNextSpecialFile(path);
        var webRoute=canBeFrontendRoute(path)?inferWebAppRoute(path):null;
        var classified=framework==='Next.js'
            ? classifyArchitectureFile(path,content)
            : classifyGenericArchitectureFile(file,content);
        if(special){
            classified={kind:special.kind,route:special.route};
        }else if(webRoute&&profile!=='codeflow'&&!isArchitectureBackendPath(path)){
            classified=classified.kind==='api'?classified:{kind:'page',route:webRoute};
        }else if(isArchitectureBackendPath(path)||isArchitectureBarrelIndex(path)){
            if(classified.kind==='page')classified={kind:'module',route:null};
        }
        var role=inferArchitectureRole(path,profile,classified,content);
        if(special){
            role=special.role;
            if(special.route)classified.route=special.route;
        }
        if(role==='fixture')classified={kind:'fixture',route:null};
        else if(role==='browser-shell')classified={kind:'shell',route:inferGenericArchitectureRoute(path)||'/'};
        else if(role==='action-entry')classified={kind:'action-entry',route:null};
        else if(role==='test')classified={kind:'test',route:null};
        else if(role==='build-output')classified={kind:'build-output',route:null};
        else if(role==='app-shell')classified={kind:'shell',route:null};
        else if(role==='frontend-route')classified={kind:'page',route:classified.route||webRoute};
        else if(role==='frontend-component')classified={kind:'component',route:classified.route||null};
        else if(role==='backend-routes'||role==='backend-middleware'||role==='backend-services'||role==='backend-module'||role==='platform-analyzer'||role==='api-client'){
            classified={kind:role==='platform-analyzer'?'service':'module',route:null};
        }
        var moduleFacts=architectureModuleFacts(file,phoenixWrappers);
        if(moduleFacts&&!isArchitectureTestFile(path)&&!isArchitectureFixtureFile(path)){
            role=moduleFacts.role;classified={kind:moduleFacts.kind,route:null};
        }
        var exampleKind=/^examples?\//.test(path)?'example':/^(bench|benchmarks)\//.test(path)?'benchmark':null;
        if(exampleKind){role=exampleKind;classified={kind:'module',route:null};}
        var displayTitle=moduleFacts?moduleFacts.title:special?special.title:null;
        if(!displayTitle&&role==='frontend-component')displayTitle=inferPageComponentTitle(path,classified.route,content);
        return{
            path:path,
            name:file.name||path.split('/').pop(),
            kind:classified.kind,
            route:classified.route,
            displayTitle:displayTitle,
            role:role,
            group:exampleKind?'Fixtures / Examples':moduleFacts&&!isArchitectureTestFile(path)&&!isArchitectureFixtureFile(path)?moduleFacts.group:inferArchitectureGroup(role,{kind:classified.kind},profile),
            modules:moduleFacts?moduleFacts.names:[],
            declarations:moduleFacts?moduleFacts.declarations:[],
            sourceCalls:moduleFacts?moduleFacts.calls:[],
            profile:profile,
            isTest:isArchitectureTestFile(path),
            isFixture:isArchitectureFixtureFile(path),
            isBuildOutput:isArchitectureBuildOutput(path,file.name),
            isCore:false,
            imports:extractArchitectureImports(content),
            jsxComponents:extractJsxComponents(content),
            links:extractNavigationLinks(content),
            apiCalls:extractApiCalls(content),
            dbUsage:detectDatabaseUsage(content),
            content:content,
            loc:file.lines||0
        };
    });
    var corePaths=new Set();
    rawFacts.forEach(function(fact){
        if(fact.isBuildOutput||fact.isTest||fact.isFixture)return;
        fact.isCore=!!(fact.modules&&fact.modules.length)||isArchitectureSignificantFile(fact.path,fact.role,fact,framework,fact.profile,false);
        if(fact.isCore)corePaths.add(fact.path);
    });
    // Follow imports from established entry points and core modules. A module's
    // significance does not depend on its filename or the order files arrived.
    var factsByPath=new Map(rawFacts.map(function(fact){return [fact.path,fact];}));
    var pending=rawFacts.filter(function(fact){return fact.isCore;});
    for(var cursor=0;cursor<pending.length;cursor++){
        var importer=pending[cursor];
        importer.imports.forEach(function(importPath){
            var resolved=resolveArchitectureImport(importPath,importer.path,files);
            var dependency=resolved&&factsByPath.get(resolved);
            if(!dependency||dependency.isCore||dependency.isBuildOutput||dependency.isTest||dependency.isFixture)return;
            dependency.isCore=true;
            corePaths.add(dependency.path);
            pending.push(dependency);
        });
    }
    var namespaceBranches=new Set();
    rawFacts.forEach(function(fact){(fact.modules||[]).forEach(function(name){var parts=name.split('.');if(parts.length>2)namespaceBranches.add(parts.slice(0,2).join('.'));});});
    rawFacts.forEach(function(fact){
        if(!fact.modules||!fact.modules.length||fact.isTest||fact.isFixture)return;
        var name=fact.modules[0],parts=name.split('.'),branch=parts.slice(0,2).join('.');
        fact.namespaceRoot=parts[0];
        if(fact.role==='module'||fact.role==='mix-task')fact.namespace=namespaceBranches.has(branch)?branch:null;
    });
    return rawFacts;
}

export function shouldShowArchitectureBlock(fact){
    return ['page','api','component','hook','service','database-adapter','module','utility','shell','fixture','action-entry','test','build-output'].includes(fact.kind);
}

export function architectureLayer(fact){
    if(fact.kind==='page'||fact.kind==='component'||fact.kind==='hook')return'Frontend';
    if(fact.kind==='api'||fact.kind==='service')return'Backend';
    if(fact.kind==='database-adapter')return'Data Layer';
    if(fact.kind==='database')return'Storage';
    if(fact.kind==='module'||fact.kind==='utility')return'Shared';
    return'Shared';
}

export function architectureTitle(fact){
    if(fact.displayTitle)return fact.displayTitle;
    if(fact.role==='app-shell')return'App Entry / Shell';
    if(fact.kind==='shell'||fact.role==='browser-shell')return'Browser App Shell';
    if(fact.kind==='action-entry')return'GitHub Action';
    if(fact.role==='frontend-route')return fact.route==='/'?'/':fact.route;
    if(fact.role==='frontend-component')return inferPageComponentTitle(fact.path,fact.route,fact.content);
    if(fact.role==='platform-analyzer'){
        var seg=(fact.path.match(/\/(youtube|reddit|twitter|github|tiktok|instagram)\b/i)||[])[1];
        if(seg)return seg.charAt(0).toUpperCase()+seg.slice(1)+' Analyzer';
        return architectureFileBaseName(fact.path)+' Analyzer';
    }
    if(fact.role==='backend-middleware')return'Middleware';
    if(fact.role==='backend-routes')return'API Routes';
    if(fact.role==='backend-services')return'Services';
    if(fact.role==='backend-module'){
        var seg=normalizeArchitecturePath(fact.path).split('/').filter(Boolean);
        var name=architectureFileBaseName(fact.path);
        if(name&&name!=='index')return name.charAt(0).toUpperCase()+name.slice(1);
        return seg.length?seg[seg.length-1].charAt(0).toUpperCase()+seg[seg.length-1].slice(1):'Backend Module';
    }
    if(fact.role==='api-client')return'API Clients';
    if(fact.role==='config')return'Config';
    if(fact.role==='content')return'Content';
    if(fact.kind==='page')return fact.route==='/'?'Home Page':'Page '+fact.route;
    if(fact.kind==='api')return'API '+fact.route;
    if(fact.kind==='database')return'Database';
    return architectureFileBaseName(fact.path);
}

export function aggregateFrontendComponentKey(block){
    var files=(block.files||[]).map(function(f){return normalizeArchitecturePath(f).toLowerCase();});
    var sample=files[0]||'';
    var platform=sample.match(/\/platforms\/([^/]+)\//);
    if(platform){
        var name=platform[1];
        if(/\/tabs\/[^/]+\/insights\//.test(sample))return'agg:fe:'+name+'-insight-tabs';
        if(/\/tabs\//.test(sample))return'agg:fe:'+name+'-tabs';
        if(/\/components\/charts\//.test(sample)||/\/charts\//.test(sample))return'agg:fe:'+name+'-chart-components';
        if(/\/views\//.test(sample)||/\/pages\//.test(sample))return'agg:fe:'+name+'-dashboard';
        if(/\/components\//.test(sample))return'agg:fe:'+name+'-components';
        return'agg:fe:'+name+'-feature-ui';
    }
    if(/\/components\/charts\//.test(sample)||/\/charts\//.test(sample))return'agg:fe:chart-components';
    if(/\/components\//.test(sample)||/\/ui\/components\//.test(sample))return'agg:fe:shared-ui-components';
    if(/\/hooks\//.test(sample))return'agg:fe:hooks';
    if(/\/views\//.test(sample))return'agg:fe:views';
    return'agg:fe:feature-components';
}

export function getArchitectureAggregateKey(block,profile){
    if(profile==='codeflow')return null;
    if(block.role==='example'||block.role==='benchmark')return 'agg:'+block.role;
    if(block.modules&&block.modules.length&&!block.isTest&&!block.isFixture&&!block.isBuildOutput)return block.namespace?'agg:namespace:'+block.namespace:null;
    if(block.isBuildOutput)return null;
    if(block.role==='app-shell'||block.role==='browser-shell')return'agg:app-shell';
    if(block.role==='frontend-route'&&block.route)return'agg:route:'+block.route;
    if(block.role==='frontend-component')return aggregateFrontendComponentKey(block);
    if(block.role==='platform-analyzer'){
        var sample=String((block.files&&block.files[0])||'').toLowerCase();
        var seg=sample.match(/\/platforms\/([^/]+)\//);
        if(seg)return'agg:analyzer:'+seg[1];
        seg=sample.match(/\/(youtube|reddit|twitter|github|tiktok|instagram)\b/);
        return'agg:analyzer:'+(seg?seg[1]:block.title).toLowerCase();
    }
    if(block.role==='backend-middleware')return'agg:backend:middleware';
    if(block.role==='backend-routes')return'agg:backend:routes';
    if(block.role==='backend-services')return'agg:backend:services';
    if(block.role==='api-client')return'agg:backend:api-client';
    if(block.role==='backend-module'){
        var sample=String((block.files&&block.files[0])||'').toLowerCase();
        if(/\/config\//.test(sample))return'agg:backend:config';
        if(/\/core\//.test(sample))return'agg:backend:core';
        return'agg:backend:'+architectureFileBaseName((block.files&&block.files[0])||'module').toLowerCase();
    }
    if(block.role==='config')return'agg:config';
    if(block.role==='content')return'agg:content';
    if(block.group==='Shared / Utilities'||block.role==='shared-module'){
        var sample=String((block.files&&block.files[0])||'').toLowerCase();
        if(/\/hooks\//.test(sample))return'agg:shared:hooks';
        if(/\/schemas?\//.test(sample))return'agg:shared:schema';
        if(/\/utils?\//.test(sample))return'agg:shared:utils';
        return'agg:shared:utilities';
    }
    return null;
}

export function titleCaseSegment(value){
    return String(value||'').split(/[-_]/).filter(Boolean).map(function(part){
        return part.charAt(0).toUpperCase()+part.slice(1);
    }).join(' ');
}

export function resolveAggregateBlockTitle(key){
    if(!key||!key.startsWith('agg:'))return null;
    var known={
        'agg:example':'Examples',
        'agg:benchmark':'Benchmarks',
        'agg:app-shell':'App Shell',
        'agg:backend:middleware':'Middleware',
        'agg:backend:routes':'API Routes',
        'agg:backend:services':'Services',
        'agg:backend:api-client':'API Clients',
        'agg:backend:config':'Config',
        'agg:backend:core':'Core',
        'agg:config':'App Config',
        'agg:content':'Content',
        'agg:fe:chart-components':'Chart Components',
        'agg:fe:shared-ui-components':'Shared UI Components',
        'agg:fe:hooks':'Hooks',
        'agg:fe:views':'Views',
        'agg:fe:feature-components':'Feature Components',
        'agg:shared:hooks':'Hooks',
        'agg:shared:schema':'Schema',
        'agg:shared:utils':'Utils',
        'agg:shared:utilities':'Utilities'
    };
    if(known[key])return known[key];
    if(key.startsWith('agg:namespace:'))return key.slice('agg:namespace:'.length);
    var routeMatch=key.match(/^agg:route:(.+)$/);
    if(routeMatch){
        var route=normalizeArchitectureRoute(routeMatch[1]);
        return route==='/'?'/':route;
    }
    var analyzerMatch=key.match(/^agg:analyzer:(.+)$/);
    if(analyzerMatch)return titleCaseSegment(analyzerMatch[1])+' Analyzer';
    var feMatch=key.match(/^agg:fe:([^-]+)-(.+)$/);
    if(feMatch)return titleCaseSegment(feMatch[1])+' '+titleCaseSegment(feMatch[2].replace(/-/g,' '));
    var backendMatch=key.match(/^agg:backend:(.+)$/);
    if(backendMatch)return titleCaseSegment(backendMatch[1]);
    return null;
}

export function aggregateArchitectureBlocks(blocks,profile,warnings){
    if(profile==='codeflow')return blocks;
    var merged=Object.create(null);
    var passthrough=[];
    blocks.forEach(function(block){
        var key=getArchitectureAggregateKey(block,profile);
        if(!key){
            passthrough.push(block);
            return;
        }
        if(!merged[key]){
            merged[key]=Object.assign({},block,{files:(block.files||[]).slice(),loc:block.loc||0});
            merged[key].id=makeMermaidSafeId(key);
            var aggregateTitle=resolveAggregateBlockTitle(key);
            if(aggregateTitle)merged[key].title=aggregateTitle;
        }else{
            (block.files||[]).forEach(function(filePath){
                if(merged[key].files.indexOf(filePath)<0)merged[key].files.push(filePath);
            });
            merged[key].loc=(merged[key].loc||0)+(block.loc||0);
            merged[key].modules=Array.from(new Set((merged[key].modules||[]).concat(block.modules||[])));
            merged[key].declarations=(merged[key].declarations||[]).concat(block.declarations||[]);
        }
    });
    var aggregated=Object.keys(merged).map(function(key){
        var block=merged[key];
        if(block.namespace&&passthrough.some(function(other){return other.title===block.title;}))block.title+='.*';
        return block;
    });
    if(aggregated.length+passthrough.length<blocks.length){
        warnings.push('Aggregated '+blocks.length+' architecture files into '+(aggregated.length+passthrough.length)+' diagram blocks for readability.');
    }
    return aggregated.concat(passthrough);
}

export function computeArchitectureHiddenSummary(facts,blocks,includeTests,includeBuildOutput){
    var shownPaths=new Set();
    getVisibleArchitectureBlocks(blocks,includeTests,includeBuildOutput).forEach(function(block){
        (block.files||[]).forEach(function(filePath){shownPaths.add(normalizeArchitecturePath(filePath));});
    });
    var hidden={build:0,tests:0,fixtures:0,lowSignal:0,total:0};
    (facts||[]).forEach(function(fact){
        if(shownPaths.has(fact.path))return;
        if(fact.isBuildOutput){
            hidden.build++;
        }else if(fact.isTest){
            hidden.tests++;
        }else if(fact.isFixture){
            hidden.fixtures++;
        }else{
            hidden.lowSignal++;
        }
        hidden.total++;
    });
    return hidden;
}

export function makeMermaidSafeId(value){
    var safe=String(value||'Block')
        .replace(/[^a-zA-Z0-9_]/g,'_')
        .replace(/^([0-9])/,'_$1')
        .slice(0,80);
    return safe||'Block';
}

export function escapeMermaidLabel(value){
    return String(value||'')
        .replace(/"/g,"'")
        .replace(/\|/g,'/')
        .replace(/\n/g,' ')
        .replace(/\r/g,' ')
        .slice(0,120);
}

export function resolveArchitectureImport(importPath,fromFile,files){
    if(!importPath||/^(react|next|@?vercel|node:|https?:)/.test(importPath))return null;
    var candidates=[];
    if(importPath.startsWith('@/'))candidates.push('src/'+importPath.slice(2));
    if(importPath.startsWith('~/'))candidates.push('src/'+importPath.slice(2));
    if(importPath.startsWith('./')||importPath.startsWith('../')){
        var baseParts=(architectureDirname(fromFile)?architectureDirname(fromFile).split('/'):[]).concat(importPath.split('/'));
        var normalized=[];
        baseParts.forEach(function(part){
            if(!part||part==='.')return;
            if(part==='..')normalized.pop();
            else normalized.push(part);
        });
        candidates.push(normalized.join('/'));
    }
    if(!candidates.length)return null;
    var exts=['','.js','.jsx','.ts','.tsx','.mjs','.cjs','/index.js','/index.jsx','/index.ts','/index.tsx'];
    var pathMap=Object.create(null);
    (files||[]).forEach(function(file){
        var p=normalizeArchitecturePath(file.path||file.name);
        pathMap[p.toLowerCase()]=file.path||file.name;
    });
    for(var i=0;i<candidates.length;i++){
        for(var j=0;j<exts.length;j++){
            var candidate=normalizeArchitecturePath(candidates[i]+exts[j]).toLowerCase();
            if(pathMap[candidate])return normalizeArchitecturePath(pathMap[candidate]);
        }
    }
    return null;
}

export function makeArchitectureBlocks(facts,files,warnings){
    var corePaths=new Set();
    var visiblePaths=new Set();
    facts.forEach(function(fact){
        if(fact.isCore){
            corePaths.add(fact.path);
            visiblePaths.add(fact.path);
        }
    });
    facts.forEach(function(fact){
        if(corePaths.has(fact.path)){
            fact.imports.forEach(function(importPath){
                var resolved=resolveArchitectureImport(importPath,fact.path,files);
                if(resolved)visiblePaths.add(resolved);
            });
        }else{
            fact.imports.forEach(function(importPath){
                var resolved=resolveArchitectureImport(importPath,fact.path,files);
                if(resolved&&corePaths.has(resolved))visiblePaths.add(fact.path);
            });
        }
    });
    var candidates=facts.filter(function(fact){
        if(!shouldShowArchitectureBlock(fact))return false;
        if(fact.isTest||fact.isFixture||fact.isBuildOutput)return true;
        return corePaths.has(fact.path)||visiblePaths.has(fact.path);
    });
    var priority={shell:0,'action-entry':1,page:2,api:3,'database-adapter':4,service:5,component:6,hook:7,module:8,utility:9,test:10,fixture:11};
    function blockPriority(kind){
        return priority[kind]!==undefined?priority[kind]:12;
    }
    candidates.sort(function(a,b){
        return blockPriority(a.kind)-blockPriority(b.kind)||a.path.localeCompare(b.path);
    });
    var usedIds=Object.create(null);
    var profile=(facts[0]&&facts[0].profile)||'generic';
    var blocks=candidates.map(function(fact){
        var baseId=makeMermaidSafeId(fact.path);
        var id=baseId;
        var counter=2;
        while(usedIds[id]){
            id=baseId+'_'+counter;
            counter++;
        }
        usedIds[id]=true;
        return{
            id:id,
            title:architectureTitle(fact),
            modules:fact.modules||[],
            declarations:fact.declarations||[],
            namespace:fact.namespace||null,
            namespaceRoot:fact.namespaceRoot||null,
            kind:fact.kind,
            role:fact.role,
            group:fact.group,
            layer:architectureLayer(fact),
            route:fact.route,
            files:[fact.path],
            profile:profile,
            isTest:!!fact.isTest,
            isFixture:!!fact.isFixture,
            isBuildOutput:!!fact.isBuildOutput,
            loc:fact.loc||0
        };
    });
    if(facts.some(function(fact){return fact.dbUsage;})){
        blocks.push({id:'Storage_Database',title:'Database',kind:'database',role:'database',group:'Storage',layer:'Storage',profile:profile,files:[],isTest:false,isFixture:false,isBuildOutput:false,loc:0});
    }
    blocks=aggregateArchitectureBlocks(blocks,profile,warnings);
    // Roll up sibling leaf modules only when the existing diagram budget needs
    // it. Keep every file and declaration; runtime roles remain separate blocks.
    if(blocks.length>ARCHITECTURE_MAX_BLOCKS){
        var roots={};
        blocks.forEach(function(block){
            if(block.role==='module'&&!block.namespace&&block.namespaceRoot&&!block.isTest&&!block.isFixture){
                (roots[block.namespaceRoot]||(roots[block.namespaceRoot]=[])).push(block);
            }
        });
        Object.keys(roots).sort(function(a,b){return roots[b].length-roots[a].length||a.localeCompare(b);}).forEach(function(root){
            if(blocks.length<=ARCHITECTURE_MAX_BLOCKS||roots[root].length<2)return;
            roots[root].forEach(function(block){block.namespace=root;});
            blocks=aggregateArchitectureBlocks(blocks,profile,warnings);
        });
    }
    return blocks;
}

export function findBlockByFile(blocks,path){
    path=normalizeArchitecturePath(path);
    return (blocks||[]).find(function(block){return (block.files||[]).indexOf(path)>=0;})||null;
}

export function findBlockByRoute(blocks,route){
    route=normalizeArchitectureRoute(route);
    var exact=(blocks||[]).find(function(block){return block.route&&normalizeArchitectureRoute(block.route)===route;});
    if(exact)return exact;
    return (blocks||[]).find(function(block){return block.route&&routeSegmentsMatch(block.route,route);})||null;
}

export function findBlockByComponentName(blocks,name){
    return (blocks||[]).find(function(block){
        if(block.kind!=='component')return false;
        if(block.title===name)return true;
        var file=(block.files&&block.files[0])||'';
        return architectureFileBaseName(file)===name;
    })||null;
}

export function findBlockByRole(blocks,role){
    return (blocks||[]).find(function(block){return block.role===role;})||null;
}

export function findBlockByPathEnds(blocks,suffix){
    suffix=normalizeArchitecturePath(suffix).toLowerCase();
    return (blocks||[]).find(function(block){
        var file=normalizeArchitecturePath((block.files&&block.files[0])||'').toLowerCase();
        return file===suffix||file.endsWith('/'+suffix);
    })||null;
}

export function inferDependencyKind(sourceKind,targetKind){
    if(targetKind==='database')return'database';
    if(sourceKind==='page'&&targetKind==='api')return'api-call';
    if(targetKind==='component')return'renders';
    if(targetKind==='hook')return'uses-hook';
    return'depends-on';
}

export function buildImportBasedDependencies(facts,blocks,files){
    var deps=[];
    facts.forEach(function(fact){
        var source=findBlockByFile(blocks,fact.path);
        if(!source)return;
        fact.imports.forEach(function(importPath){
            var resolved=resolveArchitectureImport(importPath,fact.path,files);
            if(!resolved)return;
            var target=findBlockByFile(blocks,resolved);
            if(!target||target.id===source.id)return;
            deps.push({
                from:source.id,
                to:target.id,
                kind:inferDependencyKind(source.kind,target.kind),
                label:architectureDependencyLabel(source.role,target.role,importPath),
                confidence:'high'
            });
        });
        fact.jsxComponents.forEach(function(componentName){
            var target=findBlockByComponentName(blocks,componentName);
            if(!target||target.id===source.id)return;
            deps.push({from:source.id,to:target.id,kind:'renders',label:'renders '+componentName,confidence:'medium'});
        });
    });
    return deps;
}

export function buildSyntheticArchitectureDependencies(blocks,facts){
    var deps=[];
    var shell=findBlockByRole(blocks,'browser-shell');
    var analyzer=findBlockByRole(blocks,'analyzer-loader')||findBlockByPathEnds(blocks,'card/lib/analyzer.js');
    var collector=findBlockByRole(blocks,'collector')||findBlockByPathEnds(blocks,'card/lib/collect.js');
    var action=findBlockByRole(blocks,'action-entry')||findBlockByPathEnds(blocks,'card/index.js');
    if(shell&&analyzer){
        deps.push({from:shell.id,to:analyzer.id,kind:'runtime',label:architectureDependencyLabel(shell.role,analyzer.role),confidence:'high'});
    }
    if(shell&&collector){
        deps.push({from:shell.id,to:collector.id,kind:'runtime',label:architectureDependencyLabel(shell.role,collector.role),confidence:'high'});
    }
    if(action&&shell){
        deps.push({from:action.id,to:shell.id,kind:'runtime',label:architectureDependencyLabel(action.role,shell.role),confidence:'high'});
    }
    var state=findBlockByRole(blocks,'state')||findBlockByPathEnds(blocks,'card/lib/state.js');
    var pr=findBlockByRole(blocks,'pr')||findBlockByPathEnds(blocks,'card/lib/pr.js');
    var git=findBlockByRole(blocks,'git')||findBlockByPathEnds(blocks,'card/lib/git.js');
    var inputs=findBlockByRole(blocks,'inputs')||findBlockByPathEnds(blocks,'card/lib/inputs.js');
    if(analyzer&&state){
        deps.push({from:analyzer.id,to:state.id,kind:'runtime',label:architectureDependencyLabel('analyzer-loader','state'),confidence:'medium'});
    }
    if(pr&&git){
        deps.push({from:pr.id,to:git.id,kind:'runtime',label:architectureDependencyLabel('pr','git'),confidence:'high'});
    }
    if(action&&collector&&inputs){
        deps.push({from:collector.id,to:inputs.id,kind:'runtime',label:architectureDependencyLabel('collector','inputs'),confidence:'medium'});
    }
    if(action&&collector&&git){
        deps.push({from:collector.id,to:git.id,kind:'runtime',label:architectureDependencyLabel('collector','git'),confidence:'medium'});
    }
    var appShell=findBlockByRole(blocks,'app-shell');
    if(appShell){
        blocks.forEach(function(block){
            if(block.role!=='frontend-route'||block.id===appShell.id)return;
            deps.push({from:appShell.id,to:block.id,kind:'runtime',label:architectureDependencyLabel('app-shell','frontend-route'),confidence:'high'});
        });
    }
    blocks.forEach(function(block){
        if(block.role!=='frontend-route')return;
        var component=blocks.find(function(candidate){
            return candidate.role==='frontend-component'&&candidate.route&&block.route&&normalizeArchitectureRoute(candidate.route)===normalizeArchitectureRoute(block.route);
        });
        if(component&&component.id!==block.id){
            deps.push({from:block.id,to:component.id,kind:'runtime',label:architectureDependencyLabel('frontend-route','frontend-component'),confidence:'high'});
        }
    });
    blocks.forEach(function(block){
        if(block.role!=='frontend-component')return;
        var analyzer=blocks.find(function(candidate){return candidate.role==='platform-analyzer';});
        if(analyzer&&analyzer.id!==block.id){
            deps.push({from:block.id,to:analyzer.id,kind:'runtime',label:architectureDependencyLabel('frontend-component','platform-analyzer'),confidence:'medium'});
        }
    });
    var routesBlock=findBlockByRole(blocks,'backend-routes');
    var middlewareBlock=findBlockByRole(blocks,'backend-middleware');
    var servicesBlock=findBlockByRole(blocks,'backend-services');
    if(routesBlock&&middlewareBlock){
        deps.push({from:routesBlock.id,to:middlewareBlock.id,kind:'runtime',label:architectureDependencyLabel('backend-routes','backend-middleware'),confidence:'medium'});
    }
    if(routesBlock&&servicesBlock){
        deps.push({from:routesBlock.id,to:servicesBlock.id,kind:'runtime',label:architectureDependencyLabel('backend-routes','backend-services'),confidence:'medium'});
    }
    facts.forEach(function(fact){
        if(!fact.isTest)return;
        var source=findBlockByFile(blocks,fact.path);
        if(!source)return;
        var targets=[];
        if(testFileReferencesCore(fact.content)){
            if(shell)targets.push(shell);
            if(analyzer)targets.push(analyzer);
            if(collector)targets.push(collector);
        }
        inferTestTargetPaths(fact.path).forEach(function(suffix){
            var target=findBlockByPathEnds(blocks,suffix);
            if(target)targets.push(target);
        });
        var seen=new Set();
        targets.forEach(function(target){
            if(!target||target.id===source.id||seen.has(target.id))return;
            seen.add(target.id);
            deps.push({from:source.id,to:target.id,kind:'tests',label:'tests',confidence:'high'});
        });
    });
    return deps;
}

export function dedupeArchitectureDependencies(deps){
    var seen=new Set();
    return (deps||[]).filter(function(dep){
        var key=[dep.from,dep.to,dep.kind,dep.label].join('|');
        if(seen.has(key))return false;
        seen.add(key);
        return true;
    });
}

export function buildArchitectureDependencies(facts,blocks,files){
    var deps=[];
    var modulePaths={};
    facts.forEach(function(fact){(fact.modules||[]).forEach(function(name){
        if(!Object.prototype.hasOwnProperty.call(modulePaths,name))modulePaths[name]=fact.path;
        else if(modulePaths[name]!==fact.path)modulePaths[name]=null;
    });});
    facts.forEach(function(fact){
        var source=findBlockByFile(blocks,fact.path);
        if(!source)return;
        (fact.sourceCalls||[]).forEach(function(call){
            var target=findBlockByFile(blocks,modulePaths[call.module]);
            if(target&&target.id!==source.id)deps.push({from:source.id,to:target.id,kind:'source-reference',label:'references',confidence:'high',evidence:'tree-sitter:elixir'});
        });
        (fact.declarations||[]).filter(function(d){return d.kind!=='module';}).forEach(function(d){
            var target=findBlockByFile(blocks,modulePaths[d.module]);
            if(target&&target.id!==source.id)deps.push({from:source.id,to:target.id,kind:d.kind,label:d.kind,confidence:'high',evidence:d.evidence});
        });
        fact.links.forEach(function(link){
            var target=findBlockByRoute(blocks,link);
            if(target&&target.id!==source.id){
                deps.push({from:source.id,to:target.id,kind:'navigation',label:'links '+link,confidence:'high'});
            }
        });
        fact.apiCalls.forEach(function(call){
            var target=findBlockByRoute(blocks,call.url);
            if(target&&target.id!==source.id){
                deps.push({from:source.id,to:target.id,kind:'api-call',label:call.method+' '+call.url,confidence:'high'});
            }
        });
        if(fact.dbUsage){
            deps.push({from:source.id,to:'Storage_Database',kind:'database',label:'queries',confidence:'medium'});
        }
    });
    deps=deps.concat(buildImportBasedDependencies(facts,blocks,files));
    deps=deps.concat(buildSyntheticArchitectureDependencies(blocks,facts));
    return dedupeArchitectureDependencies(deps).filter(function(dep){
        if(!dep.label||/^uses \d+ calls?$/i.test(dep.label))return false;
        return !!findBlockById(blocks,dep.from)&&!!findBlockById(blocks,dep.to);
    });
}

// One directed relationship may have several independent source/compiler
// observations. Project those observations for views without rewriting evidence.
export function groupArchitectureRelationships(dependencies){
    var pairs=new Map();
    (dependencies||[]).forEach(function(observation){
        var key=JSON.stringify([observation.from,observation.to]);
        if(!pairs.has(key))pairs.set(key,{from:observation.from,to:observation.to,kinds:[],labels:[],evidence:[],observations:[]});
        var relationship=pairs.get(key);
        [['kinds','kind'],['labels','label'],['evidence','evidence']].forEach(function(fields){
            var value=observation[fields[1]];
            if(value!=null&&relationship[fields[0]].indexOf(value)<0)relationship[fields[0]].push(value);
        });
        relationship.observations.push(observation);
    });
    return Array.from(pairs.values());
}

export function getRenderedArchitectureDependencies(dependencies,visibleBlockIds){
    var visible=visibleBlockIds||null;
    var priority={high:0,medium:1,low:2};
    return (dependencies||[]).filter(function(dep){
        if(!visible)return true;
        return visible.has(dep.from)&&visible.has(dep.to);
    }).sort(function(a,b){
        return (priority[a.confidence]===undefined?9:priority[a.confidence])-(priority[b.confidence]===undefined?9:priority[b.confidence])||
            String(a.from).localeCompare(String(b.from))||
            String(a.to).localeCompare(String(b.to));
    });
}

export function findBlockById(blocks,id){
    return (blocks||[]).find(function(block){return block.id===id;})||null;
}

export function buildArchitectureGroups(blocks){
    var groups={};
    (blocks||[]).forEach(function(block){
        var key=block.group||block.layer||'Application';
        if(!groups[key])groups[key]=[];
        groups[key].push(block.id);
    });
    return groups;
}

export function formatMermaidBlock(block){
    var label=escapeMermaidLabel(block.title);
    var filePath=(block.files&&block.files[0])||'';
    if(block.modules&&block.modules.length){
        if((block.files||[]).length>1)label+='<br/>'+block.files.length+' files';
    }else if(block.kind==='shell'||block.group==='App Entry / Shell'){
        if(filePath)label+='<br/>'+escapeMermaidLabel(filePath);
        if((block.files||[]).length>1)label+='<br/>'+((block.files||[]).length)+' shell files';
        else if(block.role==='browser-shell'||block.group==='Browser App')label+='<br/>React UI + Worker + Visualization';
    }else if(filePath){
        label+='<br/>'+escapeMermaidLabel(filePath);
    }else if(block.route){
        label+='<br/>'+escapeMermaidLabel(block.route);
    }
    if(block.kind==='database')return '[("'+label+'")]';
    if(block.kind==='api')return '{{"'+label+'"}}';
    return '["'+label+'"]';
}

export function architectureGroupStyleClass(group){
    if(group==='Browser App'||group==='App Entry / Shell')return group==='App Entry / Shell'?'appentry':'browser';
    if(group==='GitHub Action')return'action';
    if(group==='Analysis Core')return'analysis';
    if(group==='Repository Collection')return'collection';
    if(group==='Rendering / Reports')return'rendering';
    if(group==='Frontend Routes / Views'||group==='Frontend Routes')return'frontend';
    if(group==='Frontend Components'||group==='Frontend Page Components')return'fecomponents';
    if(group==='Backend / API Layer'||group==='Backend API / Platform Logic')return'backend';
    if(group==='Services / Business Logic')return'services';
    if(group==='Data / Storage')return'storage';
    if(group==='Shared / Utilities'||group==='Shared Services / Utils')return'shared';
    if(group==='Configuration')return'config';
    if(group==='Content / Data')return'content';
    if(group==='Build Output')return'buildoutput';
    if(group==='Testing')return'testing';
    if(group==='Fixtures / Examples')return'fixtures';
    if(group==='Storage')return'storage';
    return'application';
}

export function getVisibleArchitectureBlocks(blocks,includeTests,includeBuildOutput){
    return (blocks||[]).filter(function(block){
        if(block.isBuildOutput||block.group==='Build Output'||block.role==='build-output')return !!includeBuildOutput;
        if(block.isTest||block.isFixture)return !!includeTests;
        return true;
    });
}

export function computeArchitectureStats(blocks,dependencies){
    var observations=getRenderedArchitectureDependencies(dependencies,new Set(blocks.map(function(block){return block.id;})));
    var relationships=groupArchitectureRelationships(observations);
    return{
        blocks:blocks.length,
        dependencies:relationships.length,
        dependencyObservations:observations.length,
        routes:blocks.filter(function(block){return block.kind==='page'||block.kind==='shell';}).length,
        apiRoutes:blocks.filter(function(block){return block.kind==='api';}).length,
        databaseTouchpoints:relationships.filter(function(relationship){return relationship.kinds.indexOf('database')>=0;}).length
    };
}

export function groupBlocksByArchitectureGroup(blocks,profile){
    var order=getArchitectureGroupOrder(profile||'generic').slice();
    var grouped={};
    order.forEach(function(group){grouped[group]=[];});
    (blocks||[]).forEach(function(block){
        var group=block.group||'Application';
        if(!grouped[group]){grouped[group]=[];order.push(group);}
        grouped[group].push(block);
    });
    return {order:order,grouped:grouped};
}

export function generateMermaidBlockDiagram(diagram,includeTests,includeBuildOutput,compact){
    var allBlocks=diagram.blocks||[];
    var blocks=getVisibleArchitectureBlocks(allBlocks,!!includeTests,!!includeBuildOutput);
    var profile=diagram.profile||'generic';
    if(!blocks.length){
        return [
            'flowchart TD',
            '  classDef application fill:#252529,stroke:#8b8b95,color:#f0f0f2;',
            '  NoArchitecture["No architecture blocks detected"]',
            '  class NoArchitecture application;'
        ].join('\n');
    }
    var visibleIds=new Set(blocks.map(function(block){return block.id;}));
    var lines=[];
    lines.push('%%{init: {"flowchart": {"defaultRenderer": "elk", "nodeSpacing": 45, "rankSpacing": 80}} }%%');
    lines.push('flowchart TB');
    lines.push('  classDef browser fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef action fill:#1f2433,stroke:#7c8cff,color:#f0f0f2;');
    lines.push('  classDef analysis fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef collection fill:#251b33,stroke:#a78bfa,color:#f0f0f2;');
    lines.push('  classDef rendering fill:#2b2414,stroke:#ff9f43,color:#f0f0f2;');
    lines.push('  classDef testing fill:#252529,stroke:#8b8b95,color:#f0f0f2;');
    lines.push('  classDef fixtures fill:#1f2b1f,stroke:#22c55e,color:#f0f0f2;');
    lines.push('  classDef storage fill:#2b2414,stroke:#ff9f43,color:#f0f0f2;');
    lines.push('  classDef application fill:#252529,stroke:#8b8b95,color:#f0f0f2;');
    lines.push('  classDef appentry fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef frontend fill:#102033,stroke:#4d9fff,color:#f0f0f2;');
    lines.push('  classDef fecomponents fill:#152238,stroke:#6eb6ff,color:#f0f0f2;');
    lines.push('  classDef backend fill:#251b33,stroke:#a78bfa,color:#f0f0f2;');
    lines.push('  classDef config fill:#2b2414,stroke:#ff9f43,color:#f0f0f2;');
    lines.push('  classDef content fill:#1f2b1f,stroke:#22c55e,color:#f0f0f2;');
    lines.push('  classDef buildoutput fill:#252529,stroke:#666,color:#aaa;');
    var layout=groupBlocksByArchitectureGroup(blocks,profile);
    layout.order.forEach(function(group){
        if(!layout.grouped[group]||!layout.grouped[group].length)return;
        var subgraphLabel=group;
        if(group==='Testing'&&!includeTests)return;
        if(group==='Testing'&&includeTests)subgraphLabel='Testing - optional';
        if(group==='Build Output'&&!includeBuildOutput)return;
        if(group==='Build Output'&&includeBuildOutput)subgraphLabel='Build Output - optional';
        lines.push('  subgraph '+makeMermaidSafeId(group)+'_Group["'+escapeMermaidLabel(subgraphLabel)+'"]');
        lines.push('    direction TB');
        layout.grouped[group].forEach(function(block){
            lines.push('    '+block.id+formatMermaidBlock(block));
        });
        lines.push('  end');
    });
    var visibleDependencies=getRenderedArchitectureDependencies(diagram.dependencies||[],visibleIds);
    var edges=compact?groupArchitectureRelationships(visibleDependencies):visibleDependencies;
    edges.forEach(function(dep){
        var label=dep.label||dep.kind||'';
        if(!compact&&dep.kind&&label.indexOf(dep.kind)<0)label+=' ('+dep.kind+')';
        lines.push('  '+dep.from+(compact?' --> ':' -->|"'+escapeMermaidLabel(label)+'"| ')+dep.to);
    });
    blocks.forEach(function(block){
        lines.push('  class '+block.id+' '+architectureGroupStyleClass(block.group)+';');
    });
    return lines.join('\n');
}

export function buildArchitectureDiagram(files){
    var warnings=[];
    var framework=detectArchitectureFramework(files);
    var facts=extractArchitectureFacts(files,framework);
    var profile=(facts[0]&&facts[0].profile)||detectArchitectureProfile(files,framework);
    var blocks=makeArchitectureBlocks(facts,files,warnings);
    var dependencies=buildArchitectureDependencies(facts,blocks,files);
    if(framework==='Next.js'&&!blocks.length){
        warnings.push('Next.js was detected, but no page or API route blocks were visible in the analyzed files.');
    }else if(framework!=='Next.js'&&!blocks.length){
        warnings.push('No code files with architecture-significant blocks were visible in the analyzed files.');
    }
    var visibleBlocks=getVisibleArchitectureBlocks(blocks,false,false);
    var visibleIds=new Set(visibleBlocks.map(function(block){return block.id;}));
    var visibleDependencies=(dependencies||[]).filter(function(dep){return visibleIds.has(dep.from)&&visibleIds.has(dep.to);});
    var stats=computeArchitectureStats(visibleBlocks,visibleDependencies);
    stats.warnings=warnings.length;
    var hiddenSummary=computeArchitectureHiddenSummary(facts,blocks,false,false);
    var diagram={
        framework:framework,
        profile:profile,
        type:'block-diagram',
        options:{includeTests:false,includeBuildOutput:false},
        mermaid:'',
        blocks:blocks,
        dependencies:dependencies,
        groups:buildArchitectureGroups(visibleBlocks),
        stats:stats,
        hiddenSummary:hiddenSummary,
        warnings:warnings
    };
    diagram.mermaid=generateMermaidBlockDiagram(diagram,false,false);
    return diagram;
}
