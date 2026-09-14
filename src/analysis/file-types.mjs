// Shared file classification. No syntax runtime or application state.
export const codeExts=['.js','.jsx','.ts','.tsx','.mjs','.cjs','.py','.pyw','.pyi','.java','.go','.rb','.php','.rs','.c','.cpp','.cc','.h','.hpp','.cs','.swift','.kt','.kts','.scala','.clj','.ex','.exs','.erl','.hs','.lua','.r','.R','.jl','.dart','.elm','.fs','.fsx','.ml','.pl','.pm','.sh','.bash','.zsh','.fish','.ps1','.psm1','.groovy','.gradle','.vba','.bas','.cls','.xlsm','.xlam','.xlsb','.xla','.xlw','.pas','.pp','.dpr','.dpk','.lpr','.inc'];

export const scriptContainerExts=['.html','.htm','.xhtml','.vue','.svelte'];

export const textExts=['.md','.markdown','.txt','.json','.jsonl','.yaml','.yml','.toml','.xml','.html','.htm','.css','.scss','.sass','.less','.svg','.graphql','.gql','.sql','.prisma','.proto','.tf','.tfvars','.env','.env.example','.gitignore','.gitattributes','.gitmodules','.eslintrc','.prettierrc','.babelrc','.editorconfig','.ini','.cfg','.conf','.properties','.lock','.csv','.tsv','.rst','.tex','.cmake','.rake','.vba','.bas','.cls','.xlsm','.xlam','.xlsb','.xla','.xlw','.mod','.sum'];

export const textNames=['dockerfile','containerfile','makefile','rakefile','gemfile','podfile','pipfile','procfile','brewfile','justfile','taskfile','cmakelists.txt','license','copying','notice','readme','changelog','authors','contributors','owners','codeowners','go.mod','go.sum'];

export const binExts=['.png','.jpg','.jpeg','.gif','.ico','.webp','.bmp','.svg','.woff','.woff2','.ttf','.eot','.otf','.pdf','.zip','.tar','.gz','.rar','.7z','.exe','.dll','.so','.dylib','.bin','.dat','.db','.sqlite','.mp3','.mp4','.wav','.avi','.mov','.webm'];

export function isCode(n){
        var lower=n.toLowerCase();
        return codeExts.some(function(e){return lower.endsWith(e);})||
            scriptContainerExts.some(function(e){return lower.endsWith(e);});
    }

export function isText(n){
        var lower=n.toLowerCase();
        return textExts.some(function(e){return lower.endsWith(e);})||textNames.indexOf(lower)>=0;
    }

export function isBinary(n){return binExts.some(function(e){return n.toLowerCase().endsWith(e);});}

export function isIncluded(n){return !isBinary(n)&&(isCode(n)||isText(n));}

export function isScriptContainer(n){return scriptContainerExts.some(function(e){return n.toLowerCase().endsWith(e);});}

export function isVBA(n){return ['.vba','.bas','.cls','.xlsm','.xlam','.xlsb','.xla','.xlw'].some(function(e){return n.toLowerCase().endsWith(e);});}

export function isPascal(n){return ['.pas','.pp','.dpr','.dpk','.lpr','.inc'].some(function(e){return n.toLowerCase().endsWith(e);});}

export function isHTML(n){return ['.html','.htm','.xhtml'].some(function(e){return n.toLowerCase().endsWith(e);});}

export function isCSS(n){return ['.css','.scss','.sass','.less'].some(function(e){return n.toLowerCase().endsWith(e);});}

export function isJSON(n){return ['.json'].some(function(e){return n.toLowerCase().endsWith(e);});}

export function isElixir(filename){return /\.exs?$/.test(filename||'');}

export function isMarkdown(n){return ['.md','.markdown'].some(function(e){return n.toLowerCase().endsWith(e);});}

export function isTestFile(path){
        var p=String(path||'').replace(/\\/g,'/');
        var lower=p.toLowerCase();
        if(/(^|\/)(tests?|spec|specs|__tests__)\//.test(lower))return true;
        if(/\.(test|spec)\.[a-z]+$/.test(lower))return true;
        if(/_(test|spec)\.(rb|go|py|exs|ex|cr|php|rs)$/.test(lower))return true;
        if(/(^|\/)test_[^\/]*\.py$/.test(lower))return true;
        if(/(^|\/)conftest\.py$/.test(lower))return true;
        if(/(Test|Tests|Spec)\.(java|kt|kts|scala|cs|groovy|swift)$/.test(p))return true;
        return false;
    }

export function detectLayer(p){
        // Prepend a leading slash so root-level layer folders (e.g. "services/x.ts")
        // match the same substring patterns as nested ones (e.g. "src/services/x.ts").
        var l='/'+p.toLowerCase().replace(/^\/+/,'');
        // Test files
        if(l.includes('/test')||l.match(/test_\w+\.py$/)||l.match(/\w+_test\.py$/)||l.includes('conftest'))return'test';
        // UI/View layer
        if(l.includes('/ui/')||l.includes('/views/')||l.includes('/pages/')||l.includes('/templates/')||l.includes('/static/'))return'ui';
        if(l.includes('/component'))return'components';
        // Service/API layer
        if(l.includes('/service')||l.includes('/api/')||l.includes('/controller')||l.includes('/endpoint')||l.includes('/router'))return'services';
        // Python middleware/handler layer
        if(l.includes('/middleware')||l.includes('/handler')||l.includes('/signal'))return'services';
        // Utility/Helper layer
        if(l.includes('/util')||l.includes('/helper')||l.includes('/lib/')||l.includes('/common/'))return'utils';
        // Data/Model layer
        if(l.includes('/data')||l.includes('/model')||l.includes('/store')||l.includes('/schema')||l.includes('/serializer'))return'data';
        // Python-specific data layers
        if(l.includes('/migration'))return'data';
        if(l.includes('/fixtures/'))return'data';
        // Task/Worker layer
        if(l.includes('/task')||l.includes('/worker')||l.includes('/celery')||l.includes('/job'))return'services';
        // Config layer
        if(l.includes('/config')||l.includes('/settings')||l.match(/settings\.py$/))return'config';
        // VBA-specific layer detection
        if(l.includes('/modules/')||l.includes('/bas/'))return'modules';
        if(l.includes('/forms/')||l.includes('/userforms/'))return'ui';
        if(l.includes('/classes/'))return'data';
        if(l.includes('/standard/'))return'utils';
        return'utils';
    }

export function normalizeArchitecturePath(value){
    return (value||'').replace(/\\/g,'/').replace(/^\/+/,'').replace(/\/{2,}/g,'/');
}

export function isArchitectureBuildOutput(path,name){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    var base=String(name||p.split('/').pop()||'').toLowerCase();
    if(/(^|\/)out(\/|$)/.test(p)||/(^|\/)dist(\/|$)/.test(p)||/(^|\/)build(\/|$)/.test(p)||/(^|\/)coverage(\/|$)/.test(p))return true;
    if(/(^|\/)\.next(\/|$)/.test(p)||/(^|\/)\.nuxt(\/|$)/.test(p)||/(^|\/)\.output(\/|$)/.test(p))return true;
    if(/^page-[a-f0-9]{6,}/i.test(base)||/^layout-[a-f0-9]{6,}/i.test(base))return true;
    if(/\/page-[a-f0-9]{6,}\//i.test(p)||/\/layout-[a-f0-9]{6,}\//i.test(p))return true;
    if(/(^|\/)404\/index\.html?$/i.test(p)&&/(^|\/)out\//i.test(p))return true;
    return false;
}

export function isArchitectureTestFile(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    return isTestFile(p)||/\.smoke\.(js|mjs|cjs)$/.test(p);
}

export function isArchitectureFixtureFile(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    return /(^|\/)fixtures(\/|$)/.test(p)||/(^|\/)__fixtures__(\/|$)/.test(p);
}

export function isDocumentationPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(/(^|\/)docs?(\/|$)/.test(p))return true;
    if(/\.(md|markdown|mdx)$/.test(p))return true;
    return false;
}

export function isDevToolingPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(/(^|\/)\.github(\/|$)/.test(p))return true;
    if(/(^|\/)\.claude(\/|$)/.test(p))return true;
    if(/(^|\/)(scripts|tools|tooling)(\/|$)/.test(p))return true;
    return false;
}

export function isSecretScanExemptPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(isArchitectureTestFile(p))return true;
    if(isArchitectureFixtureFile(p))return true;
    if(isDocumentationPath(p))return true;
    return false;
}

export function isNonProductionPath(path){
    var p=String(path||'').toLowerCase().replace(/\\/g,'/');
    if(isSecretScanExemptPath(p))return true;
    if(isDevToolingPath(p))return true;
    return false;
}

export function isArchitectureBackendPath(path){
    var p=normalizeArchitecturePath(path).toLowerCase();
    if(/(^|\/)(a-)?backend(\/|$)/.test(p))return true;
    if(/(^|\/)server(\/|$)/.test(p))return true;
    if(/(^|\/)workers?(\/|$)/.test(p))return true;
    if(/(^|\/)functions(\/|$)/.test(p))return true;
    if(/(^|\/)lambda(\/|$)/.test(p))return true;
    if(/^src\/app\/api\//.test(p))return false;
    var segments=p.split('/').filter(Boolean);
    for(var i=0;i<segments.length;i++){
        var seg=segments[i];
        if(seg==='middleware'||seg==='controllers'||seg==='handlers')return true;
        if(seg==='routes'||seg==='services'){
            if(i===0)return true;
            var prev=segments[i-1];
            if(prev==='backend'||prev==='a-backend'||prev==='server'||prev==='api')return true;
        }
    }
    return false;
}
