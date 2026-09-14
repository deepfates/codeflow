import {createNativeCanvas} from '../views/native-canvas.mjs';
import {indexRuntime} from '../project/runtime-index.mjs';
import {createInspectionPanels} from '../views/inspection.mjs';
import {createRuntimeInspectionHook} from './runtime-inspection.mjs';
import {createGraph3DView} from '../views/graph3d.mjs';
import {createArchitectureView} from '../views/architecture.mjs';
import {createProjectLoading} from '../project/loading.mjs';
import {createLocalTools} from '../project/local-tools.mjs';
import {createProjectSource} from '../project/access.mjs';
import {subscribeCliAnalysis} from '../project/cli-analysis.mjs';
import {exportAnalysis} from '../project/export.mjs';
import {highlightSyntax} from '../views/highlight.mjs';
import {createInvestigationState,reduceInvestigation} from '../investigation/state.mjs';
import {LINE_THICKNESS_MIN,LINE_THICKNESS_MAX,readUiPrefs,persistUiPrefs} from '../investigation/preferences.mjs';
import {scaleStrokeWidth} from '../views/graph-style.mjs';
import {newLocalSelectionId,localFolderCacheMeta,cliWatchCacheMeta,zipArchiveCacheMeta,retainedFolderMatchesRecord,cliRecordMatchesStatus,zipFileIdentity,retainedZipMatchesRecord,githubCacheSourceKey,githubSourceKeyForLoadedAnalysis,cachedAnalysisMatchesExcludes,githubZipDownloadUrl,analysisCacheKey,analysisGraphKey,analysisHydrationIdFromParts,loadedAnalysisSourceIdentity} from '../project/identity.mjs';
import {asCodeLines,nextCodeSourceReads,fileHasLoadedSource,clearCodeSourceFailure,recordCodeSourceFailureIfCurrent,clearCodeSourceFailureIfCurrent,filesNeedingSource,mergeHydratedFileSources} from '../project/source.mjs';
import {CLI_WATCH_DIFF_MS,normalizeCliWatchPath,noteCliWatchPath,noteCliWatchDuringEvent,cliWatchSnapRevFromResponse,forgetCliWatchPath,analyzedFileForCliWatchPath,cliWatchLiveClearsDirty,mergeCliLiveContents,cliWatchDiffPaths,startedCliWatchDiffPaths,bumpCliWatchDiffEpoch,cliWatchDiffRequestIsCurrent,retainCliWatchPathsAfterAnalysis,cliWatchLiveRejectsOversized,cliWatchLiveFromResponse,shouldApplyCliWatchLive,pendingCliWatchDiffPaths,cliWatchAppliesToAnalysis} from '../project/changes.mjs';

import {formatRecentTime,armRecentDelete,buildRecentAnalysisRecord,compactAnalysisForCache,listRecentAnalyses,getRecentAnalysis,deleteRecentAnalysis,saveRecentAnalysis} from '../investigation/recent-analyses.mjs';
import {searchProject,folderFilterAfterCodeNav,filesForOpenedCodePaths} from '../investigation/navigation.mjs';
import {restoreWorkspace} from '../investigation/workspace.mjs';
import {codeFileNavOpensCard,graphSvgExportEnabled,vizUsesLineThickness,vizHasGraphToolbar} from '../views/capabilities.mjs';

import {snapshotZoomTransform} from '../views/camera.mjs';

import {groupArchitectureRelationships,findBlockById,getVisibleArchitectureBlocks,computeArchitectureStats,groupBlocksByArchitectureGroup,generateMermaidBlockDiagram} from '../analysis/architecture.mjs';
import {buildBeamAnalysisData,enrichAnalysisFindings} from '../analysis/evidence.mjs';
import {calcBlast,calcHealth} from '../analysis/metrics.mjs';
import {DEFAULT_EXCLUDE_CHIPS,parseExcludePatterns,compileExcludePatterns,filterAnalyzableLocalFiles} from '../project/exclusions.mjs';
import {countFiles} from '../project/tree.mjs';
import {collectDirectory,collectSelectedFiles,collectArchive,readCollectedFiles} from '../project/collection.mjs';
import {renderTooltipHtml} from './html.mjs';
import {yieldToBrowser} from './scheduling.mjs';
import {createParser} from '../analysis/parser.mjs';
import {createProjectAnalyzer} from '../analysis/project.mjs';
import {browserSyntaxRuntime} from './syntax-runtime.mjs';
import {createAnalysisClient} from './analysis-client.mjs';
import {createGitHubAdapter} from '../project/github.mjs';
const Parser=createParser(browserSyntaxRuntime({TreeSitter:globalThis.TreeSitter,acorn:globalThis.acorn,Babel:globalThis.Babel}));
const {analyzeFiles}=createProjectAnalyzer(Parser);
const runAnalysisData=createAnalysisClient({analyzeFiles,yieldFn:yieldToBrowser});
const GitHub=createGitHubAdapter({KJUR:globalThis.KJUR});

const{useState,useReducer,useEffect,useLayoutEffect,useRef,useMemo,useCallback}=React;
const {SourceNavigation,AnalysisTools,SourceProcesses,RuntimePanel}=createInspectionPanels(React);
const useRuntimeInspection=createRuntimeInspectionHook(React);
const ArchitectureView=createArchitectureView({React,mermaid:globalThis.mermaid});
const COLORS=['#4d9fff','#a78bfa','#22d3ee','#00ff9d','#ff9f43','#ec4899','#ff5f5f','#84cc16'];
const LAYER_COLORS={ui:'#4d9fff',components:'#22d3ee',services:'#a78bfa',utils:'#00ff9d',data:'#ff9f43',config:'#ec4899',test:'#f59e0b',modules:'#a78bfa',forms:'#22d3ee',classes:'#ff9f43',note:'#c084fc'};
const NativeCanvas=createNativeCanvas({React,d3:globalThis.d3,Icon,COLORS,LAYER_COLORS});
const Graph3DView=createGraph3DView({React,getRuntime:()=>({ForceGraph3D:globalThis.ForceGraph3D,THREE:globalThis.THREE}),colors:COLORS,layerColors:LAYER_COLORS});

const ANALYSIS_LIMITS={repoSoft:300,localSoft:500};

// Secrets are dangerous wherever the code executes — CI workflows, hooks and
// deploy scripts included — so the Hardcoded Secret rule exempts only
// tests/fixtures (stub credentials) and docs (examples), NOT dev tooling.

// Elixir declarations are supplied by the shared Tree-sitter analysis. These
// enrich the same facts, blocks and exports as every other language.

// One directed relationship may have several independent source/compiler
// observations. Project those observations for views without rewriting evidence.

// Enrich the shared source analysis with compiler evidence. A compiler snapshot
// describes file references, not function liveness, and never replaces source
// analysis or evidence from another provider.

// Provider findings use the existing issue model, so navigation and exports
// consume the same evidence. A refresh replaces only that provider's findings.

// Locations own path, source range, view, scope and camera. These transitions
// return new snapshots; UI event handlers never mutate older history entries.

function calcPRRisk(prData, repoData) {
    if (!prData || !repoData) return { score: 0, level: 'low', factors: [] };
    var score = 0;
    var factors = [];
    var changedFiles = prData.files || [];
    var totalBlast = 0;
    var hotspots = [];
    changedFiles.forEach(function(f) {
        var existing = repoData.files.find(function(df) { return df.path === f.filename; });
        if (existing) {
            var blast = calcBlast(f.filename, repoData.connections, repoData.files);
            totalBlast += blast.count;
            if (blast.count > 5) hotspots.push({ file: f.filename, blast: blast.count });
        }
    });
    if (totalBlast > 50) { score += 30; factors.push('High blast radius (' + totalBlast + ' files)'); }
    else if (totalBlast > 20) { score += 15; factors.push('Moderate blast radius'); }
    if (changedFiles.length > 10) { score += 20; factors.push('Many files changed (' + changedFiles.length + ')'); }
    else if (changedFiles.length > 5) { score += 10; factors.push('Several files changed'); }
    var totalChanges = (prData.additions || 0) + (prData.deletions || 0);
    if (totalChanges > 500) { score += 25; factors.push('Large changeset (' + totalChanges + ' lines)'); }
    else if (totalChanges > 200) { score += 12; factors.push('Moderate changeset'); }
    var coreFiles = changedFiles.filter(function(f) { return f.filename.includes('/core/') || f.filename.includes('/utils/') || f.filename.includes('/lib/'); });
    if (coreFiles.length > 0) { score += 15; factors.push('Core files modified (' + coreFiles.length + ')'); }
    var configFiles = changedFiles.filter(function(f) { return f.filename.match(/\.(json|yaml|yml|toml|env)$/); });
    if (configFiles.length > 0) { score += 10; factors.push('Config files changed'); }
    score = Math.min(100, score);
    var level = score >= 70 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low';
    return { score: score, level: level, factors: factors, totalBlast: totalBlast, hotspots: hotspots.sort(function(a,b){ return b.blast - a.blast; }).slice(0, 5) };
}

function findSuggestedReviewers(prData, repoData) {
    if (!prData || !repoData) return [];
    var changedPaths = (prData.files || []).map(function(f) { return f.filename; });
    var authorCounts = {};
    repoData.files.forEach(function(f) {
        if (changedPaths.some(function(p) { return f.folder && p.startsWith(f.folder); })) {
            var layer = f.layer || 'other';
            if (!authorCounts[layer]) authorCounts[layer] = { count: 0, files: [] };
            authorCounts[layer].count++;
            authorCounts[layer].files.push(f.name);
        }
    });
    var reviewers = [];
    Object.entries(authorCounts).sort(function(a,b) { return b[1].count - a[1].count; }).slice(0, 3).forEach(function(entry, i) {
        reviewers.push({ name: entry[0].charAt(0).toUpperCase() + entry[0].slice(1) + ' Expert', reason: 'Knows ' + entry[1].count + ' files in ' + entry[0], avatar: COLORS[i % COLORS.length] });
    });
    return reviewers;
}

function findTestImpact(prData, repoData) {
    if (!prData || !repoData) return [];
    var changedFiles = (prData.files || []).map(function(f) { return f.filename; });
    var testFiles = repoData.files.filter(function(f) { return f.name.match(/\.test\.|\.spec\.|_test\.|test_/i); });
    var impacted = [];
    testFiles.forEach(function(tf) {
        var shouldRun = changedFiles.some(function(cf) {
            var cfBase = cf.replace(/\.[^.]+$/, '').split('/').pop();
            return tf.name.toLowerCase().includes(cfBase.toLowerCase());
        });
        if (shouldRun) impacted.push({ file: tf.name, path: tf.path });
    });
    if (impacted.length === 0 && testFiles.length > 0) {
        impacted = testFiles.slice(0, 3).map(function(tf) { return { file: tf.name, path: tf.path, suggested: true }; });
    }
    return impacted;
}

function findDependencyChains(prData, repoData) {
    if (!prData || !repoData) return [];
    var changedFiles = (prData.files || []).map(function(f) { return f.filename; });
    var chains = [];
    changedFiles.slice(0, 3).forEach(function(file) {
        var chain = [file.split('/').pop()];
        var visited = new Set([file]);
        var queue = [file];
        var depth = 0;
        while (queue.length > 0 && depth < 3) {
            var current = queue.shift();
            repoData.connections.forEach(function(c) {
                var src = typeof c.source === 'object' ? c.source.id : c.source;
                var tgt = typeof c.target === 'object' ? c.target.id : c.target;
                if (tgt === current && !visited.has(src)) {
                    visited.add(src);
                    chain.push(src.split('/').pop());
                    queue.push(src);
                }
            });
            depth++;
        }
        if (chain.length > 1) chains.push(chain.slice(0, 5));
    });
    return chains;
}

function Icon(props){
    var name=props.name||'file';
    var size=props.size||'m';
    var className='icon icon-'+size+(props.className?' '+props.className:'');
    var common={fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round'};
    var children;
    switch(name){
        case 'logo':
        case 'bolt':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M13 2 4 14h6l-1 8 9-12h-6l1-8z'},common))];
            break;
        case 'search':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'11',cy:'11',r:'7'},common)),React.createElement('line',Object.assign({key:'l1',x1:'20',y1:'20',x2:'16.65',y2:'16.65'},common))];
            break;
        case 'folder':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z'},common))];
            break;
        case 'folder-open':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M3 9.5A1.5 1.5 0 0 1 4.5 8H9l2 2h8.5A1.5 1.5 0 0 1 21 11.5V12'},common)),React.createElement('path',Object.assign({key:'p2',d:'M4 12.5h17l-1.5 5A2 2 0 0 1 17.58 19H5.92A2 2 0 0 1 4 17.5z'},common))];
            break;
        case 'file':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'14 3 14 8 19 8'},common))];
            break;
        case 'file-pdf':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'14 3 14 8 19 8'},common)),React.createElement('path',Object.assign({key:'p3',d:'M8 13h8M8 17h5'},common))];
            break;
        case 'layers':
            children=[React.createElement('polygon',Object.assign({key:'p1',points:'12 3 3 8 12 13 21 8 12 3'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'3 12 12 17 21 12'},common)),React.createElement('polyline',Object.assign({key:'p3',points:'3 16 12 21 21 16'},common))];
            break;
        case 'activity':
            children=[React.createElement('polyline',Object.assign({key:'p1',points:'3 12 8 12 11 6 14 18 17 12 21 12'},common))];
            break;
        case 'shield':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z'},common))];
            break;
        case 'lock':
            children=[React.createElement('rect',Object.assign({key:'r1',x:'5',y:'11',width:'14',height:'10',rx:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M8 11V8a4 4 0 0 1 8 0v3'},common))];
            break;
        case 'factory':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M3 21h18'},common)),React.createElement('path',Object.assign({key:'p2',d:'M5 21V9l5 3V9l5 3V6l4 2v13'},common)),React.createElement('path',Object.assign({key:'p3',d:'M15 6V3h3v5'},common))];
            break;
        case 'eye':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z'},common)),React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'3'},common))];
            break;
        case 'hook':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M9 10V7a3 3 0 0 1 6 0v7a4 4 0 1 1-8 0v-1'},common))];
            break;
        case 'spark':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z'},common)),React.createElement('path',Object.assign({key:'p2',d:'M19 15l.8 1.7L21.5 18l-1.7.8L19 20.5l-.8-1.7L16.5 18l1.7-.8z'},common))];
            break;
        case 'globe':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'9'},common)),React.createElement('path',Object.assign({key:'p1',d:'M3 12h18'},common)),React.createElement('path',Object.assign({key:'p2',d:'M12 3a15 15 0 0 1 0 18'},common)),React.createElement('path',Object.assign({key:'p3',d:'M12 3a15 15 0 0 0 0 18'},common))];
            break;
        case 'layout':
            children=[React.createElement('rect',Object.assign({key:'r1',x:'3',y:'4',width:'18',height:'16',rx:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M9 4v16'},common)),React.createElement('path',Object.assign({key:'p2',d:'M9 10h12'},common))];
            break;
        case 'box':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M21 8.5 12 3 3 8.5 12 14z'},common)),React.createElement('path',Object.assign({key:'p2',d:'M3 8.5V16l9 5 9-5V8.5'},common)),React.createElement('path',Object.assign({key:'p3',d:'M12 14v7'},common))];
            break;
        case 'archive':
            children=[React.createElement('rect',Object.assign({key:'r1',x:'3',y:'3',width:'18',height:'5',rx:'1'},common)),React.createElement('path',Object.assign({key:'p1',d:'M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8'},common)),React.createElement('path',Object.assign({key:'p2',d:'M10 12h4'},common))];
            break;
        case 'building':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M4 21h16'},common)),React.createElement('path',Object.assign({key:'p2',d:'M7 21V8l5-5 5 5v13'},common)),React.createElement('path',Object.assign({key:'p3',d:'M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01'},common))];
            break;
        case 'route':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'6',cy:'18',r:'2'},common)),React.createElement('circle',Object.assign({key:'c2',cx:'18',cy:'6',r:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M8 18h4a4 4 0 0 0 4-4V8'},common))];
            break;
        case 'database':
            children=[React.createElement('ellipse',Object.assign({key:'e1',cx:'12',cy:'5',rx:'7',ry:'3'},common)),React.createElement('path',Object.assign({key:'p1',d:'M5 5v10c0 1.7 3.1 3 7 3s7-1.3 7-3V5'},common)),React.createElement('path',Object.assign({key:'p2',d:'M5 10c0 1.7 3.1 3 7 3s7-1.3 7-3'},common)),React.createElement('path',Object.assign({key:'p3',d:'M5 15c0 1.7 3.1 3 7 3s7-1.3 7-3'},common))];
            break;
        case 'refresh':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M20 11a8 8 0 0 0-14.9-3'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'4 4 5 8 9 7'},common)),React.createElement('path',Object.assign({key:'p3',d:'M4 13a8 8 0 0 0 14.9 3'},common)),React.createElement('polyline',Object.assign({key:'p4',points:'20 20 19 16 15 17'},common))];
            break;
        case 'puzzle':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M10 4H6a2 2 0 0 0-2 2v4h2a2 2 0 1 1 0 4H4v4a2 2 0 0 0 2 2h4v-2a2 2 0 1 1 4 0v2h4a2 2 0 0 0 2-2v-4h-2a2 2 0 1 1 0-4h2V6a2 2 0 0 0-2-2h-4v2a2 2 0 1 1-4 0z'},common))];
            break;
        case 'radio':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M16.24 7.76a6 6 0 0 1 0 8.48'},common)),React.createElement('path',Object.assign({key:'p2',d:'M7.76 16.24a6 6 0 0 1 0-8.48'},common)),React.createElement('path',Object.assign({key:'p3',d:'M19.07 4.93a10 10 0 0 1 0 14.14'},common)),React.createElement('path',Object.assign({key:'p4',d:'M4.93 19.07a10 10 0 0 1 0-14.14'},common))];
            break;
        case 'link':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M10 13a5 5 0 0 1 0-7l1.5-1.5a5 5 0 0 1 7 7L17 13'},common)),React.createElement('path',Object.assign({key:'p2',d:'M14 11a5 5 0 0 1 0 7L12.5 19.5a5 5 0 0 1-7-7L7 11'},common))];
            break;
        case 'warning':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M12 4 3 20h18L12 4z'},common)),React.createElement('path',Object.assign({key:'p2',d:'M12 9v5'},common)),React.createElement('path',Object.assign({key:'p3',d:'M12 17h.01'},common))];
            break;
        case 'scroll':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M7 3h10a2 2 0 0 1 2 2v12a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V5a2 2 0 0 1 2-2z'},common)),React.createElement('path',Object.assign({key:'p2',d:'M9 8h6M9 12h6M9 16h4'},common))];
            break;
        case 'broom':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M14 4 6 12'},common)),React.createElement('path',Object.assign({key:'p2',d:'m11 7 6 6'},common)),React.createElement('path',Object.assign({key:'p3',d:'M3 14h7l3 7H6z'},common))];
            break;
        case 'split':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M8 4H5a2 2 0 0 0-2 2v3'},common)),React.createElement('path',Object.assign({key:'p2',d:'M16 20h3a2 2 0 0 0 2-2v-3'},common)),React.createElement('path',Object.assign({key:'p3',d:'M12 4v16'},common)),React.createElement('path',Object.assign({key:'p4',d:'M9 8 12 5 15 8'},common)),React.createElement('path',Object.assign({key:'p5',d:'M15 16 12 19 9 16'},common))];
            break;
        case 'copy':
            children=[React.createElement('rect',Object.assign({key:'r1',x:'9',y:'9',width:'11',height:'11',rx:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'},common))];
            break;
        case 'beaker':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M10 3v5l-5 8a3 3 0 0 0 2.57 4.5h8.86A3 3 0 0 0 19 16l-5-8V3'},common)),React.createElement('path',Object.assign({key:'p2',d:'M8 13h8'},common))];
            break;
        case 'ban':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'9'},common)),React.createElement('path',Object.assign({key:'p1',d:'M5 19 19 5'},common))];
            break;
        case 'key':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'8',cy:'15',r:'4'},common)),React.createElement('path',Object.assign({key:'p1',d:'M12 15h9'},common)),React.createElement('path',Object.assign({key:'p2',d:'M18 12v6'},common)),React.createElement('path',Object.assign({key:'p3',d:'M21 13v4'},common))];
            break;
        case 'pull-request':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'6',cy:'5',r:'2'},common)),React.createElement('circle',Object.assign({key:'c2',cx:'18',cy:'7',r:'2'},common)),React.createElement('circle',Object.assign({key:'c3',cx:'18',cy:'19',r:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M8 5h4a4 4 0 0 1 4 4v8'},common)),React.createElement('path',Object.assign({key:'p2',d:'M16 9V7'},common))];
            break;
        case 'export':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M12 3v12'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'8 7 12 3 16 7'},common)),React.createElement('path',Object.assign({key:'p3',d:'M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5'},common))];
            break;
        case 'share':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'18',cy:'5',r:'2'},common)),React.createElement('circle',Object.assign({key:'c2',cx:'6',cy:'12',r:'2'},common)),React.createElement('circle',Object.assign({key:'c3',cx:'18',cy:'19',r:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M8 12 16 6'},common)),React.createElement('path',Object.assign({key:'p2',d:'M8 12 16 18'},common))];
            break;
        case 'close':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M6 6l12 12'},common)),React.createElement('path',Object.assign({key:'p2',d:'M18 6 6 18'},common))];
            break;
        case 'settings':
            children=[
                React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'3.2'},common)),
                React.createElement('path',Object.assign({key:'p1',d:'M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1.02 1.53V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.02-1.53 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.53-1.02H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.92 4.6 1.7 1.7 0 0 0 9.94 3.08V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.02 1.53 1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 8.98c.22.31.36.66.4 1.02H20a2 2 0 1 1 0 4h-.09c-.04.36-.18.71-.4 1.02z'},common))
            ];
            break;
        case 'sun':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'4'},common)),React.createElement('path',Object.assign({key:'p1',d:'M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41'},common))];
            break;
        case 'moon':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z'},common))];
            break;
        case 'graph':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'5',cy:'17',r:'2'},common)),React.createElement('circle',Object.assign({key:'c2',cx:'12',cy:'7',r:'2'},common)),React.createElement('circle',Object.assign({key:'c3',cx:'19',cy:'14',r:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M6.7 15.6 10.3 8.4M13.8 8.1l3.4 4.8'},common))];
            break;
        case 'treemap':
            children=[React.createElement('rect',Object.assign({key:'r1',x:'3',y:'3',width:'18',height:'18',rx:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M10 3v18M10 10h11M3 14h7'},common))];
            break;
        case 'matrix':
            children=[React.createElement('rect',Object.assign({key:'r1',x:'4',y:'4',width:'16',height:'16',rx:'2'},common)),React.createElement('path',Object.assign({key:'p1',d:'M4 10h16M4 14h16M10 4v16M14 4v16'},common))];
            break;
        case 'tree':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M12 3v18'},common)),React.createElement('path',Object.assign({key:'p2',d:'M12 7 7 12M12 9l5 5M12 14l-4 5M12 16l4 5'},common)),React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'3',r:'2'},common)),React.createElement('circle',Object.assign({key:'c2',cx:'7',cy:'12',r:'2'},common)),React.createElement('circle',Object.assign({key:'c3',cx:'17',cy:'14',r:'2'},common)),React.createElement('circle',Object.assign({key:'c4',cx:'8',cy:'19',r:'2'},common)),React.createElement('circle',Object.assign({key:'c5',cx:'16',cy:'21',r:'2'},common))];
            break;
        case 'flow':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M4 7h10'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'11 4 14 7 11 10'},common)),React.createElement('path',Object.assign({key:'p3',d:'M4 17h16'},common)),React.createElement('polyline',Object.assign({key:'p4',points:'17 14 20 17 17 20'},common))];
            break;
        case 'cluster':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'8',cy:'8',r:'3'},common)),React.createElement('circle',Object.assign({key:'c2',cx:'16',cy:'8',r:'3'},common)),React.createElement('circle',Object.assign({key:'c3',cx:'12',cy:'16',r:'3'},common)),React.createElement('path',Object.assign({key:'p1',d:'M10.5 10.5 11.5 13.5M13.5 13.5l1-3'},common))];
            break;
        case 'target':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'8'},common)),React.createElement('circle',Object.assign({key:'c2',cx:'12',cy:'12',r:'4'},common)),React.createElement('circle',Object.assign({key:'c3',cx:'12',cy:'12',r:'1'},common))];
            break;
        case 'impact':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'3'},common)),React.createElement('path',Object.assign({key:'p1',d:'M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8'},common))];
            break;
        case 'users':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2'},common)),React.createElement('circle',Object.assign({key:'c1',cx:'9.5',cy:'8',r:'3'},common)),React.createElement('path',Object.assign({key:'p2',d:'M20 21v-2a4 4 0 0 0-3-3.87'},common)),React.createElement('path',Object.assign({key:'p3',d:'M14.5 5.2a3 3 0 0 1 0 5.6'},common))];
            break;
        case 'action':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2'},common))];
            break;
        case 'image':
            children=[React.createElement('rect',Object.assign({key:'r1',x:'3',y:'5',width:'18',height:'14',rx:'2'},common)),React.createElement('circle',Object.assign({key:'c1',cx:'9',cy:'10',r:'1.5'},common)),React.createElement('path',Object.assign({key:'p1',d:'M21 16l-5-5-5 6-2-2-6 5'},common))];
            break;
        case 'note':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M6 3h9l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z'},common)),React.createElement('path',Object.assign({key:'p2',d:'M15 3v4h4'},common)),React.createElement('path',Object.assign({key:'p3',d:'M8 12h8M8 16h6'},common))];
            break;
        case 'code':
            children=[React.createElement('polyline',Object.assign({key:'p1',points:'8 8 4 12 8 16'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'16 8 20 12 16 16'},common)),React.createElement('path',Object.assign({key:'p3',d:'M13 6 11 18'},common))];
            break;
        case 'clock':
            children=[React.createElement('circle',Object.assign({key:'c1',cx:'12',cy:'12',r:'9'},common)),React.createElement('path',Object.assign({key:'p1',d:'M12 7v6l4 2'},common))];
            break;
        case 'trash':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M4 7h16'},common)),React.createElement('path',Object.assign({key:'p2',d:'M9 7V5h6v2'},common)),React.createElement('path',Object.assign({key:'p3',d:'M7 7l1 13h8l1-13'},common))];
            break;
        case 'brush':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M18 3a3 3 0 0 1 3 3c0 4-3 6-6 9l-6-6c3-3 5-6 9-6z'},common)),React.createElement('path',Object.assign({key:'p2',d:'M9 15c-3 0-5 2-5 5 3 0 5-2 5-5z'},common))];
            break;
        case 'chart':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M4 20V10'},common)),React.createElement('path',Object.assign({key:'p2',d:'M10 20V4'},common)),React.createElement('path',Object.assign({key:'p3',d:'M16 20v-6'},common)),React.createElement('path',Object.assign({key:'p4',d:'M22 20H2'},common))];
            break;
        case 'security':
            children=[React.createElement('path',Object.assign({key:'p1',d:'M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z'},common)),React.createElement('path',Object.assign({key:'p2',d:'M9 12l2 2 4-4'},common))];
            break;
        default:
            children=[React.createElement('path',Object.assign({key:'p1',d:'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'},common)),React.createElement('polyline',Object.assign({key:'p2',points:'14 3 14 8 19 8'},common))];
    }
    return React.createElement('span',{className:className,'aria-hidden':'true'},React.createElement('svg',{viewBox:'0 0 24 24'},children));
}

function StatusDot(props){
    return React.createElement('span',{className:'status-dot',style:{background:props.color||'currentColor'}});
}

function iconLabel(name,label,size,className){
    return React.createElement(React.Fragment,null,
        React.createElement(Icon,{name:name,size:size||'s',className:className}),
        ' ',
        label
    );
}

function getSeverityColor(level){
    return level==='critical'||level==='high'?'var(--red)':level==='medium'?'var(--orange)':level==='info'?'var(--t3)':'var(--blue)';
}

function getFilePreviewIconName(filename){
    if(!Parser.isCode(filename))return'file';
    if(Parser.isVBA(filename))return'chart';
    if(Parser.isHTML(filename))return'globe';
    if(Parser.isCSS(filename))return'brush';
    if(Parser.isJSON(filename))return'note';
    return'code';
}

    function getAccentBlockStyle(borderColor,tint,extra){
        return Object.assign({
            background:'linear-gradient(180deg, '+tint+' 0%, var(--bg0) 55%)',
            border:'1px solid '+borderColor,
            borderRadius:8
        },extra||{});
    }

function buildAppUrl(repo,autoRun){
    var url=new URL(window.location.href);
    url.search='';
    if(repo)url.searchParams.set('repo',repo);
    if(autoRun&&repo)url.searchParams.set('run','1');
    return url.toString();
}

function getDialogTone(tone){
    if(tone==='danger')return{
        color:'var(--red)',
        borderColor:'rgba(255,95,95,0.34)',
        background:'rgba(255,95,95,0.12)'
    };
    if(tone==='info')return{
        color:'var(--blue)',
        borderColor:'rgba(77,159,255,0.34)',
        background:'rgba(77,159,255,0.12)'
    };
    return{
        color:'var(--orange)',
        borderColor:'rgba(255,159,67,0.34)',
        background:'rgba(255,159,67,0.12)'
    };
}

// Error boundary to prevent white screen crashes on large codebases
class ErrorBoundary extends React.Component{
    constructor(props){super(props);this.state={hasError:false,error:null};}
    static getDerivedStateFromError(error){return{hasError:true,error:error};}
    componentDidCatch(error,info){console.error('CodeFlow crashed:',error,info);}
    render(){
        if(this.state.hasError){
            var self=this;
            return React.createElement('div',{style:{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'var(--bg0)',color:'var(--t0)',fontFamily:'JetBrains Mono, monospace',padding:40,textAlign:'center'}},
                React.createElement(Icon,{name:'logo',size:'xxl',className:'empty-icon'}),
                React.createElement('h2',{style:{marginBottom:12,color:'var(--acc)'}},'CodeFlow ran into an issue'),
                React.createElement('p',{style:{color:'var(--t2)',marginBottom:8,maxWidth:500}},'The codebase may be too large for your browser\'s available memory. Try analyzing a subfolder instead, or close other browser tabs to free memory.'),
                React.createElement('p',{style:{color:'var(--t3)',fontSize:11,marginBottom:20}},String(this.state.error)),
                React.createElement('button',{onClick:function(){self.setState({hasError:false,error:null});},style:{padding:'8px 20px',background:'var(--acc)',color:'var(--bg0)',border:'none',borderRadius:6,cursor:'pointer',fontFamily:'inherit',fontWeight:600}},'Reload')
            );
        }
        return this.props.children;
    }
}

function TreeNode(props){
    var node=props.node,selected=props.selected,onSelect=props.onSelect,expanded=props.expanded,toggle=props.toggle,filterFolder=props.filterFolder,activeFilter=props.activeFilter;
    var isOpen=expanded.has(node.path);
    var isFiltered=activeFilter===node.path;
    var children=Object.values(node.children).sort(function(a,b){return a.name.localeCompare(b.name);});
    return React.createElement('div',null,
        React.createElement('div',{className:'tree-folder'+(isFiltered?' filtered':''),onClick:function(){if(node.path==='')filterFolder(null);else filterFolder(node.path);}},
            React.createElement('span',{className:'tree-toggle'+(isOpen?' open':''),onClick:function(e){e.stopPropagation();toggle(node.path);}},children.length>0||node.files.length>0?'▶':''),
            React.createElement(Icon,{name:isOpen?'folder-open':'folder',size:'m',className:'tree-entry-icon'}),
            React.createElement('span',{className:'tree-name'},node.name),
            React.createElement('span',{className:'tree-count'},countFiles(node))
        ),
        isOpen&&React.createElement('div',{className:'tree-children'},
            children.map(function(c){return React.createElement(TreeNode,{key:c.path,node:c,selected:selected,onSelect:onSelect,expanded:expanded,toggle:toggle,filterFolder:filterFolder,activeFilter:activeFilter});}),
            node.files.map(function(f){return React.createElement('div',{key:f.path,className:'tree-file'+(selected&&selected.path===f.path?' active':''),onClick:function(){onSelect(f.path);}},React.createElement(Icon,{name:'file',size:'s',className:'tree-entry-icon'}),React.createElement('span',{className:'tree-name'},f.name));})
        )
    );
}

function HealthRing(props){
    var score=props.score,grade=props.grade;
    var circ=2*Math.PI*18;
    var offset=circ-(score/100)*circ;
    var color=score>=80?'var(--green)':score>=60?'var(--orange)':'var(--red)';
    return React.createElement('div',{className:'health-ring'},
        React.createElement('svg',{width:'48',height:'48'},
            React.createElement('circle',{cx:'24',cy:'24',r:'18',fill:'none',stroke:'var(--bg3)',strokeWidth:'4'}),
            React.createElement('circle',{cx:'24',cy:'24',r:'18',fill:'none',stroke:color,strokeWidth:'4',strokeDasharray:circ,strokeDashoffset:offset,strokeLinecap:'round'})
        ),
        React.createElement('div',{className:'health-ring-value',style:{color:color}},grade)
    );
}

function App(){
    const nativeCanvasRef=useRef(null);
    const [restoredNativeScene,setRestoredNativeScene]=useState(null);
    const projectLoading=useMemo(createProjectLoading,[]);
    useEffect(()=>()=>projectLoading.dispose(),[projectLoading]);
    var _a=useState(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'),theme=_a[0],setTheme=_a[1];
    var _b=useState(''),repoUrl=_b[0],setRepoUrl=_b[1];
    var _c=useState(''),token=_c[0],setToken=_c[1];
    var _authMethod=useState('none'),authMethod=_authMethod[0],setAuthMethod=_authMethod[1];// 'none', 'pat', 'github_app'
    var _appId=useState(''),appId=_appId[0],setAppId=_appId[1];
    var _privateKey=useState(''),privateKey=_privateKey[0],setPrivateKey=_privateKey[1];
    var _showKeyModal=useState(false),showKeyModal=_showKeyModal[0],setShowKeyModal=_showKeyModal[1];
    var _d=useState(false),loading=_d[0],setLoading=_d[1];
    var _e=useState(''),progress=_e[0],setProgress=_e[1];
    var _f=useState(null),error=_f[0],setError=_f[1];
    var _g=useState(null),data=_g[0],setData=_g[1];
    const [investigation,dispatchInvestigation]=useReducer((state,action)=>reduceInvestigation(state,action,data),undefined,createInvestigationState);
    const selected=useMemo(()=>data&&data.files.find(file=>file.path===investigation.selectedPath)||null,[data,investigation.selectedPath]);
    const folderFilter=investigation.scope,openedCodePaths=investigation.openedPaths,navigation=investigation.navigation;
    function setSelected(file){dispatchInvestigation({type:'select',path:file?file.path:null,record:false});}
    function setFolderFilter(scope){dispatchInvestigation({type:'scope',scope:typeof scope==='function'?scope(folderFilter):scope});}

    var _h=useState(null),repoInfo=_h[0],setRepoInfo=_h[1];
    var _i=useState('folder'),colorMode=_i[0],setColorMode=_i[1];
    var _k=useState(new Set([''])),expandedPaths=_k[0],setExpandedPaths=_k[1];
    var _l=useState(new Set(['blast','fns'])),expandedCards=_l[0],setExpandedCards=_l[1];
    var _leftRail=useState('overview'),leftTab=_leftRail[0],setLeftTab=_leftRail[1];
    var _m=useState('details'),rightTab=_m[0],setRightTab=_m[1];
    var _m2=useState(null),drillDown=_m2[0],setDrillDown=_m2[1];// {type:'issue'|'pattern'|'security'|'suggestion'|'duplicate', data:...}
    var _n=useState(null),blastRadius=_n[0],setBlastRadius=_n[1];
    var _o=useState(null),ownership=_o[0],setOwnership=_o[1];
    var _p=useState(''),prUrl=_p[0],setPrUrl=_p[1];
    var _q=useState(null),prData=_q[0],setPrData=_q[1];
    var _r=useState(false),showExport=_r[0],setShowExport=_r[1];
    var _s=useState(false),showPR=_s[0],setShowPR=_s[1];
    var _t=useState(false),showPrivacy=_t[0],setShowPrivacy=_t[1];
    var _u=useState(null),tooltip=_u[0],setTooltip=_u[1];
    var _v=useState(null),toast=_v[0],setToast=_v[1];
    var _w=useState(false),ownerLoading=_w[0],setOwnerLoading=_w[1];
    var _y=useState(new Set()),expandedFns=_y[0],setExpandedFns=_y[1];
    var _z=useState(false),showUnused=_z[0],setShowUnused=_z[1];
    const [graphSettings,setGraphSettings]=useState({spacing:200,linkDist:70,viewMode:'force',showLabels:true,curvedLinks:true});
    const graphConfig=useMemo(()=>({...graphSettings,vizType:investigation.view}),[graphSettings,investigation.view]);
    function setGraphConfig(update){
        const next=typeof update==='function'?update(graphConfig):update;
        const {vizType,...settings}=next;
        setGraphSettings(settings);
        if(vizType!==graphConfig.vizType)dispatchInvestigation({type:'view',view:vizType});
    }
    var _ab=useState(false),showGraphConfig=_ab[0],setShowGraphConfig=_ab[1];
    var _ac=useState(260),sidebarWidth=_ac[0],setSidebarWidth=_ac[1];
    var _ad=useState(360),rightPanelWidth=_ad[0],setRightPanelWidth=_ad[1];
    var _ae=useState(true),legendCollapsed=_ae[0],setLegendCollapsed=_ae[1];
    var _af=useState(null),filePreview=_af[0],setFilePreview=_af[1];// {path, content, line, filename, loading, error}
    var _ag=useState(null),localDirHandle=_ag[0],setLocalDirHandle=_ag[1];
    var _ap=useState(null),localSourceKind=_ap[0],setLocalSourceKind=_ap[1];// null | 'folder' | 'zip'
    var _ah=useState(false),showExcludeModal=_ah[0],setShowExcludeModal=_ah[1];
    var _ai=useState(''),excludePatternInput=_ai[0],setExcludePatternInput=_ai[1];
    var _aj=useState(''),excludePatternDraft=_aj[0],setExcludePatternDraft=_aj[1];
    var _al=useState(null),confirmDialog=_al[0],setConfirmDialog=_al[1];
    var _am=useState(window.innerWidth),viewportWidth=_am[0],setViewportWidth=_am[1];
    var _an=useState(null),mobilePanel=_an[0],setMobilePanel=_an[1];
    var _ao=useState(48),topbarHeight=_ao[0],setTopbarHeight=_ao[1];
    var _archTests=useState(false),architectureIncludeTests=_archTests[0],setArchitectureIncludeTests=_archTests[1];
    var _archBuild=useState(false),architectureIncludeBuildOutput=_archBuild[0],setArchitectureIncludeBuildOutput=_archBuild[1];
    var [selectedArchitectureBlock,setSelectedArchitectureBlock]=useState(null);
    var _recents=useState([]),recentAnalyses=_recents[0],setRecentAnalyses=_recents[1];
    var _cachedId=useState(null),cachedFromId=_cachedId[0],setCachedFromId=_cachedId[1];
    var _activeSym=useState(null),activeSymbol=_activeSym[0],setActiveSymbol=_activeSym[1];
    var _pendingDel=useState(null),pendingRecentDelete=_pendingDel[0],setPendingRecentDelete=_pendingDel[1];
    var _cli=useState(null),cliStatus=_cli[0],setCliStatus=_cli[1];
    var [fileQuery,setFileQuery]=useState(''),[searchLimit,setSearchLimit]=useState(40);
    var projectSearchResults=useMemo(function(){return data?searchProject(data,fileQuery):[];},[data,fileQuery]);
    var fileSearchRef=useRef(null);
    const sourceFocus=useMemo(()=>investigation.range&&investigation.selectedPath?{path:investigation.selectedPath,line:investigation.range.start.line+1}:null,[investigation.range,investigation.selectedPath]);

    useEffect(function(){
        function quickOpen(event){if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='p'){
            event.preventDefault();setLeftTab('files');if(isMobile)setMobilePanel('explorer');
            requestAnimationFrame(function(){if(fileSearchRef.current)fileSearchRef.current.focus();});
        }}
        window.addEventListener('keydown',quickOpen);return function(){window.removeEventListener('keydown',quickOpen);};
    },[viewportWidth]);
    var [beamAnalysis,setBeamAnalysis]=useState(null);
    var [beamSymbols,setBeamSymbols]=useState([]),[beamLocations,setBeamLocations]=useState(null);
    var [beamNavigationError,setBeamNavigationError]=useState(null);
    function beamLanguage(method,path,position){
        if(!localTools)return Promise.reject(new Error('Open this checkout with the CLI to use language navigation.'));
        return localTools.language(method,path,position);
    }
    function openSourceLocation(location){
        if(!location.path){setBeamNavigationError('Source is outside this project.');return;}
        if(!data.files.some(function(file){return file.path===location.path;})){setBeamNavigationError('Source is excluded or unavailable in this project.');return;}
        setGraphConfig(function(prev){return Object.assign({},prev,{vizType:'code'});});
        nativeCanvasRef.current?.prepareSource(location);
        openCodeFile(location.path,false,location.range);setRightTab('details');

    }

    async function navigateBeamSymbol(method,path,position){
        setBeamNavigationError(null);
        try{var locations=await beamLanguage(method,path,position);if(method==='definition'&&locations.length===1)openSourceLocation(locations[0]);else setBeamLocations({title:method==='references'?'References':'Definitions',items:locations});}
        catch(error){if(error.name!=='AbortError')setBeamNavigationError(error.message);}
    }
    function beamSourceClick(event,path,line){
        if(!event.metaKey&&!event.ctrlKey)return;
        event.preventDefault();event.stopPropagation();
        var caret=document.caretPositionFromPoint?document.caretPositionFromPoint(event.clientX,event.clientY):document.caretRangeFromPoint(event.clientX,event.clientY);
        if(!caret)return;
        var node=caret.offsetNode||caret.startContainer,offset=caret.offset===undefined?caret.startOffset:caret.offset;
        if(!event.currentTarget.contains(node))return;
        var range=document.createRange();range.selectNodeContents(event.currentTarget);range.setEnd(node,offset);
        navigateBeamSymbol(event.shiftKey?'references':'definition',path,{line:line,character:range.toString().length});
    }
    var _cliDirty=useState([]),cliDirty=_cliDirty[0],setCliDirty=_cliDirty[1];
    var _cliLive=useState(Object.create(null)),cliLiveByPath=_cliLive[0],setCliLiveByPath=_cliLive[1];
    var isMobile=viewportWidth<=980;

    var graph3dViewRef=useRef(null);
    var topbarRef=useRef(null);
    var filePreviewRef=useRef(null);
    var treemapRef=useRef(null);
    var matrixRef=useRef(null);
    var dendroRef=useRef(null);
    var sankeyRef=useRef(null);
    var disjointRef=useRef(null);
    var bundleRef=useRef(null);
    var architectureViewRef=useRef(null);

    var selectFileRef=useRef(null);

    var openedSceneRef=useRef('');
    var workspaceKeyRef=useRef(null),workspaceRestoreRef=useRef(null);

    var codeSourceInFlightRef=useRef(Object.create(null));

    var analysisHydrationIdRef=useRef('');
    var dataRef=useRef(null);
    dataRef.current=data;
    var enqueueCliWatchDiffRef=useRef(null);
    var cliDiffTimerRef=useRef(null);
    var cliDiffPendingRef=useRef([]);
    var cliDiffGenRef=useRef(Object.create(null));
    var cliDiffEpochRef=useRef(1);
    var cliAnalyzingRef=useRef(false);
    var cliWatchDuringRef=useRef([]);
    var cliWatchReadRef=useRef(Object.create(null));
    var cliWatchSnapRevRef=useRef(Object.create(null));
    var _sourceFailed=useState(Object.create(null)),codeSourceFailed=_sourceFailed[0],setCodeSourceFailed=_sourceFailed[1];
    var _codeExpand=useState(false),codeViewExpand=_codeExpand[0],setCodeViewExpand=_codeExpand[1];
    var _codeWrap=useState(true),codeViewWrap=_codeWrap[0],setCodeViewWrap=_codeWrap[1];
    var _lineThick=useState(readUiPrefs().lineThickness),lineThickness=_lineThick[0],setLineThickness=_lineThick[1];
    var pendingRecentDeleteTimerRef=useRef(null);
    var zipInputRef=useRef(null);
    var zipArchiveRef=useRef(null);
    var zipFileRef=useRef(null);
    var folderInputRef=useRef(null);
    var localFilesRef=useRef(null);
    var localFolderKeyRef=useRef(null);
    var localFolderSelectionRef=useRef(null);
    var zipKeyRef=useRef(null);
    var pendingExcludePatternsRef=useRef(null);
    var confirmResolverRef=useRef(null);
    var forceRefreshRef=useRef(false);
    var persistTimerRef=useRef(null);
    var activeExcludePatterns=useMemo(function(){return compileExcludePatterns(excludePatternInput);},[excludePatternInput]);
    var customExcludeCount=activeExcludePatterns.length;

    useEffect(function(){
        document.body.className=theme==='light'?'light':'';
        if(window.mermaid){
            window.mermaid.initialize({
                startOnLoad:false,
                securityLevel:'strict',
                theme:theme==='light'?'default':'dark',
                flowchart:{htmlLabels:true,curve:'basis'}
            });
        }
    },[theme]);

    useEffect(function(){
        var el=folderInputRef.current;
        if(!el)return;
        el.setAttribute('webkitdirectory','');
        el.setAttribute('directory','');
        el.setAttribute('mozdirectory','');
    },[]);

    useEffect(function(){
        function onResize(){setViewportWidth(window.innerWidth);}
        window.addEventListener('resize',onResize);
        onResize();
        return function(){window.removeEventListener('resize',onResize);};
    },[]);

    useEffect(function(){
        if(!topbarRef.current)return;
        function measureTopbar(){
            if(topbarRef.current){
                setTopbarHeight(topbarRef.current.offsetHeight||48);
            }
        }
        measureTopbar();
        if(typeof ResizeObserver==='undefined'){
            window.addEventListener('resize',measureTopbar);
            return function(){window.removeEventListener('resize',measureTopbar);};
        }
        var observer=new ResizeObserver(measureTopbar);
        observer.observe(topbarRef.current);
        return function(){observer.disconnect();};
    },[]);

    useEffect(function(){
        if(!isMobile){
            setMobilePanel(null);
            return;
        }
        setLegendCollapsed(true);
        setShowGraphConfig(false);
    },[isMobile]);

    useEffect(function(){
        if(!data){
            setMobilePanel(null);
        }
    },[data]);

    useEffect(function(){
        return function(){
            if(confirmResolverRef.current){
                confirmResolverRef.current(false);
                confirmResolverRef.current=null;
            }
            if(pendingRecentDeleteTimerRef.current){
                clearTimeout(pendingRecentDeleteTimerRef.current);
                pendingRecentDeleteTimerRef.current=null;
            }
        };
    },[]);

    useEffect(function(){
        if(!confirmDialog)return;
        function onKeyDown(e){
            if(e.key==='Escape'){
                e.preventDefault();
                closeConfirmDialog(false);
            }
        }
        document.addEventListener('keydown',onKeyDown);
        return function(){document.removeEventListener('keydown',onKeyDown);};
    },[confirmDialog]);

    useEffect(function(){
        if(!pendingRecentDelete)return;
        function onKeyDown(e){
            if(e.key==='Escape'){
                e.preventDefault();
                clearPendingRecentDelete();
            }
        }
        document.addEventListener('keydown',onKeyDown);
        return function(){document.removeEventListener('keydown',onKeyDown);};
    },[pendingRecentDelete]);

    useEffect(function(){
        var params=new URLSearchParams(window.location.search);
        var repo=params.get('repo');
        var shouldAutoRun=params.get('run')==='1';
        if(repo&&repo.length<200&&!repo.includes('{')&&/^[a-zA-Z0-9_.\/-]+$/.test(repo)){
            setRepoUrl(repo);
            if(shouldAutoRun){
                setTimeout(function(){var btn=document.getElementById('analyze-btn');if(btn)btn.click();},500);
            }
        }
        refreshRecentList();
        return probeCodeflowCli();
    },[]);

    function parseUrl(url){
        if(!url||typeof url!=='string')return null;
        url=url.trim();
        if(url.length>200||url.includes('{')|| url.includes('"'))return null;
        var m=url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
        if(m)return{owner:m[1],repo:m[2].replace(/\.git$/,'')};
        var simple=url.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
        if(simple)return{owner:simple[1],repo:simple[2]};
        return null;
    }

    function currentAnalysisSource(){
        if(localSourceKind==='folder')return{sourceType:'folder',sourceKey:(repoInfo&&(repoInfo.folderKey||repoInfo.name))||'local-folder',title:(repoInfo&&repoInfo.name)||'Local Folder',repoUrl:'',localSourceKind:'folder'};
        if(localSourceKind==='zip')return{sourceType:'zip',sourceKey:(repoInfo&&(repoInfo.zipKey||repoInfo.name))||'zip',title:(repoInfo&&repoInfo.name)||'ZIP Archive',repoUrl:'',localSourceKind:'zip'};
        if(localSourceKind==='cli')return{sourceType:'cli',sourceKey:(repoInfo&&repoInfo.cliRoot)||(cliStatus&&cliStatus.root)||'cli',title:(cliStatus&&cliStatus.name)||(repoInfo&&repoInfo.name)||'Local watch',repoUrl:'',localSourceKind:'cli'};
        if(repoInfo&&repoInfo.owner&&repoInfo.repo&&repoInfo.owner!=='local')return{sourceType:'github',sourceKey:githubSourceKeyForLoadedAnalysis(repoInfo.owner,repoInfo.repo,data,activeExcludePatterns),title:repoInfo.owner+'/'+repoInfo.repo,repoUrl:repoInfo.owner+'/'+repoInfo.repo,localSourceKind:null};
        var parsed=parseUrl(repoUrl);
        if(parsed)return{sourceType:'github',sourceKey:githubSourceKeyForLoadedAnalysis(parsed.owner,parsed.repo,data,activeExcludePatterns),title:parsed.owner+'/'+parsed.repo,repoUrl:parsed.owner+'/'+parsed.repo,localSourceKind:null};
        if(cliStatus&&cliStatus.ok)return{sourceType:'cli',sourceKey:cliStatus.root||'cli',title:cliStatus.name||'Local watch',repoUrl:'',localSourceKind:'cli'};
        return null;
    }
    var analysisGraphIdentity=useMemo(function(){return analysisGraphKey(data);},[data]);
    var loadedSourceIdentity=useMemo(function(){
        var parsed=parseUrl(repoUrl);
        var githubOwner=repoInfo&&repoInfo.owner&&repoInfo.owner!=='local'?repoInfo.owner:(parsed&&parsed.owner);
        var githubRepo=repoInfo&&repoInfo.owner&&repoInfo.owner!=='local'?repoInfo.repo:(parsed&&parsed.repo);
        return loadedAnalysisSourceIdentity({
            localSourceKind:localSourceKind,
            folderKey:repoInfo&&(repoInfo.folderKey||repoInfo.name),
            zipKey:repoInfo&&(repoInfo.zipKey||repoInfo.name),
            cliRoot:(repoInfo&&repoInfo.cliRoot)||(cliStatus&&cliStatus.root),
            cliOk:!!(cliStatus&&cliStatus.ok),
            githubOwner:githubOwner,
            githubRepo:githubRepo,
            githubKey:githubOwner&&githubRepo?githubSourceKeyForLoadedAnalysis(githubOwner,githubRepo,data,activeExcludePatterns):null
        });
    },[localSourceKind,repoInfo,repoUrl,data,cliStatus]);
    var currentHydrationId=useMemo(function(){
        return analysisHydrationIdFromParts(loadedSourceIdentity,analysisGraphIdentity);
    },[loadedSourceIdentity,analysisGraphIdentity]);
    analysisHydrationIdRef.current=currentHydrationId;
    var localTools=useMemo(function(){return createLocalTools({identity:loadedSourceIdentity,status:cliStatus});},
        [loadedSourceIdentity&&loadedSourceIdentity.sourceType,loadedSourceIdentity&&loadedSourceIdentity.sourceKey,cliStatus&&cliStatus.root,cliStatus&&cliStatus.ok]);
    const runtimeInspection=useRuntimeInspection(localTools,cliStatus?.runtimeNode||'');
    const runtimeIndex=useMemo(()=>indexRuntime(runtimeInspection.snapshot,data?.files||[]),[runtimeInspection.snapshot,data]);
    useEffect(function(){
        setBeamAnalysis(null);setBeamLocations(null);setBeamNavigationError(null);
        return function(){if(localTools)localTools.dispose();};
    },[localTools]);

    useEffect(function(){
        if(loading||!data||!data.beam||!localTools)return;

        return subscribeCliAnalysis({onUpdate:function(update){
            if(update.analysis)setBeamAnalysis(update.analysis);
            if(update.diagnostics)setData(function(prev){return prev?enrichAnalysisFindings(prev,update.diagnostics):prev;});
            if(update.graph)setData(function(prev){return prev&&prev.beam?buildBeamAnalysisData({data:prev,snapshot:update.graph}):prev;});
        }});
    },[loading,localTools,!!(data&&data.beam)]);
    useEffect(function(){
        setBeamSymbols([]);setBeamLocations(null);setBeamNavigationError(null);
        if(loading||!localTools||!data||!data.beam||!selected||!/\.exs?$/.test(selected.path)||!beamAnalysis||beamAnalysis.language.state!=='ready')return;
        var cancelled=false;
        beamLanguage('symbols',selected.path).then(function(items){if(!cancelled)setBeamSymbols(items);}).catch(function(error){if(!cancelled&&error.name!=='AbortError')setBeamNavigationError(error.message);});
        return function(){cancelled=true;};
    },[loading,localTools,selected&&selected.path,beamAnalysis&&beamAnalysis.language.build&&beamAnalysis.language.build.completedAt,beamAnalysis&&beamAnalysis.language.state]);

    function refreshRecentList(){
        listRecentAnalyses().then(function(rows){
            setRecentAnalyses((rows||[]).map(function(row){
                return{
                    id:row.id,
                    title:row.title,
                    sourceType:row.sourceType,
                    sourceKey:row.sourceKey,
                    repoUrl:row.repoUrl,
                    fileCount:row.fileCount,
                    savedAt:row.savedAt
                };
            }));
        }).catch(function(){});
    }

    function persistCurrentAnalysis(dataObj,meta){
        if(!dataObj)return;
        var source=meta||currentAnalysisSource();
        if(!source)return;
        var record=buildRecentAnalysisRecord({
            sourceType:source.sourceType,
            sourceKey:source.sourceKey,
            title:source.title,
            repoUrl:source.repoUrl,
            data:compactAnalysisForCache(dataObj),
            repoInfo:source.repoInfo||repoInfo,
            localSourceKind:source.localSourceKind
        });
        if(persistTimerRef.current)clearTimeout(persistTimerRef.current);
        persistTimerRef.current=setTimeout(function(){
            saveRecentAnalysis(record).then(function(ok){if(ok)refreshRecentList();});
        },80);
    }

    function applyCachedAnalysis(record){
        if(!record||!record.data)return;
        projectLoading.begin();
        setLoading(false);setError(null);cliAnalyzingRef.current=false;
        setData(compactAnalysisForCache(record.data));
        setExpandedPaths(new Set(['']));
        setSelected(null);
        setBlastRadius(null);
        setOwnership(null);
        setFolderFilter(null);
        setCachedFromId(record.id);
        setActiveSymbol(null);
        setCliDirty([]);
        clearCliLiveDiffs();
        if(record.repoInfo)setRepoInfo(record.repoInfo);
        if(record.repoUrl)setRepoUrl(record.repoUrl);
        var folderMatches=record.sourceType==='folder'&&retainedFolderMatchesRecord(record,{sourceKey:localFolderKeyRef.current});
        var zipMatches=record.sourceType==='zip'&&retainedZipMatchesRecord(record,{
            sourceKey:zipKeyRef.current,
            identity:zipFileIdentity(zipFileRef.current)
        });
        if(!folderMatches){
            setLocalDirHandle(null);
            localFolderKeyRef.current=null;
            localFolderSelectionRef.current=null;
            localFilesRef.current=null;
        }
        if(!zipMatches){
            zipArchiveRef.current=null;
            zipFileRef.current=null;
            zipKeyRef.current=null;
        }
        if(record.sourceType==='github'||record.sourceType==='cli'){
            setLocalSourceKind(record.sourceType==='cli'?'cli':null);
            setLocalDirHandle(null);
        }else{
            setLocalSourceKind(record.localSourceKind||record.sourceType);
        }
        setGraphConfig(function(cfg){return Object.assign({},cfg,{vizType:cfg.vizType==='architecture'?'graph':cfg.vizType});});
        showNotification('Loaded cached analysis. Re-analyze to refresh.','success');
    }

    function loadRecentAnalysis(id){
        const selectionSignal=projectLoading.begin();
        clearPendingRecentDelete();
        return getRecentAnalysis(id).then(function(record){
            if(selectionSignal.aborted)return null;
            if(!record){showNotification('That analysis is no longer cached.','warning');refreshRecentList();return null;}
            applyCachedAnalysis(record);
            return record;
        }).catch(function(){if(selectionSignal.aborted)return null;showNotification('Could not open cached analysis.','error');return null;});
    }

    function reanalyzeRecent(id){
        const selectionSignal=projectLoading.begin();
        return getRecentAnalysis(id).then(function(record){
            if(selectionSignal.aborted)return null;
            if(!record){showNotification('That analysis is no longer cached.','warning');refreshRecentList();return;}
            refreshAnalysis(record);
        }).catch(function(){if(selectionSignal.aborted)return null;showNotification('Could not open cached analysis.','error');});
    }

    function clearPendingRecentDelete(){
        if(pendingRecentDeleteTimerRef.current){
            clearTimeout(pendingRecentDeleteTimerRef.current);
            pendingRecentDeleteTimerRef.current=null;
        }
        setPendingRecentDelete(null);
    }

    function removeRecentAnalysis(id){
        deleteRecentAnalysis(id).then(function(){
            if(cachedFromId===id)setCachedFromId(null);
            refreshRecentList();
        }).catch(function(){});
    }

    function requestRecentDelete(id,e){
        if(e)e.stopPropagation();
        var next=armRecentDelete(pendingRecentDelete,id);
        if(next.confirm){
            clearPendingRecentDelete();
            removeRecentAnalysis(id);
            return;
        }
        setPendingRecentDelete(next.armedId);
        if(pendingRecentDeleteTimerRef.current)clearTimeout(pendingRecentDeleteTimerRef.current);
        pendingRecentDeleteTimerRef.current=setTimeout(function(){setPendingRecentDelete(null);},4000);
    }

    function startGithubZipDownload(owner,repo){
        var url=githubZipDownloadUrl(owner,repo);
        var a=document.createElement('a');
        a.href=url;
        a.rel='noopener';
        a.target='_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showNotification('ZIP download started. Use Open ZIP to analyze it here.','success');
    }

    function downloadCurrentGithubZip(){
        var parsed=parseUrl(repoUrl)||(repoInfo&&repoInfo.owner&&repoInfo.repo?{owner:repoInfo.owner,repo:repoInfo.repo}:null);
        if(!parsed){showNotification('Enter a GitHub URL first.','warning');return;}
        startGithubZipDownload(parsed.owner,parsed.repo);
    }

    function clearCliLiveDiffs(){
        cliDiffEpochRef.current=bumpCliWatchDiffEpoch(cliDiffEpochRef.current);
        cliDiffPendingRef.current=[];
        cliDiffGenRef.current=Object.create(null);
        if(cliDiffTimerRef.current){
            clearTimeout(cliDiffTimerRef.current);
            cliDiffTimerRef.current=null;
        }
        setCliLiveByPath(Object.create(null));
    }

    function flushCliWatchDiffs(paths){
        if(!cliWatchAppliesToAnalysis(localSourceKind,cliStatus,currentAnalysisSource()))return;
        var wanted=cliWatchDiffPaths(dataRef.current&&dataRef.current.files,paths);
        if(!wanted.length)return;
        wanted.forEach(function(path){
            var epoch=cliDiffEpochRef.current;
            var gen=(cliDiffGenRef.current[path]||0)+1;
            cliDiffGenRef.current[path]=gen;
            readCliWatchLiveSource(path).then(function(result){
                if(!cliWatchDiffRequestIsCurrent(cliDiffEpochRef.current,epoch,cliDiffGenRef.current,path,gen))return;
                if(!shouldApplyCliWatchLive(result))return;
                var live=result.kind==='missing'?'':result.content;
                var file=analyzedFileForCliWatchPath(dataRef.current&&dataRef.current.files,path);
                if(cliWatchLiveClearsDirty(file,live,result.kind)){
                    setCliLiveByPath(function(prev){return mergeCliLiveContents(prev,[{path:path,content:null}]);});
                    setCliDirty(function(prev){return forgetCliWatchPath(prev,path);});
                    return;
                }
                setCliLiveByPath(function(prev){return mergeCliLiveContents(prev,[{path:path,content:live}]);});
            });
        });
    }

    function enqueueCliWatchDiff(path,rev){
        var next=normalizeCliWatchPath(path);
        if(!next)return;
        if(cliAnalyzingRef.current)cliWatchDuringRef.current=noteCliWatchDuringEvent(cliWatchDuringRef.current,next,rev);
        if(!cliWatchAppliesToAnalysis(localSourceKind,cliStatus,currentAnalysisSource()))return;
        setCliDirty(function(prev){return noteCliWatchPath(prev,next);});
        cliDiffPendingRef.current=noteCliWatchPath(cliDiffPendingRef.current,next);
        if(cliDiffTimerRef.current)clearTimeout(cliDiffTimerRef.current);
        cliDiffTimerRef.current=setTimeout(function(){
            var pending=cliDiffPendingRef.current;
            cliDiffPendingRef.current=[];
            cliDiffTimerRef.current=null;
            flushCliWatchDiffs(pending);
        },CLI_WATCH_DIFF_MS);
    }
    enqueueCliWatchDiffRef.current=enqueueCliWatchDiff;

    function probeCodeflowCli(){
        const probeSignal=projectLoading.begin();
        let src;
        fetch('/__codeflow/status',{signal:probeSignal}).then(function(res){return res.ok?res.json():null;}).then(function(status){
            if(probeSignal.aborted||!status||!status.ok)return;
            setCliStatus(status);
            if(!window.location.search||window.location.search.indexOf('repo=')<0){
                analyzeFromCli(false,status);
            }
            if(window.EventSource){
                src=new EventSource('/__codeflow/events');
                src.onmessage=function(ev){
                    try{
                        var payload=JSON.parse(ev.data||'{}');
                        if(payload.path&&enqueueCliWatchDiffRef.current)enqueueCliWatchDiffRef.current(payload.path,payload.rev);
                    }catch(e){}
                };
            }
        }).catch(function(){});
        return function(){src?.close();};
    }

    useEffect(function(){
        if(!cliWatchAppliesToAnalysis(localSourceKind,cliStatus,currentAnalysisSource()))return;
        if(!data||!data.files||!cliDirty.length)return;
        var started=startedCliWatchDiffPaths(cliDiffPendingRef.current,cliDiffGenRef.current);
        var missing=pendingCliWatchDiffPaths(cliDirty,cliLiveByPath,started);
        if(!missing.length)return;
        flushCliWatchDiffs(missing);
    },[currentHydrationId,cliDirty,localSourceKind,cliStatus,cliLiveByPath]);

    async function analyzeFromCli(force,statusHint,wantedRoot){
        const selectionSignal=projectLoading.begin();
        var status=statusHint||cliStatus;
        if(!status||!status.ok){
            try{
                var statusRes=await fetch('/__codeflow/status',{signal:selectionSignal});
                if(statusRes.ok){
                    var nextStatus=await statusRes.json();
                    if(nextStatus&&nextStatus.ok)status=nextStatus;
                }
            }catch(e){}
            if((!status||!status.ok)&&!force)return;
        }
        if(selectionSignal.aborted)return;
        if(wantedRoot&&!cliRecordMatchesStatus({sourceKey:wantedRoot},status)){
            showNotification('Restart the CLI in that folder to re-analyze it.','warning');
            return false;
        }
        if(status&&status.ok)setCliStatus(status);
        var cliMeta=cliWatchCacheMeta(status);
        cliWatchDuringRef.current=[];
        cliWatchReadRef.current=Object.create(null);
        cliWatchSnapRevRef.current=Object.create(null);
        resetAnalysisState();
        cliAnalyzingRef.current=true;
        const loadSignal=projectLoading.signal;
        setLocalDirHandle(null);
        localFolderKeyRef.current=null;
        localFolderSelectionRef.current=null;
        setLocalSourceKind('cli');
        zipArchiveRef.current=null;
        zipFileRef.current=null;
        zipKeyRef.current=null;
        setLoading(true);
        setProgress('Reading local folder from CLI...');
        try{

            var listRes=await fetch('/__codeflow/files',{signal:loadSignal});
            if(!listRes.ok)throw new Error('CLI file list failed');
            var list=await listRes.json();
            var files=filterAnalyzableLocalFiles(list&&list.files?list.files:[],activeExcludePatterns);
            if(!files.length)throw new Error(activeExcludePatterns.length?'No code files found in the watched folder after applying exclude patterns':'No code files found in the watched folder');
            const analyzed=await readCollectedFiles(files.map(file=>({...file,read:async()=>{
                const response=await fetch('/__codeflow/file?path='+encodeURIComponent(file.path),{signal:loadSignal});
                if(!response.ok)throw new Error('CLI source request failed');
                loadSignal.throwIfAborted();
                const path=normalizeCliWatchPath(file.path);
                cliWatchReadRef.current[path]=true;
                const revision=cliWatchSnapRevFromResponse(response);
                if(revision!=null)cliWatchSnapRevRef.current[path]=revision;
                return response.text();
            }})),{signal:loadSignal,progress:message=>{if(!loadSignal.aborted)setProgress(message);},yieldFn:yieldToBrowser});
            var snapshot=null;
            if(status.beam){
                var beamRes=await fetch('/__codeflow/beam',{signal:loadSignal});
                if(!beamRes.ok)throw new Error('Compiler snapshot request failed');
                snapshot=await beamRes.json();
            }
            var dataObj=await runAnalysisData({
                signal:loadSignal,
                files:analyzed,
                excludePatterns:activeExcludePatterns.map(function(x){return x.raw;}),
                progress:function(message){if(!loadSignal.aborted)setProgress(message);},
                yieldFn:yieldToBrowser
            });
            if(loadSignal.aborted)return;
            if(status.beam)dataObj=buildBeamAnalysisData({data:dataObj,snapshot:snapshot});
            var cliInfo={owner:'local',repo:'cli',name:cliMeta.title,cliRoot:cliMeta.sourceKey};
            var keep=retainCliWatchPathsAfterAnalysis(cliWatchDuringRef.current,cliWatchReadRef.current,cliWatchSnapRevRef.current);
            cliAnalyzingRef.current=false;
            cliWatchDuringRef.current=[];
            cliWatchReadRef.current=Object.create(null);
            cliWatchSnapRevRef.current=Object.create(null);
            if(loadSignal.aborted)return;
            setData(dataObj);
            setExpandedPaths(new Set(['']));
            setRepoInfo(cliInfo);
            setCachedFromId(null);
            setCliDirty(keep);
            clearCliLiveDiffs();
            persistCurrentAnalysis(dataObj,{sourceType:'cli',sourceKey:cliMeta.sourceKey,title:cliMeta.title,repoUrl:'',repoInfo:cliInfo,localSourceKind:'cli'});
            setLoading(false);
            return true;
        }catch(err){
            if(loadSignal.aborted)return;
            cliAnalyzingRef.current=false;
            cliWatchDuringRef.current=[];
            cliWatchReadRef.current=Object.create(null);
            cliWatchSnapRevRef.current=Object.create(null);
            setError('CLI analysis failed: '+(err.message||err));
            setLoading(false);
        }
    }

    function resetAnalysisState(){
        projectLoading.begin();
        cliAnalyzingRef.current=false;
        setError(null);
        setData(null);
        setSelected(null);
        setBlastRadius(null);
        setOwnership(null);
        setFolderFilter(null);
        setPrData(null);
        setFilePreview(null);
        setMobilePanel(null);
        setShowGraphConfig(false);
        setCachedFromId(null);
        setActiveSymbol(null);
        setCliDirty([]);
        clearCliLiveDiffs();
    }

    function openExcludeModal(){
        setExcludePatternDraft(excludePatternInput);
        setShowExcludeModal(true);
    }

    function closeExcludeModal(){
        setShowExcludeModal(false);
    }

    function saveExcludePatterns(){
        setExcludePatternInput(excludePatternDraft);
        setShowExcludeModal(false);
    }

    function closeConfirmDialog(result){
        setConfirmDialog(null);
        if(confirmResolverRef.current){
            var resolve=confirmResolverRef.current;
            confirmResolverRef.current=null;
            resolve(!!result);
        }
    }

    function requestConfirm(options){
        return new Promise(function(resolve){
            if(confirmResolverRef.current){
                confirmResolverRef.current(false);
            }
            confirmResolverRef.current=resolve;
            setConfirmDialog(Object.assign({
                tone:'warning',
                icon:'warning',
                title:'Please confirm',
                message:'',
                confirmLabel:'Continue',
                cancelLabel:'Cancel'
            },options||{}));
        });
    }

    function toggleMobilePanel(panel){
        setMobilePanel(function(prev){return prev===panel?null:panel;});
    }

    function analyze(forceRefresh,explicitUrl){
        var p=parseUrl(explicitUrl||repoUrl);
        if(!p){setError('Invalid URL. Use format: owner/repo');return;}
        if(explicitUrl)setRepoUrl(explicitUrl);
        var shouldForce=forceRefresh===true||forceRefreshRef.current;
        forceRefreshRef.current=false;
        var githubKey=githubCacheSourceKey(p.owner,p.repo,activeExcludePatterns);
        var cacheId=analysisCacheKey('github',githubKey);
        if(!shouldForce){
            const cacheSignal=projectLoading.begin();
            getRecentAnalysis(cacheId).then(function(record){
                if(cacheSignal.aborted)return;
                if(record&&record.data&&cachedAnalysisMatchesExcludes(record,activeExcludePatterns)){
                    applyCachedAnalysis(record);
                    return;
                }
                analyze(true,p.owner+'/'+p.repo);
            }).catch(function(){if(!cacheSignal.aborted)analyze(true,p.owner+'/'+p.repo);});
            return;
        }
        var currentExcludePatterns=activeExcludePatterns;

        // Validate authentication inputs
        if(authMethod==='pat'&&!token){
            setError('Please enter a Personal Access Token');return;
        }
        if(authMethod==='github_app'){
            if(!appId){setError('Please enter the GitHub App ID');return;}
            if(!privateKey){setError('Please set the GitHub App private key');return;}
        }

        resetAnalysisState();
        const loadSignal=projectLoading.signal;
        setLocalDirHandle(null);
        setLocalSourceKind(null);
        zipArchiveRef.current=null;
        zipFileRef.current=null;
        setLoading(true);
        setProgress('Initializing...');

        // Configure GitHub authentication based on method
        GitHub.token=null;
        GitHub.appId=null;
        GitHub.privateKey=null;
        GitHub.installationToken=null;

        if(authMethod==='pat'){
            GitHub.token=token;
        }else if(authMethod==='github_app'){
            GitHub.appId=appId;
            GitHub.privateKey=privateKey;
        }

        setRepoInfo(p);

        // Authentication promise - resolve immediately for no auth/PAT, authenticate for GitHub App
        var authPromise;
        if(authMethod==='github_app'){
            setProgress('Authenticating with GitHub App...');
            authPromise=GitHub.authenticateApp(p.owner,p.repo,loadSignal).catch(function(err){
                throw new Error('GitHub App authentication failed: '+err.message);
            });
        }else{
            authPromise=Promise.resolve();
        }

        authPromise.then(function(){loadSignal.throwIfAborted();
            setProgress('Checking rate limit...');
            return GitHub.getRateLimit(loadSignal);
        }).then(function(rl){loadSignal.throwIfAborted();
            var hasAuth=!!GitHub.token||authMethod==='github_app';
            var estimatedRequests=50;// Conservative estimate for a small-medium repo

            // Warn if rate limit is very low and no authentication
            if(!hasAuth&&rl.remaining<estimatedRequests){
                var resetTime=new Date(rl.reset*1000).toLocaleTimeString();
                return requestConfirm({
                    tone:'warning',
                    icon:'warning',
                    title:'GitHub API rate limit is low',
                    message:
                        'Remaining requests: '+rl.remaining+'/'+rl.limit+'\n'+
                        'Resets at: '+resetTime+'\n\n'+
                        'The folder picker is faster when the API is rate-limited. Open Folder and analyze locally, or download a ZIP and use Open ZIP.\n\n'+
                        'Without authentication, you only get 60 requests per hour.\n'+
                        'Adding a token or GitHub App raises that to 5,000 requests per hour.\n\n'+
                        'Token (PAT): GitHub Settings -> Developer Settings -> Personal access tokens\n'+
                        'GitHub App: use App ID + Private Key for organization access\n\n'+
                        'Continue anyway with the remaining requests?',
                    confirmLabel:'Continue anyway'
                }).then(function(proceed){loadSignal.throwIfAborted();
                    if(!proceed){
                        setLoading(false);
                        return Promise.reject('cancelled');
                    }
                    setProgress('Scanning repository...');
                    return GitHub.scan(p.owner,p.repo,function(message){if(!loadSignal.aborted)setProgress(message);},currentExcludePatterns,loadSignal);
                });
            }

            setProgress('Scanning repository...');
            return GitHub.scan(p.owner,p.repo,function(message){if(!loadSignal.aborted)setProgress(message);},currentExcludePatterns,loadSignal);
        }).then(function(files){loadSignal.throwIfAborted();
            if(!files)return;// Cancelled
            if(!files.length)throw new Error(currentExcludePatterns.length?'No code files found after applying exclude patterns':'No code files found');
            var SOFT_LIMIT=ANALYSIS_LIMITS.repoSoft;
            async function beginRepoAnalysis(){
                const analyzed=await readCollectedFiles(files.map(file=>({...file,read:async()=>{
                    const [content,commits]=await Promise.all([
                        GitHub.getFile(p.owner,p.repo,file.path,loadSignal),
                        Parser.isCode(file.name)?GitHub.getCommits(p.owner,p.repo,file.path,10,loadSignal):Promise.resolve([])
                    ]);
                    if(typeof content!=='string')throw new Error('GitHub source request failed');
                    return {content,churn:Array.isArray(commits)?commits.length:0};
                }})),{signal:loadSignal,progress:message=>{if(!loadSignal.aborted)setProgress(message);},yieldFn:yieldToBrowser});
                async function finishAnalysis(){
                    if(loadSignal.aborted)return;
                    try{
                        var dataObj=await runAnalysisData({
                            signal:loadSignal,
                            files:analyzed,
                            excludePatterns:currentExcludePatterns.map(function(x){return x.raw;}),
                            progress:function(message){if(!loadSignal.aborted)setProgress(message);},
                            yieldFn:yieldToBrowser
                        });
                        var failedCount=analyzed.filter(function(af){return af.analysisSkipped==='fetch-failed';}).length;
                        if(failedCount>0){
                            showNotification(failedCount+' of '+analyzed.length+' files could not be fetched (GitHub rate limit?). Results are PARTIAL — add a token or use Open ZIP for full analysis.','warning');
                        }
                        if(loadSignal.aborted)return;
                        setData(dataObj);
                        setExpandedPaths(new Set(['']));
                        setCachedFromId(null);
                        persistCurrentAnalysis(dataObj,{sourceType:'github',sourceKey:githubKey,title:p.owner+'/'+p.repo,repoUrl:p.owner+'/'+p.repo,repoInfo:p,localSourceKind:null});
                        window.history.replaceState({},'',buildAppUrl(p.owner+'/'+p.repo,false));
                        setLoading(false);
                    }catch(err){
                        if(loadSignal.aborted)return;
                        setError('Analysis failed: '+(err.message||err)+'. Try a smaller repository.');
                        setLoading(false);
                    }
                }

                await finishAnalysis();
            }

            if(files.length>SOFT_LIMIT){
                return requestConfirm({
                    tone:'warning',
                    icon:'warning',
                    title:'Analyze a large repository?',
                    message:
                        'This repository has '+files.length+' files.\n\n'+
                        'Analyzing larger repositories can take longer and may hit GitHub API rate limits.\n\n'+
                        'The folder picker is faster when the API is rate-limited. You can also download a ZIP and use Open ZIP.\n\n'+
                        'Tip: add a token or GitHub App for higher limits.',
                    confirmLabel:'Analyze repository'
                }).then(function(proceed){loadSignal.throwIfAborted();
                    if(!proceed){
                        setLoading(false);
                        return Promise.reject('cancelled');
                    }
                    return beginRepoAnalysis();
                });
            }

            return beginRepoAnalysis();
        }).catch(function(e){if(!loadSignal.aborted&&e!=='cancelled'){setError(e.message||e);setLoading(false);}});
    }

    function launchLocalFolderPicker(compiledPatterns){
        pendingExcludePatternsRef.current=compiledPatterns||activeExcludePatterns;
        if(!window.showDirectoryPicker){
            if(folderInputRef.current){
                folderInputRef.current.value='';
                folderInputRef.current.click();
            }
            return;
        }
        window.showDirectoryPicker().then(function(dirHandle){
            resetAnalysisState();
            setRepoInfo(null);
            localFolderKeyRef.current=null;
            localFolderSelectionRef.current=newLocalSelectionId();
            setLocalDirHandle(dirHandle);
            setLocalSourceKind('folder');
            zipArchiveRef.current=null;
            zipFileRef.current=null;
            setLoading(true);
            setProgress('Reading local folder...');
            readLocalFolder(dirHandle,compiledPatterns||activeExcludePatterns);
        }).catch(function(e){
            if(e.name!=='AbortError'){
                setError('Failed to open folder: '+(e.message||e));
            }
        });
    }

    function openLocalFolder(){
        launchLocalFolderPicker();
    }

    function openLocalZip(){
        if(!window.JSZip){
            setError('ZIP support failed to load. Check your network connection and try again.');
            return;
        }
        if(zipInputRef.current){
            zipInputRef.current.value='';
            zipInputRef.current.click();
        }
    }

    function handleZipSelected(e){
        var file=e.target.files&&e.target.files[0];
        if(!file)return;
        resetAnalysisState();
        setRepoInfo(null);
        setLocalDirHandle(null);
        setLocalSourceKind('zip');
        zipArchiveRef.current=null;
        zipFileRef.current=file;
        zipKeyRef.current=null;
        setLoading(true);
        setProgress('Reading ZIP archive...');
        readZipArchive(file,activeExcludePatterns);
    }

    function handleFolderSelected(e){
        var fileList=e.target.files;
        if(!fileList||fileList.length===0)return;
        var files=Array.from(fileList);
        localFilesRef.current=files;
        resetAnalysisState();
        setRepoInfo(null);
        localFolderKeyRef.current=null;
        localFolderSelectionRef.current=newLocalSelectionId();
        setLocalDirHandle(null);
        setLocalSourceKind('folder');
        zipArchiveRef.current=null;
        zipFileRef.current=null;
        setLoading(true);
        setProgress('Reading local folder...');
        readLocalFolderFromFiles(files,pendingExcludePatternsRef.current||activeExcludePatterns);
    }

    function refreshAnalysis(record){
        var source=record&&record.sourceType?record:null;
        var kind=source?source.sourceType:(localSourceKind||(parseUrl(repoUrl)?'github':null));
        var githubUrl=source?(source.repoUrl||source.sourceKey):repoUrl;
        setCachedFromId(null);
        if(kind==='cli'||(!source&&cliStatus&&cliStatus.ok&&localSourceKind==='cli')){
            var wantedRoot=source&&source.sourceType==='cli'?source.sourceKey:'';
            if(wantedRoot&&cliStatus&&cliStatus.ok&&!cliRecordMatchesStatus(source,cliStatus)){
                applyCachedAnalysis(source);
                showNotification('Restart the CLI in that folder to re-analyze it.','warning');
                return;
            }
            Promise.resolve(analyzeFromCli(true,cliStatus,wantedRoot||null)).then(function(ok){
                if(ok===false&&source)applyCachedAnalysis(source);
            });
            return;
        }
        if(kind==='folder'){
            var retained={sourceKey:localFolderKeyRef.current};
            var handleMatches=!source||retainedFolderMatchesRecord(source,retained);
            if(localDirHandle&&handleMatches){
                resetAnalysisState();
                setLoading(true);
                setProgress('Reading local folder...');
                readLocalFolder(localDirHandle,activeExcludePatterns);
                return;
            }
            if(localFilesRef.current&&handleMatches){
                resetAnalysisState();
                setLoading(true);
                setProgress('Reading local folder...');
                readLocalFolderFromFiles(localFilesRef.current,activeExcludePatterns);
                return;
            }
            if(source)applyCachedAnalysis(source);
            showNotification('Open Folder again to re-analyze this local tree.','warning');
            return;
        }
        if(kind==='zip'){
            var zipMatches=!source||retainedZipMatchesRecord(source,{
                sourceKey:zipKeyRef.current,
                identity:zipFileIdentity(zipFileRef.current)
            });
            if(!zipFileRef.current||!zipMatches){
                if(source)applyCachedAnalysis(source);
                showNotification('Open ZIP again to re-analyze this archive.','warning');
                return;
            }
            resetAnalysisState();
            setLocalDirHandle(null);
            setLocalSourceKind('zip');
            zipArchiveRef.current=null;
            setLoading(true);
            setProgress('Reading ZIP archive...');
            readZipArchive(zipFileRef.current,activeExcludePatterns);
            return;
        }
        if(kind==='github'||parseUrl(githubUrl)){
            analyze(true,githubUrl);
            return;
        }
        analyze(true);
    }

    function readLocalFolder(dirHandle,patterns){
        return loadLocalCollection({kind:'folder',patterns,title:dirHandle.name,
            collect:options=>collectDirectory(dirHandle,options)});
    }
    function readLocalFolderFromFiles(fileObjs,patterns){
        return loadLocalCollection({kind:'folder',patterns,
            collect:options=>collectSelectedFiles(fileObjs,options)});
    }
    function readZipArchive(zipFile,patterns){
        return loadLocalCollection({kind:'zip',patterns,zipFile,
            collect:async options=>{
                if(!window.JSZip)throw new Error('ZIP support failed to load');
                const zip=await JSZip.loadAsync(zipFile);
                options.signal.throwIfAborted();
                return {...await collectArchive(zip,options),zip};
            }});
    }
    async function loadLocalCollection({kind,patterns=activeExcludePatterns,title,zipFile,collect}){
        const signal=projectLoading.signal;
        const progress=message=>{if(!signal.aborted)setProgress(message);};
        const archive=kind==='zip';
        const label=archive?'ZIP archive':'selected folder';
        try{
            progress(archive?'Reading ZIP archive...':'Scanning local folder...');
            const collection=await collect({patterns,signal,progress});
            signal.throwIfAborted();
            if(!collection.files.length)throw new Error('No code files found in the '+label+(patterns.length?' after applying exclude patterns':''));
            if(collection.files.length>ANALYSIS_LIMITS.localSoft){
                const proceed=await requestConfirm({tone:'warning',icon:archive?'archive':'folder',
                    title:'Analyze '+collection.files.length+' files?',
                    message:'CodeFlow will analyze every eligible file. Large '+(archive?'archives':'folders')+' can take minutes and use significant browser memory.',
                    confirmLabel:'Analyze all files'});
                signal.throwIfAborted();
                if(!proceed){if(archive){setLocalSourceKind(null);zipFileRef.current=null;}setLoading(false);return;}
            }
            const files=await readCollectedFiles(collection.files,{signal,progress,yieldFn:yieldToBrowser});
            const dataObj=await runAnalysisData({signal,files,excludePatterns:patterns.map(x=>x.raw),progress,yieldFn:yieldToBrowser});
            signal.throwIfAborted();
            let meta,info;
            if(archive){
                meta=zipArchiveCacheMeta({name:zipFile.name,size:zipFile.size,lastModified:zipFile.lastModified,paths:files.map(f=>f.path)});
                info={owner:'local',repo:'zip',name:meta.title,zipKey:meta.sourceKey};
                zipArchiveRef.current={zip:collection.zip,entriesByPath:collection.entriesByPath,name:zipFile.name};
                zipFileRef.current=zipFile;zipKeyRef.current=meta.sourceKey;
                setLocalDirHandle(null);setLocalSourceKind('zip');
            }else{
                if(!localFolderSelectionRef.current)localFolderSelectionRef.current=newLocalSelectionId();
                meta=localFolderCacheMeta({title,rootPrefix:collection.rootPrefix,paths:files.map(f=>f.path),selectionId:localFolderSelectionRef.current});
                info={owner:'local',repo:'folder',name:meta.title,folderKey:meta.sourceKey,folderSelectionId:meta.selectionId};
                localFolderKeyRef.current=meta.sourceKey;
            }
            setData(dataObj);setExpandedPaths(new Set(['']));setRepoInfo(info);setCachedFromId(null);
            persistCurrentAnalysis(dataObj,{sourceType:kind,sourceKey:meta.sourceKey,title:meta.title,repoUrl:'',repoInfo:info,localSourceKind:kind});
            setLoading(false);
        }catch(error){
            if(signal.aborted)return;
            if(archive){setLocalSourceKind(null);zipArchiveRef.current=null;}
            setError('Failed to analyze '+label+': '+(error.message||error));setLoading(false);
        }
    }

    var hadAnalysisRef=useRef(false);
    var selectFile=useCallback(function(path,location){
        dispatchInvestigation({type:'select',path,...location,camera:snapshotZoomTransform(nativeCanvasRef.current?.snapshotScene().camera)});
    },[]);
    selectFileRef.current=selectFile;

    useEffect(function(){

        if(!selected){setBlastRadius(null);return;}
        const blast=calcBlast(selected.path,data.connections,data.files);
        setBlastRadius(blast);

    },[data,investigation.selectedPath,graphConfig.vizType]);
    useEffect(function(){
        if(!selected)return;
        setRightTab('details');setExpandedFns(new Set());
        if(isMobile){setMobilePanel('details');setLegendCollapsed(true);}
    },[investigation.selectedPath,navigation]);
    useEffect(function(){
        setOwnership(null);setOwnerLoading(false);
        if(!selected)return;
        if(localSourceKind){setOwnership([]);return;}
        if(!repoInfo)return;
        let cancelled=false;setOwnerLoading(true);
        GitHub.getBlame(repoInfo.owner,repoInfo.repo,selected.path).then(function(owners){
            if(!cancelled){setOwnership(owners);setOwnerLoading(false);}
        }).catch(function(){if(!cancelled)setOwnerLoading(false);});
        return function(){cancelled=true;};
    },[investigation.selectedPath,repoInfo,localSourceKind]);
    function openCodeFile(path,replace,range){
        dispatchInvestigation({type:'open',path,replace,range,camera:snapshotZoomTransform(nativeCanvasRef.current?.snapshotScene().camera)});
        nativeCanvasRef.current?.focus(path);
    }
    function changeVisualization(view){
        const action={type:'view',view,enter:true,camera:snapshotZoomTransform(nativeCanvasRef.current?.snapshotScene().camera)};
        const next=reduceInvestigation(investigation,action,data);
        if(view==='code'&&next.openedPaths!==investigation.openedPaths)nativeCanvasRef.current?.focus(next.selectedPath);
        dispatchInvestigation(action);
    }
    function closeCodeCard(path){
        const action={type:'close',path,camera:snapshotZoomTransform(nativeCanvasRef.current?.snapshotScene().camera)};
        const next=reduceInvestigation(investigation,action,data);
        if(next.selectedPath!==investigation.selectedPath)nativeCanvasRef.current?.focus(next.selectedPath);
        dispatchInvestigation(action);

    }
    function retryCodeSource(path){
        if(!path)return;
        delete codeSourceInFlightRef.current[path];
        setCodeSourceFailed(function(prev){return clearCodeSourceFailure(prev,path);});
    }

    function revealGraphFile(path,camera){nativeCanvasRef.current?.reveal(path,camera);}
    function goToFile(path){
        if(codeFileNavOpensCard(graphConfig.vizType))openCodeFile(path);
        else{
            var scope=folderFilterAfterCodeNav(path,data,folderFilter);setFolderFilter(scope);
            selectFile(path,{scope:scope});if(graphConfig.vizType==='graph')revealGraphFile(path);
        }
    }
    function navigateHistory(delta){
        const next=reduceInvestigation(investigation,{type:'history',delta,camera:snapshotZoomTransform(nativeCanvasRef.current?.snapshotScene().camera)},data);
        if(next===investigation)return;
        nativeCanvasRef.current?.focus(null);
        dispatchInvestigation({type:'history',delta,camera:snapshotZoomTransform(nativeCanvasRef.current?.snapshotScene().camera)});
        if(next.view==='graph'||next.view==='code')revealGraphFile(next.selectedPath,next.navigation.entries[next.navigation.index].camera);
    }

    function getNodeColor(d){
        if(colorMode==='folder')return colorMap[d.folder]||COLORS[0];
        if(colorMode==='layer')return LAYER_COLORS[d.layer]||LAYER_COLORS['utils'];
        if(colorMode==='churn')return colorMap[d.id]||'#22c55e';
        return COLORS[0];
    }

    var togglePath=useCallback(function(p){setExpandedPaths(function(prev){var n=new Set(prev);if(n.has(p))n.delete(p);else n.add(p);return n;});},[]);
    var toggleCard=useCallback(function(id){setExpandedCards(function(prev){var n=new Set(prev);if(n.has(id))n.delete(id);else n.add(id);return n;});},[]);
    var toggleFn=useCallback(function(name){setExpandedFns(function(prev){var n=new Set(prev);if(n.has(name))n.delete(name);else n.add(name);return n;});},[]);

    const projectSource=createProjectSource({
        identity:currentAnalysisSource(),cli:cliStatus,
        folder:{handle:localDirHandle,sourceKey:localFolderKeyRef.current},
        archive:{entriesByPath:zipArchiveRef.current&&zipArchiveRef.current.entriesByPath,
            sourceKey:zipKeyRef.current,file:zipFileRef.current},
        github:repoInfo?{owner:repoInfo.owner,repo:repoInfo.repo,client:GitHub}:null
    });

    function canReadLiveFileSource(){return !!projectSource;}

    function readCliWatchLiveSource(path){
        if(!path)return Promise.resolve({kind:'error'});
        return fetch('/__codeflow/file?path='+encodeURIComponent(path)).then(function(res){
            var length=Number(res.headers&&res.headers.get?res.headers.get('content-length'):NaN);
            if(cliWatchLiveRejectsOversized(length)){
                if(res.body&&typeof res.body.cancel==='function')res.body.cancel();
                return{kind:'error'};
            }
            if(res.ok)return res.text().then(function(text){return cliWatchLiveFromResponse(res.status,text,true,length);});
            return cliWatchLiveFromResponse(res.status,'',false);
        }).catch(function(){return{kind:'error'};});
    }

    async function readLiveFileSource(path){
        if(!projectSource)return null;
        const result=await projectSource.read(path);
        return result.status==='ready'?result.content:null;
    }

    function rememberHydratedSources(updates){
        if(!updates||!updates.length)return;
        setData(function(prev){return mergeHydratedFileSources(prev,updates,analysisHydrationIdRef.current);});
    }

    // Open file preview
    function openFilePreview(path,line){
        if(!repoInfo)return;
        var filename=path.split('/').pop();
        setFilePreview({path:path,filename:filename,content:null,line:line||null,loading:true,error:null});
        var existingFile=data&&data.files?data.files.find(function(f){return f.path===path;}):null;
        if(existingFile&&existingFile.analysisSkipped){
            setFilePreview({path:path,filename:filename,content:'',line:line||null,loading:false,error:existingFile.analysisSkipped==='oversized'?'Skipped during analysis (file too large)':'File was not fetched during analysis'});
            return;
        }
        if(existingFile&&fileHasLoadedSource(existingFile)){
            setFilePreview({path:path,filename:filename,content:existingFile.content,line:line||null,loading:false,error:null});
            return;
        }
        var previewId=analysisHydrationIdRef.current;
        readLiveFileSource(path).then(function(content){
            if(analysisHydrationIdRef.current!==previewId)return;
            if(typeof content==='string'){
                setFilePreview({path:path,filename:filename,content:content,line:line||null,loading:false,error:null});
                rememberHydratedSources([{path:path,content:content,hydrationId:previewId}]);
                return;
            }
            setFilePreview({path:path,filename:filename,content:null,line:line||null,loading:false,error:canReadLiveFileSource()?'Could not load file content':'Reopen this project to preview source'});
        });
    }

    // Scroll to highlighted line after file preview loads
    useEffect(function(){
        if(filePreview&&filePreview.content&&filePreview.line&&filePreviewRef.current){
            setTimeout(function(){
                var el=filePreviewRef.current.querySelector('.file-preview-line.highlighted');
                if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
            },100);
        }
    },[filePreview]);

    var colorMap=useMemo(function(){
        if(!data)return{};
        var m={};
        if(colorMode==='folder'){data.folders.forEach(function(f,i){m[f]=COLORS[i%COLORS.length];});m['root']=COLORS[0];}
        else if(colorMode==='layer')data.files.forEach(function(f){m[f.path]=LAYER_COLORS[f.layer]||COLORS[0];});
        else if(colorMode==='churn'){
            var maxC=Math.max.apply(null,data.files.map(function(f){return f.churn||0;}))||1;
            data.files.forEach(function(f){var r=(f.churn||0)/maxC;m[f.path]=r>0.7?'#ff5f5f':r>0.4?'#ff9f43':'#22c55e';});
        }
        return m;
    },[data,colorMode]);

    var codeViewFiles=useMemo(function(){
        if(!data)return[];
        return filesForOpenedCodePaths(openedCodePaths,data,folderFilter);
    },[data,openedCodePaths,folderFilter,graphConfig.vizType,selected&&selected.path]);
    useEffect(function(){
        var source=currentAnalysisSource();if(!source)return;
        var sceneIdentity=source.sourceType+':'+source.sourceKey;
        if(sceneIdentity===openedSceneRef.current)return;
        openedSceneRef.current=sceneIdentity;
        dispatchInvestigation({type:'reset',view:graphConfig.vizType});setSelectedArchitectureBlock(null);setFileQuery('');
        setRestoredNativeScene(null);
        codeSourceInFlightRef.current=Object.create(null);
        setCodeSourceFailed(Object.create(null));
        nativeCanvasRef.current?.focus(null);
    },[currentHydrationId]);
    useEffect(function(){
        if(!data){workspaceKeyRef.current=null;return;}
        var source=currentAnalysisSource();if(!source)return;
        var key='codeflow:workspace:'+source.sourceType+':'+source.sourceKey;
        if(workspaceKeyRef.current===key)return;
        workspaceKeyRef.current=key;
        var restored;
        try{
            // Migrate the earlier BEAM-only storage key once; keep the user's cards.
            var legacy='codeflow:beam-workspace:'+source.sourceKey;
            var saved=localStorage.getItem(key)||localStorage.getItem(legacy);
            restored=restoreWorkspace(JSON.parse(saved),data);
            if(restored){localStorage.setItem(key,JSON.stringify(restored));localStorage.removeItem(legacy);}
        }catch(e){}
        if(!restored)return;
        workspaceRestoreRef.current=['graph','code'].includes(restored.view)?restored:null;
        setSelectedArchitectureBlock(restored.architectureBlockId);
        setRestoredNativeScene(restored);
        dispatchInvestigation({type:'restore',workspace:restored});
    },[currentHydrationId]);
    useEffect(function(){
        if(!data)return;
        function save(){
            if(!workspaceKeyRef.current||workspaceRestoreRef.current)return;
            try{localStorage.setItem(workspaceKeyRef.current,JSON.stringify({version:1,scope:folderFilter,selected:selected&&selected.path,
                opened:openedCodePaths,view:graphConfig.vizType,architectureBlockId:selectedArchitectureBlock,navigation:navigation,...nativeCanvasRef.current?.snapshotScene()}));}catch(e){}
        }
        var timer=setInterval(save,1000);window.addEventListener('pagehide',save);
        return function(){clearInterval(timer);window.removeEventListener('pagehide',save);};
    },[currentHydrationId,folderFilter,selected&&selected.path,openedCodePaths,graphConfig.vizType,selectedArchitectureBlock,navigation]);

    useEffect(function(){
        if(data&&!hadAnalysisRef.current)setLeftTab('overview');
        hadAnalysisRef.current=!!data;
    },[data]);

    function persistLineThickness(value){
        var next=persistUiPrefs({lineThickness:value}).lineThickness;
        setLineThickness(next);
    }

    useEffect(function(){
        var missing=filesNeedingSource(codeViewFiles);
        if(!missing.length||!canReadLiveFileSource())return;
        var inflight=codeSourceInFlightRef.current;
        var hydrationId=analysisHydrationIdRef.current;
        nextCodeSourceReads(missing.map(function(file){return file.path;}),inflight,codeSourceFailed).forEach(function(path){
            inflight[path]=true;
            readLiveFileSource(path).then(function(content){
                if(typeof content==='string'){
                    rememberHydratedSources([{path:path,content:content,hydrationId:hydrationId}]);
                    setCodeSourceFailed(function(prev){return clearCodeSourceFailureIfCurrent(prev,path,hydrationId,analysisHydrationIdRef.current);});
                    return;
                }
                setCodeSourceFailed(function(prev){return recordCodeSourceFailureIfCurrent(prev,path,hydrationId,analysisHydrationIdRef.current);});
            }).then(function(){delete inflight[path];},function(){
                delete inflight[path];
                setCodeSourceFailed(function(prev){return recordCodeSourceFailureIfCurrent(prev,path,hydrationId,analysisHydrationIdRef.current);});
            });
        });
    },[codeViewFiles,localSourceKind,cliStatus,repoInfo,localDirHandle,codeSourceFailed]);

    // Treemap visualization - Interactive with zoom, pan, selection, blast radius
    useEffect(function(){
        if(!data||!treemapRef.current||graphConfig.vizType!=='treemap')return;
        var container=d3.select(treemapRef.current);
        container.selectAll('*').remove();
        var w=treemapRef.current.clientWidth||800,h=treemapRef.current.clientHeight||600;
        var svg=container.append('svg').attr('width',w).attr('height',h).style('cursor','grab');
        var g=svg.append('g');
        var zoom=d3.zoom().scaleExtent([0.3,4]).on('zoom',function(e){g.attr('transform',e.transform);svg.style('cursor',e.transform.k>1?'grab':'default');});
        svg.call(zoom);
        var hier={name:'root',children:[]};
        var folderMap={};
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        filteredFiles.forEach(function(f){
            var folder=f.folder||'root';
            if(!folderMap[folder])folderMap[folder]={name:folder,children:[]};
            folderMap[folder].children.push({name:f.name,value:f.lines||1,path:f.path,layer:f.layer,fns:f.functions.length,folder:folder});
        });
        hier.children=Object.values(folderMap);
        var root=d3.hierarchy(hier).sum(function(d){return d.value||0;}).sort(function(a,b){return b.value-a.value;});
        d3.treemap().size([w-20,h-20]).padding(3).round(true)(root);
        var pathToLeaf={};
        root.leaves().forEach(function(leaf){if(leaf.data.path)pathToLeaf[leaf.data.path]=leaf;});
        var cells=g.selectAll('g.treemap-cell-g').data(root.leaves()).join('g').attr('class','treemap-cell-g')
            .attr('transform',function(d){return'translate('+d.x0+','+d.y0+')';});
        cells.append('rect').attr('class','treemap-rect').attr('width',function(d){return Math.max(0,d.x1-d.x0);}).attr('height',function(d){return Math.max(0,d.y1-d.y0);})
            .attr('fill',function(d){return colorMap[d.parent.data.name]||COLORS[hier.children.indexOf(d.parent.data)%COLORS.length];})
            .attr('opacity',0.85).attr('rx',3).attr('stroke','var(--bg0)').attr('stroke-width',1).style('cursor','pointer');
        cells.filter(function(d){return d.x1-d.x0>45&&d.y1-d.y0>22;}).append('text').attr('class','treemap-text')
            .attr('x',4).attr('y',14).attr('fill','white').attr('font-size','10px').attr('font-weight','500').style('text-shadow','0 1px 2px rgba(0,0,0,0.5)').style('pointer-events','none')
            .text(function(d){var n=d.data.name.replace(/\.[^.]+$/,'');var maxLen=Math.floor((d.x1-d.x0-8)/6);return n.length>maxLen?n.slice(0,maxLen-1)+'…':n;});
        cells.filter(function(d){return d.x1-d.x0>60&&d.y1-d.y0>35;}).append('text').attr('class','treemap-subtext')
            .attr('x',4).attr('y',26).attr('fill','rgba(255,255,255,0.7)').attr('font-size','8px').style('pointer-events','none')
            .text(function(d){return d.data.value+' lines';});
        var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
        cells.on('mouseenter',function(e,d){
            tooltip.html(renderTooltipHtml(d.data.name,[
                {label:'Lines',value:d.data.value},
                {label:'Functions',value:d.data.fns||0},
                {label:'Layer',value:d.data.layer||'—'},
                {label:'Folder',value:d.data.folder||'root'}
            ]))
                .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
            d3.select(this).select('rect').transition().duration(150).attr('opacity',1).attr('stroke','var(--acc)').attr('stroke-width',2);
        }).on('mousemove',function(e){tooltip.style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');})
        .on('mouseleave',function(e,d){
            tooltip.style('display','none');
            var sel=selected?selected.path:null;
            var isSelected=d.data.path===sel;
            var isAffected=blastRadius&&blastRadius.affected.includes(d.data.path);
            d3.select(this).select('rect').transition().duration(150).attr('opacity',isSelected?1:isAffected?0.95:0.85).attr('stroke',isSelected?'#ff5f5f':isAffected?'var(--orange)':'var(--bg0)').attr('stroke-width',isSelected||isAffected?2:1);
        }).on('click',function(e,d){
            e.stopPropagation();
            if(d.data.path&&selectFileRef.current){
                selectFileRef.current(d.data.path);
                setTimeout(function(){
                    var blast=blastRadius;
                    cells.select('rect').transition().duration(300)
                        .attr('opacity',function(n){return n.data.path===d.data.path?1:(blast&&blast.affected.includes(n.data.path))?0.95:0.4;})
                        .attr('fill',function(n){return n.data.path===d.data.path?'#ff5f5f':(blast&&blast.affected.includes(n.data.path))?'#ff9f43':colorMap[n.parent.data.name]||COLORS[0];})
                        .attr('stroke',function(n){return n.data.path===d.data.path?'#ff5f5f':(blast&&blast.affected.includes(n.data.path))?'var(--orange)':'var(--bg0)';})
                        .attr('stroke-width',function(n){return n.data.path===d.data.path||blast&&blast.affected.includes(n.data.path)?2:1;});
                },100);
            }
        });
        svg.on('click',function(){
            setSelected(null);setBlastRadius(null);
            cells.select('rect').transition().duration(300).attr('opacity',0.85).attr('fill',function(d){return colorMap[d.parent.data.name]||COLORS[0];}).attr('stroke','var(--bg0)').attr('stroke-width',1);
        });
        svg.on('dblclick.zoom',function(e){e.preventDefault();svg.transition().duration(300).call(zoom.scaleTo,1);});
    },[data,graphConfig.vizType,colorMap,folderFilter,selected,blastRadius]);

    // Dependency Matrix visualization - Interactive with zoom, highlighting, selection
    useEffect(function(){
        if(!data||!matrixRef.current||graphConfig.vizType!=='matrix')return;
        var container=d3.select(matrixRef.current);
        container.selectAll('*').remove();
        var w=matrixRef.current.clientWidth||800,h=matrixRef.current.clientHeight||600;
        var svg=container.append('svg').attr('width',w).attr('height',h);
        var g=svg.append('g').attr('transform','translate(100,80)');
        var zoom=d3.zoom().scaleExtent([0.5,3]).on('zoom',function(e){g.attr('transform','translate('+(100+e.transform.x)+','+(80+e.transform.y)+') scale('+e.transform.k+')');});
        svg.call(zoom);
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        var files=filteredFiles.slice(0,40);
        var n=files.length;
        var cellSize=Math.min(18,Math.max(10,(Math.min(w-120,h-100))/n));
        var matrix=[];var fileIdx={};
        files.forEach(function(f,i){fileIdx[f.path]=i;matrix[i]=[];for(var j=0;j<n;j++)matrix[i][j]=0;});
        data.connections.forEach(function(c){
            var src=typeof c.source==='object'?c.source.id:c.source;
            var tgt=typeof c.target==='object'?c.target.id:c.target;
            if(fileIdx[src]!==undefined&&fileIdx[tgt]!==undefined)matrix[fileIdx[src]][fileIdx[tgt]]+=c.count||1;
        });
        var maxVal=1;matrix.forEach(function(row){row.forEach(function(v){if(v>maxVal)maxVal=v;});});
        var colLabels=g.selectAll('text.col-label').data(files).join('text').attr('class','col-label')
            .attr('x',function(d,i){return i*cellSize+cellSize/2;}).attr('y',-8).attr('text-anchor','start').attr('transform',function(d,i){return'rotate(-45,'+(i*cellSize+cellSize/2)+','+-8+')';})
            .attr('fill','var(--t2)').attr('font-size','9px').text(function(d){var n=d.name.replace(/\.[^.]+$/,'');return n.length>10?n.slice(0,8)+'…':n;}).style('cursor','pointer')
            .on('click',function(e,d){if(selectFileRef.current)selectFileRef.current(d.path);});
        var rowLabels=g.selectAll('text.row-label').data(files).join('text').attr('class','row-label')
            .attr('x',-8).attr('y',function(d,i){return i*cellSize+cellSize/2+3;}).attr('text-anchor','end')
            .attr('fill','var(--t2)').attr('font-size','9px').text(function(d){var n=d.name.replace(/\.[^.]+$/,'');return n.length>10?n.slice(0,8)+'…':n;}).style('cursor','pointer')
            .on('click',function(e,d){if(selectFileRef.current)selectFileRef.current(d.path);});
        var cellData=[];
        files.forEach(function(f,i){files.forEach(function(g,j){cellData.push({row:i,col:j,value:matrix[i][j],source:f,target:g});});});
        var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
        var cells=g.selectAll('rect.matrix-cell-rect').data(cellData).join('rect').attr('class','matrix-cell-rect')
            .attr('x',function(d){return d.col*cellSize;}).attr('y',function(d){return d.row*cellSize;})
            .attr('width',cellSize-1).attr('height',cellSize-1).attr('rx',2)
            .attr('fill',function(d){return d.value>0?'rgba(0,255,157,'+Math.max(0.15,d.value/maxVal)+')':'var(--bg2)';})
            .attr('stroke','var(--bg0)').attr('stroke-width',0.5).style('cursor','pointer');
        cells.on('mouseenter',function(e,d){
            tooltip.html(renderTooltipHtml(d.source.name+' → '+d.target.name,[
                {label:'Connections',value:d.value}
            ]))
                .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
            g.selectAll('rect.matrix-cell-rect').attr('opacity',function(c){return c.row===d.row||c.col===d.col?1:0.3;});
            colLabels.attr('fill',function(f,i){return i===d.col?'var(--acc)':'var(--t2)';}).attr('font-weight',function(f,i){return i===d.col?'600':'400';});
            rowLabels.attr('fill',function(f,i){return i===d.row?'var(--acc)':'var(--t2)';}).attr('font-weight',function(f,i){return i===d.row?'600':'400';});
            d3.select(this).attr('stroke','var(--acc)').attr('stroke-width',2);
        }).on('mousemove',function(e){tooltip.style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');})
        .on('mouseleave',function(){
            tooltip.style('display','none');
            cells.attr('opacity',1);
            colLabels.attr('fill','var(--t2)').attr('font-weight','400');
            rowLabels.attr('fill','var(--t2)').attr('font-weight','400');
            d3.select(this).attr('stroke','var(--bg0)').attr('stroke-width',0.5);
        }).on('click',function(e,d){e.stopPropagation();if(selectFileRef.current)selectFileRef.current(d.source.path);});
        var legend=container.append('div').attr('class','heatmap-legend').style('position','absolute').style('bottom','60px').style('right','20px');
        legend.html('<div style="font-size:9px;color:var(--t2)">Connection Strength</div><div class="heatmap-gradient"></div><div style="display:flex;justify-content:space-between;font-size:8px;color:var(--t3)"><span>0</span><span>'+maxVal+'</span></div>');
    },[data,graphConfig.vizType,folderFilter]);

    // Cluster Dendrogram - Hierarchical tree visualization
    useEffect(function(){
        if(!data||!dendroRef.current||graphConfig.vizType!=='dendro')return;
        var container=d3.select(dendroRef.current);
        container.selectAll('*').remove();
        var w=dendroRef.current.clientWidth||800,h=dendroRef.current.clientHeight||600;
        var svg=container.append('svg').attr('width',w).attr('height',h);
        var g=svg.append('g').attr('transform','translate(80,20)');
        var zoom=d3.zoom().scaleExtent([0.3,3]).on('zoom',function(e){g.attr('transform','translate('+(80+e.transform.x)+','+(20+e.transform.y)+') scale('+e.transform.k+')');});
        svg.call(zoom);
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        var hier={name:'root',children:[]};
        var folderMap={};
        filteredFiles.slice(0,80).forEach(function(f){
            var folder=f.folder||'root';
            if(!folderMap[folder])folderMap[folder]={name:folder.split('/').pop()||'root',fullPath:folder,children:[]};
            folderMap[folder].children.push({name:f.name,path:f.path,fns:f.functions.length,lines:f.lines,folder:folder,layer:f.layer});
        });
        hier.children=Object.values(folderMap);
        var root=d3.hierarchy(hier);
        var treeLayout=d3.cluster().size([h-60,w-200]);
        treeLayout(root);
        var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
        g.selectAll('path.dendro-link').data(root.links()).join('path').attr('class','dendro-link')
            .attr('d',function(d){return'M'+d.source.y+','+d.source.x+'C'+(d.source.y+d.target.y)/2+','+d.source.x+' '+(d.source.y+d.target.y)/2+','+d.target.x+' '+d.target.y+','+d.target.x;})
            .attr('fill','none').attr('stroke','var(--border)').attr('stroke-width',scaleStrokeWidth(1.5,lineThickness)).attr('stroke-opacity',0.6);
        var node=g.selectAll('g.dendro-node').data(root.descendants()).join('g').attr('class','dendro-node')
            .attr('transform',function(d){return'translate('+d.y+','+d.x+')';}).style('cursor','pointer');
        node.append('circle').attr('r',function(d){return d.children?6:8;})
            .attr('fill',function(d){return d.children?'var(--bg3)':colorMap[d.data.folder]||COLORS[0];})
            .attr('stroke',function(d){return d.children?'var(--t3)':'var(--bg0)';}).attr('stroke-width',2);
        node.filter(function(d){return!d.children;}).append('text').attr('x',12).attr('dy','0.35em')
            .attr('fill','var(--t1)').attr('font-size','9px').text(function(d){var n=d.data.name.replace(/\.[^.]+$/,'');return n.length>20?n.slice(0,18)+'…':n;});
        node.filter(function(d){return d.children&&d.depth>0;}).append('text').attr('x',-10).attr('dy','0.35em').attr('text-anchor','end')
            .attr('fill','var(--t2)').attr('font-size','10px').attr('font-weight','600').text(function(d){return d.data.name;});
        node.on('mouseenter',function(e,d){
            if(!d.data.path)return;
            tooltip.html(renderTooltipHtml(d.data.name,[
                {label:'Lines',value:d.data.lines||0},
                {label:'Functions',value:d.data.fns||0},
                {label:'Layer',value:d.data.layer||'—'}
            ]))
                .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
            d3.select(this).select('circle').transition().duration(150).attr('r',12).attr('stroke','var(--acc)').attr('stroke-width',3);
        }).on('mousemove',function(e){tooltip.style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');})
        .on('mouseleave',function(e,d){
            tooltip.style('display','none');
            d3.select(this).select('circle').transition().duration(150).attr('r',d.children?6:8).attr('stroke',d.children?'var(--t3)':'var(--bg0)').attr('stroke-width',2);
        }).on('click',function(e,d){
            e.stopPropagation();
            if(d.data.path&&selectFileRef.current)selectFileRef.current(d.data.path);
            else if(d.data.fullPath)filterByFolder(d.data.fullPath);
        });
    },[data,graphConfig.vizType,colorMap,folderFilter,lineThickness]);

    // Sankey Diagram - Flow visualization showing dependencies between folders
    useEffect(function(){
        if(!data||!sankeyRef.current||graphConfig.vizType!=='sankey')return;
        var container=d3.select(sankeyRef.current);
        container.selectAll('*').remove();
        var w=sankeyRef.current.clientWidth||800,h=sankeyRef.current.clientHeight||600;
        var svg=container.append('svg').attr('width',w).attr('height',h);
        var g=svg.append('g').attr('transform','translate(20,20)');
        var zoom=d3.zoom().scaleExtent([0.5,2]).on('zoom',function(e){g.attr('transform','translate('+(20+e.transform.x)+','+(20+e.transform.y)+') scale('+e.transform.k+')');});
        svg.call(zoom);
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        var folders=[...new Set(filteredFiles.map(function(f){return f.folder||'root';}))].slice(0,15);
        var folderIdx={};folders.forEach(function(f,i){folderIdx[f]=i;});
        var filteredPaths=new Set(filteredFiles.map(function(f){return f.path;}));
        var flowMap={};
        data.connections.forEach(function(c){
            var src=typeof c.source==='object'?c.source.id:c.source;
            var tgt=typeof c.target==='object'?c.target.id:c.target;
            if(!filteredPaths.has(src)&&!filteredPaths.has(tgt))return;
            var srcFile=data.files.find(function(f){return f.path===src;});
            var tgtFile=data.files.find(function(f){return f.path===tgt;});
            if(srcFile&&tgtFile&&srcFile.folder!==tgtFile.folder){
                var key=srcFile.folder+'|'+tgtFile.folder;
                flowMap[key]=(flowMap[key]||0)+(c.count||1);
            }
        });
        var nodes=folders.map(function(f,i){return{id:i,name:f.split('/').pop()||'root',fullPath:f,fileCount:filteredFiles.filter(function(x){return x.folder===f;}).length};});
        // Merge bidirectional flows to avoid circular link errors
        var linkMap={};
        Object.entries(flowMap).forEach(function(e){
            var parts=e[0].split('|'),val=e[1];
            var si=folderIdx[parts[0]],ti=folderIdx[parts[1]];
            if(si!==undefined&&ti!==undefined&&si!==ti){
                var key=Math.min(si,ti)+'|'+Math.max(si,ti);
                if(!linkMap[key])linkMap[key]={a:Math.min(si,ti),b:Math.max(si,ti),ab:0,ba:0};
                if(si<ti)linkMap[key].ab+=val;else linkMap[key].ba+=val;
            }
        });
        var links=[];
        Object.values(linkMap).forEach(function(l){
            var net=l.ab-l.ba;
            if(net>0)links.push({source:l.a,target:l.b,value:net});
            else if(net<0)links.push({source:l.b,target:l.a,value:-net});
            else if(l.ab>0)links.push({source:l.a,target:l.b,value:l.ab});
        });
        if(links.length===0){
            g.append('text').attr('x',w/2-20).attr('y',h/2).attr('fill','var(--t3)').attr('font-size','12px').text('No cross-folder dependencies to visualize');
            return;
        }
        var sankey=d3.sankey().nodeId(function(d){return d.id;}).nodeWidth(20).nodePadding(15).extent([[0,0],[w-60,h-60]]);
        var graph;
        try{
            graph=sankey({nodes:nodes.map(function(d){return Object.assign({},d);}),links:links.map(function(d){return Object.assign({},d);})});
        }catch(e){
            g.append('text').attr('x',w/2-20).attr('y',h/2).attr('fill','var(--t3)').attr('font-size','12px').attr('text-anchor','middle').text('Sankey diagram unavailable: dependency graph has circular references. Try the Force Graph view.');
            return;
        }
        var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
        g.selectAll('path.sankey-link').data(graph.links).join('path').attr('class','sankey-link')
            .attr('d',d3.sankeyLinkHorizontal()).attr('fill','none')
            .attr('stroke',function(d){return colorMap[d.source.fullPath]||COLORS[d.source.id%COLORS.length];})
            .attr('stroke-width',function(d){return scaleStrokeWidth(Math.max(2,d.width),lineThickness);}).attr('stroke-opacity',0.4)
            .on('mouseenter',function(e,d){
                d3.select(this).attr('stroke-opacity',0.8);
                tooltip.html(renderTooltipHtml(d.source.name+' → '+d.target.name,[
                    {label:'Connections',value:d.value}
                ]))
                    .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
            }).on('mouseleave',function(){d3.select(this).attr('stroke-opacity',0.4);tooltip.style('display','none');});
        var node=g.selectAll('g.sankey-node').data(graph.nodes).join('g').attr('class','sankey-node').style('cursor','pointer');
        node.append('rect').attr('x',function(d){return d.x0;}).attr('y',function(d){return d.y0;})
            .attr('width',function(d){return d.x1-d.x0;}).attr('height',function(d){return Math.max(4,d.y1-d.y0);})
            .attr('fill',function(d){return colorMap[d.fullPath]||COLORS[d.id%COLORS.length];}).attr('rx',3);
        node.append('text').attr('x',function(d){return d.x0<w/2?d.x1+8:d.x0-8;}).attr('y',function(d){return(d.y0+d.y1)/2;})
            .attr('dy','0.35em').attr('text-anchor',function(d){return d.x0<w/2?'start':'end';})
            .attr('fill','var(--t1)').attr('font-size','10px').attr('font-weight','500').text(function(d){return d.name+' ('+d.fileCount+')';});
        node.on('mouseenter',function(e,d){
            tooltip.html(renderTooltipHtml(d.fullPath,[
                {label:'Files',value:d.fileCount}
            ]))
                .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
            g.selectAll('path.sankey-link').attr('stroke-opacity',function(l){return l.source.id===d.id||l.target.id===d.id?0.8:0.1;});
        }).on('mouseleave',function(){tooltip.style('display','none');g.selectAll('path.sankey-link').attr('stroke-opacity',0.4);})
        .on('click',function(e,d){e.stopPropagation();filterByFolder(d.fullPath);});
    },[data,graphConfig.vizType,colorMap,folderFilter,lineThickness]);

    // Disjoint Force-Directed - Separate clusters per folder
    useEffect(function(){
        if(!data||!disjointRef.current||graphConfig.vizType!=='disjoint')return;
        var container=d3.select(disjointRef.current);
        container.selectAll('*').remove();
        var w=disjointRef.current.clientWidth||800,h=disjointRef.current.clientHeight||600;
        var svg=container.append('svg').attr('width',w).attr('height',h);
        var g=svg.append('g');
        var zoom=d3.zoom().scaleExtent([0.2,4]).on('zoom',function(e){g.attr('transform',e.transform);});
        svg.call(zoom);
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        var files=filteredFiles.slice(0,100);
        var fileIdx={};files.forEach(function(f,i){fileIdx[f.path]=i;});
        var folders=[...new Set(files.map(function(f){return f.folder||'root';}))];
        var cols=Math.ceil(Math.sqrt(folders.length));
        var cellW=w/cols,cellH=h/Math.ceil(folders.length/cols);
        var centers={};
        folders.forEach(function(f,i){centers[f]={x:(i%cols+0.5)*cellW,y:(Math.floor(i/cols)+0.5)*cellH};});
        var nodes=files.map(function(f){return{id:f.path,name:f.name,folder:f.folder||'root',fns:f.functions.length,lines:f.lines,layer:f.layer,cx:centers[f.folder||'root'].x,cy:centers[f.folder||'root'].y};});
        var links=[];
        data.connections.forEach(function(c){
            var src=typeof c.source==='object'?c.source.id:c.source;
            var tgt=typeof c.target==='object'?c.target.id:c.target;
            if(fileIdx[src]!==undefined&&fileIdx[tgt]!==undefined&&src!==tgt)links.push({source:src,target:tgt,count:c.count||1});
        });
        var sim=d3.forceSimulation(nodes)
            .force('link',d3.forceLink(links).id(function(d){return d.id;}).distance(40).strength(0.3))
            .force('charge',d3.forceManyBody().strength(-80))
            .force('x',d3.forceX(function(d){return d.cx;}).strength(0.15))
            .force('y',d3.forceY(function(d){return d.cy;}).strength(0.15))
            .force('collide',d3.forceCollide(15));
        g.selectAll('rect.cluster-bg').data(folders).join('rect').attr('class','cluster-bg')
            .attr('x',function(d,i){return(i%cols)*cellW+10;}).attr('y',function(d,i){return Math.floor(i/cols)*cellH+10;})
            .attr('width',cellW-20).attr('height',cellH-20).attr('rx',12)
            .attr('fill',function(d){return colorMap[d]||COLORS[folders.indexOf(d)%COLORS.length];}).attr('opacity',0.08)
            .attr('stroke',function(d){return colorMap[d]||COLORS[folders.indexOf(d)%COLORS.length];}).attr('stroke-width',1).attr('stroke-opacity',0.3);
        g.selectAll('text.cluster-label').data(folders).join('text').attr('class','cluster-label')
            .attr('x',function(d,i){return(i%cols)*cellW+20;}).attr('y',function(d,i){return Math.floor(i/cols)*cellH+28;})
            .attr('fill','var(--t2)').attr('font-size','11px').attr('font-weight','600').text(function(d){return d.split('/').pop()||'root';});
        var link=g.selectAll('line.disjoint-link').data(links).join('line').attr('class','disjoint-link')
            .attr('stroke','var(--border)').attr('stroke-width',scaleStrokeWidth(1,lineThickness)).attr('stroke-opacity',0.3);
        var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
        var node=g.selectAll('g.disjoint-node').data(nodes).join('g').attr('class','disjoint-node').style('cursor','pointer')
            .call(d3.drag().on('start',function(e,d){if(!e.active)sim.alphaTarget(0.3).restart();d.fx=d.x;d.fy=d.y;})
                .on('drag',function(e,d){d.fx=e.x;d.fy=e.y;}).on('end',function(e,d){if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));
        node.append('circle').attr('class','disjoint-circle').attr('r',function(d){return Math.max(6,Math.min(14,4+d.fns));})
            .attr('fill',function(d){return colorMap[d.folder]||COLORS[0];}).attr('stroke','var(--bg0)').attr('stroke-width',1.5);
        node.on('mouseenter',function(e,d){
            tooltip.html(renderTooltipHtml(d.name,[
                {label:'Lines',value:d.lines||0},
                {label:'Functions',value:d.fns||0},
                {label:'Folder',value:d.folder}
            ]))
                .style('display','block').style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');
            link.attr('stroke-opacity',function(l){return l.source.id===d.id||l.target.id===d.id?0.8:0.05;}).attr('stroke',function(l){return l.source.id===d.id||l.target.id===d.id?'var(--acc)':'var(--border)';});
            d3.select(this).select('circle').transition().duration(150).attr('r',14).attr('stroke','var(--acc)').attr('stroke-width',2);
        }).on('mousemove',function(e){tooltip.style('left',(e.offsetX+15)+'px').style('top',(e.offsetY+15)+'px');})
        .on('mouseleave',function(e,d){
            tooltip.style('display','none');
            link.attr('stroke-opacity',0.3).attr('stroke','var(--border)');
            d3.select(this).select('circle').transition().duration(150).attr('r',Math.max(6,Math.min(14,4+d.fns))).attr('stroke','var(--bg0)').attr('stroke-width',1.5);
        }).on('click',function(e,d){e.stopPropagation();if(selectFileRef.current)selectFileRef.current(d.id);});
        sim.on('tick',function(){
            link.attr('x1',function(d){return d.source.x;}).attr('y1',function(d){return d.source.y;}).attr('x2',function(d){return d.target.x;}).attr('y2',function(d){return d.target.y;});
            node.attr('transform',function(d){return'translate('+d.x+','+d.y+')';});
        });
        svg.on('click',function(){setSelected(null);setBlastRadius(null);});
        return function(){sim.stop();};
    },[data,graphConfig.vizType,colorMap,folderFilter,lineThickness]);

    // Circular Bundle visualization - Interactive with zoom, selection, blast radius
    useEffect(function(){
        if(!data||!bundleRef.current||graphConfig.vizType!=='bundle')return;
        var container=d3.select(bundleRef.current);
        container.selectAll('*').remove();
        var w=bundleRef.current.clientWidth||800,h=bundleRef.current.clientHeight||600;
        var svg=container.append('svg').attr('width',w).attr('height',h);
        var mainG=svg.append('g').attr('transform','translate('+w/2+','+h/2+')');
        var zoom=d3.zoom().scaleExtent([0.4,3]).on('zoom',function(e){mainG.attr('transform','translate('+(w/2+e.transform.x)+','+(h/2+e.transform.y)+') scale('+e.transform.k+')');});
        svg.call(zoom);
        var radius=Math.min(w,h)/2-100;
        var filteredFiles=folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}):data.files;
        var files=filteredFiles.slice(0,70);
        var fileIdx={};files.forEach(function(f,i){fileIdx[f.path]=i;});
        var folderGroups={};files.forEach(function(f){var folder=f.folder||'root';if(!folderGroups[folder])folderGroups[folder]=[];folderGroups[folder].push(f);});
        var nodes=[],angle=0;
        var sortedFolders=Object.entries(folderGroups).sort(function(a,b){return b[1].length-a[1].length;});
        sortedFolders.forEach(function(entry){
            var folder=entry[0],fls=entry[1];
            var step=2*Math.PI*fls.length/files.length;
            fls.forEach(function(f){
                nodes.push({id:f.path,name:f.name,folder:folder,angle:angle,x:Math.cos(angle-Math.PI/2)*radius,y:Math.sin(angle-Math.PI/2)*radius,layer:f.layer,fns:f.functions.length,lines:f.lines});
                angle+=step/fls.length;
            });
        });
        var nodeMap={};nodes.forEach(function(n){nodeMap[n.id]=n;});
        var links=[];
        data.connections.forEach(function(c){
            var src=typeof c.source==='object'?c.source.id:c.source;
            var tgt=typeof c.target==='object'?c.target.id:c.target;
            if(nodeMap[src]&&nodeMap[tgt]&&src!==tgt)links.push({source:nodeMap[src],target:nodeMap[tgt],count:c.count||1});
        });
        function isBundleLinkMatch(nodeId,linkDatum){
            return linkDatum.source.id===nodeId||linkDatum.target.id===nodeId;
        }
        function getBundleLinkColor(linkDatum){
            return colorMap[linkDatum.source.folder]||'var(--acc)';
        }
        function getBundleDirectConnections(nodeId){
            var connected=new Set([nodeId]);
            links.forEach(function(linkDatum){
                if(isBundleLinkMatch(nodeId,linkDatum)){
                    connected.add(linkDatum.source.id);
                    connected.add(linkDatum.target.id);
                }
            });
            return connected;
        }
        var link=mainG.selectAll('path.bundle-link').data(links).join('path').attr('class','bundle-link')
            .attr('d',function(d){
                var a1=d.source.angle,a2=d.target.angle;
                var x1=Math.cos(a1-Math.PI/2)*(radius-15),y1=Math.sin(a1-Math.PI/2)*(radius-15);
                var x2=Math.cos(a2-Math.PI/2)*(radius-15),y2=Math.sin(a2-Math.PI/2)*(radius-15);
                var midAngle=(a1+a2)/2;
                var tension=0.3*radius;
                var cx=Math.cos(midAngle-Math.PI/2)*tension,cy=Math.sin(midAngle-Math.PI/2)*tension;
                return'M'+x1+','+y1+'Q'+cx+','+cy+' '+x2+','+y2;
            })
            .attr('fill','none').attr('stroke',getBundleLinkColor)
            .attr('stroke-width',scaleStrokeWidth(1.8,lineThickness)).attr('stroke-opacity',0.35);
        var tooltip=container.append('div').attr('class','treemap-tooltip').style('display','none').style('position','absolute');
        var node=mainG.selectAll('g.bundle-node').data(nodes).join('g').attr('class','bundle-node').style('cursor','pointer')
            .attr('transform',function(d){return'rotate('+(d.angle*180/Math.PI-90)+') translate('+radius+',0)'+(d.angle>Math.PI?' rotate(180)':'');});
        node.append('circle').attr('class','bundle-circle').attr('r',6).attr('fill',function(d){return colorMap[d.folder]||COLORS[0];}).attr('stroke','var(--bg0)').attr('stroke-width',1.5)
            .attr('transform',function(d){return d.angle>Math.PI?'translate(-6,0)':'translate(6,0)';});
        node.append('text').attr('dy','0.31em').attr('x',function(d){return d.angle>Math.PI?-14:14;}).attr('text-anchor',function(d){return d.angle>Math.PI?'end':'start';})
            .attr('fill','var(--t2)').attr('font-size','9px').text(function(d){var n=d.name.replace(/\.[^.]+$/,'');return n.length>16?n.slice(0,13)+'…':n;});
        function applyBundleDefaultState(){
            link.transition().duration(200)
                .attr('stroke-opacity',0.35)
                .attr('stroke-width',scaleStrokeWidth(1.8,lineThickness))
                .attr('stroke',getBundleLinkColor);
            node.selectAll('.bundle-circle').transition().duration(200)
                .attr('fill',function(d){return colorMap[d.folder]||COLORS[0];})
                .attr('opacity',1)
                .attr('r',6)
                .attr('stroke','var(--bg0)')
                .attr('stroke-width',1.5);
        }
        function applyBundleHoverState(nodeId){
            var directConnections=getBundleDirectConnections(nodeId);
            link.transition().duration(200)
                .attr('stroke-opacity',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?0.88:0.04;})
                .attr('stroke-width',function(linkDatum){return scaleStrokeWidth(isBundleLinkMatch(nodeId,linkDatum)?3.1:1,lineThickness);})
                .attr('stroke',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?'var(--acc)':getBundleLinkColor(linkDatum);});
            node.selectAll('.bundle-circle').transition().duration(200)
                .attr('opacity',function(nodeDatum){return directConnections.has(nodeDatum.id)?1:0.22;})
                .attr('r',function(nodeDatum){return nodeDatum.id===nodeId?9:6;})
                .attr('stroke',function(nodeDatum){return nodeDatum.id===nodeId?'var(--acc)':'var(--bg0)';})
                .attr('stroke-width',function(nodeDatum){return nodeDatum.id===nodeId?2:1.5;});
        }
        function applyBundleSelectionState(nodeId,blast){
            var directConnections=getBundleDirectConnections(nodeId);
            var affectedSet=new Set(blast&&blast.affected?blast.affected:[]);
            link.transition().duration(300)
                .attr('stroke-opacity',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?0.96:0.08;})
                .attr('stroke-width',function(linkDatum){return scaleStrokeWidth(isBundleLinkMatch(nodeId,linkDatum)?3.6:1.15,lineThickness);})
                .attr('stroke',function(linkDatum){return isBundleLinkMatch(nodeId,linkDatum)?'#ff9f43':getBundleLinkColor(linkDatum);});
            node.selectAll('.bundle-circle').transition().duration(300)
                .attr('fill',function(nodeDatum){return nodeDatum.id===nodeId?'#ff5f5f':affectedSet.has(nodeDatum.id)?'#ff9f43':colorMap[nodeDatum.folder]||COLORS[0];})
                .attr('opacity',function(nodeDatum){return directConnections.has(nodeDatum.id)||affectedSet.has(nodeDatum.id)?1:0.22;})
                .attr('r',function(nodeDatum){return nodeDatum.id===nodeId?9:6;})
                .attr('stroke',function(nodeDatum){return nodeDatum.id===nodeId?'var(--acc)':'var(--bg0)';})
                .attr('stroke-width',function(nodeDatum){return nodeDatum.id===nodeId?2:1.5;});
        }
        node.on('mouseenter',function(e,d){
            var rect=bundleRef.current.getBoundingClientRect();
            tooltip.html(renderTooltipHtml(d.name,[
                {label:'Lines',value:d.lines||0},
                {label:'Functions',value:d.fns||0},
                {label:'Folder',value:d.folder||'root'}
            ]))
                .style('display','block').style('left',(e.clientX-rect.left+15)+'px').style('top',(e.clientY-rect.top+15)+'px');
            applyBundleHoverState(d.id);
        }).on('mousemove',function(e){var rect=bundleRef.current.getBoundingClientRect();tooltip.style('left',(e.clientX-rect.left+15)+'px').style('top',(e.clientY-rect.top+15)+'px');})
        .on('mouseleave',function(){
            tooltip.style('display','none');
            if(selected&&nodeMap[selected.path]){
                applyBundleSelectionState(selected.path,blastRadius);
            }else{
                applyBundleDefaultState();
            }
        }).on('click',function(e,d){
            e.stopPropagation();
            if(selectFileRef.current){
                selectFileRef.current(d.id);
            }
        });
        var arcGen=d3.arc().innerRadius(radius+20).outerRadius(radius+30);
        var folderAngleStart=0;
        sortedFolders.forEach(function(entry,i){
            var folder=entry[0],count=entry[1].length;
            var span=2*Math.PI*count/files.length;
            mainG.append('path').attr('d',arcGen({startAngle:folderAngleStart,endAngle:folderAngleStart+span}))
                .attr('fill',colorMap[folder]||COLORS[i%COLORS.length]).attr('opacity',0.5).style('cursor','pointer')
                .on('click',function(){filterByFolder(folder);});
            if(span>0.15){
                var midAngle=folderAngleStart+span/2-Math.PI/2;
                mainG.append('text').attr('x',Math.cos(midAngle)*(radius+40)).attr('y',Math.sin(midAngle)*(radius+40))
                    .attr('text-anchor','middle').attr('fill','var(--t2)').attr('font-size','8px')
                    .attr('transform','rotate('+(midAngle*180/Math.PI+90)+','+Math.cos(midAngle)*(radius+40)+','+Math.sin(midAngle)*(radius+40)+')')
                    .text(folder.split('/').pop()||'root');
            }
            folderAngleStart+=span;
        });
        svg.on('click',function(){
            setSelected(null);setBlastRadius(null);
            applyBundleDefaultState();
        });
        if(selected&&nodeMap[selected.path]){
            applyBundleSelectionState(selected.path,blastRadius);
        }else{
            applyBundleDefaultState();
        }
    },[data,graphConfig.vizType,colorMap,folderFilter,selected,blastRadius,lineThickness]);

    function zoomIn(){
        if(graphConfig.vizType==='graph3d'){
            graph3dViewRef.current?.zoom(0.7);
        }else{
            nativeCanvasRef.current?.zoomBy(1.4);
        }
    }
    function zoomOut(){
        if(graphConfig.vizType==='graph3d'){
            graph3dViewRef.current?.zoom(1.4);
        }else{
            nativeCanvasRef.current?.zoomBy(0.7);
        }
    }
    function resetZoom(){
        if(graphConfig.vizType==='graph3d'){
            graph3dViewRef.current?.fit();
        }else{
            nativeCanvasRef.current?.resetZoom();
        }
    }

    function fitView(){
        if(graphConfig.vizType==='graph3d'){
            graph3dViewRef.current?.fit();
        }else{
            nativeCanvasRef.current?.fit();
        }
    }
    function getEmbeddedSvgStyle(){
        var vars=['--bg0','--bg1','--bg2','--bg3','--bg4','--hover','--border','--border2','--t0','--t1','--t2','--t3','--acc','--acc2','--accbg','--blue','--purple','--orange','--red','--cyan','--pink','--green'];
        var computed=getComputedStyle(document.documentElement);
        var root=':root{';
        vars.forEach(function(name){var value=computed.getPropertyValue(name);if(value)root+=name+':'+value.trim()+';';});
        root+='}';
        return root+'text{font-family:JetBrains Mono,monospace;pointer-events:none}';
    }
    function exportSVG(){
        if(!graphSvgExportEnabled(graphConfig.vizType)){
            showNotification('Switch to Graph view to export SVG. Code cards are HTML overlays.','error');
            return;
        }
        if(!nativeCanvasRef.current?.svgElement)return;
        var svgClone=nativeCanvasRef.current?.svgElement.cloneNode(true);
        svgClone.setAttribute('xmlns','http://www.w3.org/2000/svg');
        svgClone.setAttribute('width',nativeCanvasRef.current?.svgElement.clientWidth);
        svgClone.setAttribute('height',nativeCanvasRef.current?.svgElement.clientHeight);
        var style=document.createElementNS('http://www.w3.org/2000/svg','style');
        style.textContent=getEmbeddedSvgStyle();
        svgClone.insertBefore(style,svgClone.firstChild);
        var blob=new Blob([new XMLSerializer().serializeToString(svgClone)],{type:'image/svg+xml'});
        var url=URL.createObjectURL(blob);
        var a=document.createElement('a');
        a.href=url;
        a.download='codeflow-'+Date.now()+'.svg';
        a.click();
        URL.revokeObjectURL(url);
    }
    function copyText(text,successMessage){
        if(!text){showNotification('Nothing to copy.','error');return;}
        if(navigator.clipboard&&navigator.clipboard.writeText){
            navigator.clipboard.writeText(text).then(function(){showNotification(successMessage||'Copied.','success');}).catch(function(){fallbackCopyText(text,successMessage);});
            return;
        }
        fallbackCopyText(text,successMessage);
    }
    function fallbackCopyText(text,successMessage){
        var textarea=document.createElement('textarea');
        textarea.value=text;
        textarea.setAttribute('readonly','');
        textarea.style.position='fixed';
        textarea.style.left='-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try{
            document.execCommand('copy');
            showNotification(successMessage||'Copied.','success');
        }catch(err){
            showNotification('Copy failed.','error');
        }
        document.body.removeChild(textarea);
    }
    function copyMermaid(){
        var diagram=data&&data.architectureDiagram;
        var text=diagram?generateMermaidBlockDiagram(diagram,architectureIncludeTests,architectureIncludeBuildOutput):'';
        copyText(text,'Mermaid diagram copied.');
    }
    function downloadMermaid(){
        var diagram=data&&data.architectureDiagram;
        var text=diagram?generateMermaidBlockDiagram(diagram,architectureIncludeTests,architectureIncludeBuildOutput):'';
        if(!text){showNotification('No Mermaid source to download.','error');return;}
        var blob=new Blob([text],{type:'text/plain'});
        var url=URL.createObjectURL(blob);
        var a=document.createElement('a');
        a.href=url;
        a.download='codeflow-architecture.mmd';
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Mermaid source downloaded.','success');
    }
    function downloadArchitectureSVG(){
        var svg=architectureViewRef.current?.getSvg();
        if(!svg){showNotification('No rendered architecture SVG to download.','error');return;}
        var clone=svg.cloneNode(true);
        clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
        var blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml'});
        var url=URL.createObjectURL(blob);
        var a=document.createElement('a');
        a.href=url;
        a.download='codeflow-architecture.svg';
        a.click();
        URL.revokeObjectURL(url);
        showNotification('Architecture SVG downloaded.','success');
    }
    function graphSvgToPngDataUrlForPdf(scale,done){
        scale=scale||2;
        if(!nativeCanvasRef.current?.svgElement){done('No graph to export');return;}
        var svgEl=nativeCanvasRef.current?.svgElement;
        var w=svgEl.clientWidth,h=svgEl.clientHeight;
        if(w<1||h<1){done('Graph has zero size');return;}
        var svgClone=svgEl.cloneNode(true);
        svgClone.setAttribute('xmlns','http://www.w3.org/2000/svg');
        svgClone.setAttribute('width',String(w));
        svgClone.setAttribute('height',String(h));
        var styleEl=document.createElementNS('http://www.w3.org/2000/svg','style');
        styleEl.textContent=getEmbeddedSvgStyle();
        svgClone.insertBefore(styleEl,svgClone.firstChild);
        var svgStr=new XMLSerializer().serializeToString(svgClone);
        var blob=new Blob([svgStr],{type:'image/svg+xml;charset=utf-8'});
        var url=URL.createObjectURL(blob);
        var img=new Image();
        img.onload=function(){
            try{
                var cw=Math.floor(w*scale),ch=Math.floor(h*scale);
                var canvas=document.createElement('canvas');
                canvas.width=cw;
                canvas.height=ch;
                var ctx=canvas.getContext('2d');
                ctx.fillStyle=document.documentElement.classList.contains('light')?'#ffffff':'#0a0a0c';
                ctx.fillRect(0,0,cw,ch);
                ctx.drawImage(img,0,0,cw,ch);
                URL.revokeObjectURL(url);
                var dataUrl=canvas.toDataURL('image/png');
                done(null,dataUrl,w,h);
            }catch(ex){
                URL.revokeObjectURL(url);
                done(ex.message||'Raster failed');
            }
        };
        img.onerror=function(){
            URL.revokeObjectURL(url);
            done('Could not rasterize graph for PDF');
        };
        img.src=url;
    }
    function exportPDF(){
        if(graphConfig.vizType!=='graph'||!nativeCanvasRef.current?.svgElement){showNotification('Switch to Graph view to export PDF.','error');return;}
        if(typeof window.jspdf==='undefined'||!window.jspdf.jsPDF){showNotification('PDF library failed to load. Check your connection.','error');return;}
        var svgNode=nativeCanvasRef.current?.svgElement;
        var restoreExportCamera=nativeCanvasRef.current.frameForExport(160);
        requestAnimationFrame(function(){
            graphSvgToPngDataUrlForPdf(2,function(err,dataUrl,w,h){
                restoreExportCamera();
                if(err){showNotification(err,'error');return;}
                try{
                    var JsPDF=window.jspdf.jsPDF;
                    var aspect=w/h;
                    var orientation=aspect>=1?'l':'p';
                    var doc=new JsPDF({unit:'pt',format:'a4',orientation:orientation});
                    var pageW=doc.internal.pageSize.getWidth();
                    var pageH=doc.internal.pageSize.getHeight();
                    var margin=36;
                    var maxW=pageW-2*margin;
                    var maxH=pageH-2*margin;
                    var imgW=w;
                    var imgH=h;
                    var fitScale=Math.min(maxW/imgW,maxH/imgH);
                    var drawW=imgW*fitScale;
                    var drawH=imgH*fitScale;
                    var x=margin+(maxW-drawW)/2;
                    var y=margin+(maxH-drawH)/2;
                    doc.addImage(dataUrl,'PNG',x,y,drawW,drawH);
                    doc.save('codeflow-'+Date.now()+'.pdf');
                }catch(ex){
                    showNotification(ex.message||'PDF export failed','error');
                }
            });
        });
    }
    function exportJSON(){
        if(!data)return;
        var url=URL.createObjectURL(new Blob([JSON.stringify(exportAnalysis(data),null,2)],{type:'application/json'}));
        var link=document.createElement('a');link.href=url;link.download='codeflow-analysis.json';link.click();
        URL.revokeObjectURL(url);
    }

    function getAnalysisSourceLabel(){
        if(localSourceKind==='folder')return(repoInfo&&repoInfo.name)||'Local Folder';
        if(localSourceKind==='zip')return repoInfo&&repoInfo.name?repoInfo.name:'ZIP Archive';
        return repoInfo?repoInfo.owner+'/'+repoInfo.repo:'Unknown Repository';
    }
    function generateReport(format){
        if(!data)return;
        var repo=getAnalysisSourceLabel();
        var h=calcHealth(data);
        var report={
            assessments:data.assessments||{},
            repository:repo,
            analyzedAt:new Date().toISOString(),
            codeflowVersion:'1.0',
            summary:{
                healthScore:h.score,
                healthGrade:h.grade,
                totalFiles:data.stats.files,
                totalFunctions:data.stats.functions,
                totalConnections:data.stats.connections,
                linesOfCode:data.stats.loc,
                unusedFunctions:data.stats.dead,
                securityIssues:data.securityIssues.length,
                patterns:data.patterns.length,
                duplicates:data.stats.duplicates||0,
                layerViolations:data.stats.violations||0,
                highSecurityIssues:data.stats.security||0
            },
            files:data.files.map(function(f){
                var fns=f.functions.map(function(fn){
                    var statKey=fn.key||Parser.functionKey(fn);
                    var st=data.fnStats[statKey]||data.fnStats[fn.name];
                    return{
                        key:statKey,
                        name:fn.name,
                        line:fn.line,
                        internalCalls:st?st.internal:0,
                        externalCalls:st?st.external:0,
                        totalCalls:st?(st.internal+st.external):0,
                        isUnused:st&&st.usageCertainty==='unverified'?null:st?(st.internal+st.external===0):null,
                        usageCertainty:st&&st.usageCertainty||'source analysis',
                        isExported:st?st.isExported:false,
                        isClassMethod:st?st.isClassMethod:false,
                        isTopLevel:st?st.isTopLevel:true,
                        type:st?st.type:'function',
                        callers:st&&st.callers?st.callers.map(function(c){return{file:c.file,name:c.name,count:c.count};}):[],
                        code:fn.code
                    };
                });
                return{
                    path:f.path,
                    name:f.name,
                    folder:f.folder,
                    layer:f.layer,
                    lines:f.lines,
                    churn:f.churn||0,
                    isCode:f.isCode!==false,
                    functions:fns,
                    functionCount:f.functions.length
                };
            }),
            unusedFunctions:data.deadFunctions.map(function(fn){return{name:fn.name,file:fn.file,folder:fn.folder,line:fn.line,codeLines:fn.codeLines,code:fn.code,extension:fn.ext,certainty:fn.certainty,evidence:fn.evidence};}),
            dependencies:data.connections.map(function(c){
                var src=typeof c.source==='object'?c.source.id:c.source;
                var tgt=typeof c.target==='object'?c.target.id:c.target;
                return{from:src,to:tgt,function:c.fn,callCount:c.count,kind:c.kind,evidence:c.evidence};
            }),
            architectureIssues:data.issues.map(function(i){return{type:i.type,title:i.title,description:i.desc,provider:i.provider,evidence:i.evidence,certainty:i.certainty,sourceLocation:i.sourceLocation,affectedFiles:i.items?i.items.map(function(x){return x.file||x.name;}):[],affectedItems:i.items||[]};}),
            patterns:data.patterns.map(function(p){return{name:p.name,description:p.desc,isAntiPattern:p.isAnti||false,severity:p.severity||'info',icon:p.icon||'',files:p.files.map(function(f){return f.path||f.name;}),fileDetails:p.files||[],metrics:p.metrics||{}};}),
            securityIssues:data.securityIssues.map(function(s){return{severity:s.severity,title:s.title,description:s.desc,file:s.file,path:s.path,line:s.line,code:s.code};}),
            duplicates:data.duplicates||[],
            layerViolations:data.layerViolations||[],
            suggestions:data.suggestions||[],
            languageBreakdown:data.stats.languages||[],
            folderStructure:data.folders,
            functionStatistics:Object.keys(data.fnStats||{}).map(function(fnKey){
                var st=data.fnStats[fnKey];
                return{
                    key:fnKey,
                    name:st.name||fnKey,
                    file:st.file,
                    folder:st.folder,
                    line:st.line,
                    internalCalls:st.internal,
                    externalCalls:st.external,
                    totalCalls:st.count||(st.internal+st.external),
                    isExported:st.isExported,
                    isClassMethod:st.isClassMethod,
                    isTopLevel:st.isTopLevel,
                    type:st.type,
                    callers:st.callers?st.callers.map(function(c){return{file:c.file,name:c.name,count:c.count};}):[],
                    code:st.code
                };
            })
        };
        if(format==='json'){
            var blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
            var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='codeflow-report.json';a.click();URL.revokeObjectURL(url);
        }else if(format==='md'){
            var md='# CodeFlow Analysis Report\n\n';
            md+='**Repository:** '+repo+'\n';
            md+='**Analyzed:** '+new Date().toLocaleString()+'\n\n';
            md+='## Summary\n\n';
            md+='| Metric | Value |\n|--------|-------|\n';
            md+='| Health Score | '+h.score+'/100 ('+h.grade+') |\n';
            md+='| Files | '+data.stats.files+' |\n';
            md+='| Functions | '+data.stats.functions+' |\n';
            md+='| Lines of Code | '+data.stats.loc.toLocaleString()+' |\n';
            md+='| Dependencies | '+data.stats.connections+' |\n';
            md+='| Functions without observed callers | '+data.stats.dead+' |\n';
            md+='| Security Issues | '+data.securityIssues.length+' |\n\n';
            if(data.securityIssues.length>0){
                md+='## Security Issues\n\n';
                data.securityIssues.forEach(function(s){
                    md+='### '+s.severity.toUpperCase()+': '+s.title+'\n';
                    md+='- **File:** `'+s.path+'`'+(s.line?' (line '+s.line+')':'')+'\n';
                    md+='- **Description:** '+s.desc+'\n';
                    if(s.code)md+='- **Code:** `'+s.code+'`\n';
                    md+='\n';
                });
            }
            if(data.deadFunctions.length>0){
                md+='## Functions Without Observed Callers ('+data.deadFunctions.length+')\n\n';
                md+='Source analysis found no callers; runtime usage is not established:\n\n';
                data.deadFunctions.slice(0,50).forEach(function(fn){
                    md+='### `'+fn.name+'()`\n';
                    md+='- **File:** `'+fn.file+'`\n';
                    md+='- **Line:** '+fn.line+'\n';
                    md+='- **Lines of code:** '+fn.codeLines+'\n';
                    if(fn.code)md+='```\n'+fn.code+'\n```\n';
                    md+='\n';
                });
                if(data.deadFunctions.length>50)md+='\n*...and '+(data.deadFunctions.length-50)+' more unused functions*\n\n';
            }
            if(data.patterns.length>0){
                md+='## Design Patterns\n\n';
                data.patterns.filter(function(p){return!p.isAnti;}).forEach(function(p){
                    md+='### '+p.name+'\n';
                    md+=p.desc+'\n\n';
                    md+='**Files:** '+p.files.slice(0,5).map(function(f){return'`'+f.name+'`';}).join(', ')+(p.files.length>5?' (+'+p.files.length-5+' more)':'')+'\n\n';
                });
                var antiPatterns=data.patterns.filter(function(p){return p.isAnti;});
                if(antiPatterns.length>0){
                    md+='## Anti-Patterns\n\n';
                    antiPatterns.forEach(function(p){
                        md+='### '+p.name+'\n';
                        md+=p.desc+'\n\n';
                        md+='**Affected files:** '+p.files.slice(0,5).map(function(f){return'`'+f.name+'`';}).join(', ')+'\n\n';
                    });
                }
            }
            if(data.issues.length>0){
                md+='## Architecture Issues\n\n';
                data.issues.forEach(function(i){
                    md+='### '+i.title+'\n';
                    md+=i.desc+'\n\n';
                    if(i.items)md+='**Affected:** '+i.items.slice(0,5).map(function(x){return'`'+(x.name||x.file)+'`';}).join(', ')+'\n\n';
                });
            }
            md+='## File Details\n\n';
            md+='| File | Folder | Layer | Lines | Functions |\n';
            md+='|------|--------|-------|-------|----------|\n';
            data.files.slice(0,100).forEach(function(f){
                md+='| `'+f.name+'` | '+f.folder+' | '+f.layer+' | '+f.lines+' | '+f.functions.length+' |\n';
            });
            if(data.files.length>100)md+='\n*...and '+(data.files.length-100)+' more files*\n';
            var blob=new Blob([md],{type:'text/markdown'});
            var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='codeflow-report.md';a.click();URL.revokeObjectURL(url);
        }else if(format==='txt'){
            var txt='CODEFLOW ANALYSIS REPORT\n';
            txt+='========================\n\n';
            txt+='Repository: '+repo+'\n';
            txt+='Analyzed: '+new Date().toLocaleString()+'\n\n';
            txt+='SUMMARY\n-------\n';
            txt+='Health Score: '+h.score+'/100 (Grade: '+h.grade+')\n';
            txt+='Files: '+data.stats.files+'\n';
            txt+='Functions: '+data.stats.functions+'\n';
            txt+='Lines of Code: '+data.stats.loc.toLocaleString()+'\n';
            txt+='Dependencies: '+data.stats.connections+'\n';
            txt+='Functions without observed callers: '+data.stats.dead+'\n';
            txt+='Security Issues: '+data.securityIssues.length+'\n\n';
            if(data.securityIssues.length>0){
                txt+='SECURITY ISSUES\n---------------\n';
                data.securityIssues.forEach(function(s,i){
                    txt+=(i+1)+'. ['+s.severity.toUpperCase()+'] '+s.title+'\n';
                    txt+='   File: '+s.path+(s.line?' (line '+s.line+')':'')+'\n';
                    txt+='   '+s.desc+'\n';
                    if(s.code)txt+='   Code: '+s.code+'\n';
                    txt+='\n';
                });
            }
            if(data.deadFunctions.length>0){
                txt+='FUNCTIONS WITHOUT OBSERVED CALLERS ('+data.deadFunctions.length+')\n'+'-'.repeat(20)+'\n';
                txt+='Source analysis found no callers; runtime usage is not established:\n\n';
                data.deadFunctions.forEach(function(fn,i){
                    txt+=(i+1)+'. '+fn.name+'()\n';
                    txt+='   File: '+fn.file+' (line '+fn.line+')\n';
                    txt+='   Lines: '+fn.codeLines+'\n';
                    if(fn.code){txt+='   Code:\n';fn.code.split('\n').forEach(function(line){txt+='      '+line+'\n';});}
                    txt+='\n';
                });
            }
            if(data.patterns.length>0){
                txt+='PATTERNS DETECTED\n-----------------\n';
                data.patterns.forEach(function(p){
                    txt+=(p.isAnti?'[ANTI-PATTERN] ':'')+p.name+'\n';
                    txt+='  '+p.desc+'\n';
                    txt+='  Files: '+p.files.map(function(f){return f.name;}).join(', ')+'\n\n';
                });
            }
            if(data.issues.length>0){
                txt+='ARCHITECTURE ISSUES\n-------------------\n';
                data.issues.forEach(function(i){
                    txt+='['+i.type.toUpperCase()+'] '+i.title+'\n';
                    txt+='  '+i.desc+'\n';
                    if(i.items)txt+='  Affected: '+i.items.map(function(x){return x.name||x.file;}).join(', ')+'\n';
                    txt+='\n';
                });
            }
            txt+='FILE LIST\n---------\n';
            data.files.forEach(function(f){
                txt+=f.path+' ('+f.lines+' lines, '+f.functions.length+' functions, '+f.layer+')\n';
            });
            txt+='\nDEPENDENCIES\n------------\n';
            data.connections.slice(0,100).forEach(function(c){
                var src=typeof c.source==='object'?c.source.id:c.source;
                var tgt=typeof c.target==='object'?c.target.id:c.target;
                txt+=src.split('/').pop()+' -> '+tgt.split('/').pop()+' ('+c.fn+': '+c.count+' calls)\n';
            });
            if(data.connections.length>100)txt+='\n...and '+(data.connections.length-100)+' more dependencies\n';
            var blob=new Blob([txt],{type:'text/plain'});
            var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='codeflow-report.txt';a.click();URL.revokeObjectURL(url);
        }
        showNotification('Report exported as '+format.toUpperCase(),'success');
    }
    function showNotification(msg,type){setToast({msg:msg,type:type||'success'});setTimeout(function(){setToast(null);},3000);}
    function copyLink(){
        if(localSourceKind){
            showNotification('Share links are not available for local sources','warning');
            return;
        }
        var shareUrl=buildAppUrl(repoInfo?repoInfo.owner+'/'+repoInfo.repo:repoUrl,true);
        navigator.clipboard.writeText(shareUrl).then(function(){showNotification('Link copied to clipboard!');}).catch(function(){showNotification('Failed to copy link','error');});
    }
    function analyzePR(){if(!prUrl||!repoInfo)return;var m=prUrl.match(/\/pull\/(\d+)/);if(!m){showNotification('Invalid PR URL','error');return;}GitHub.getPR(repoInfo.owner,repoInfo.repo,m[1]).then(function(pr){if(pr)setPrData(pr);else showNotification('Could not load PR','error');});}
    function resetAnalysis(){
        projectLoading.dispose();setLoading(false);setError(null);cliAnalyzingRef.current=false;setData(null);setSelected(null);setBlastRadius(null);setOwnership(null);setRepoInfo(null);setRepoUrl('');setPrData(null);setFolderFilter(null);setLocalDirHandle(null);setLocalSourceKind(null);setArchitectureIncludeTests(false);setArchitectureIncludeBuildOutput(false);setCachedFromId(null);setActiveSymbol(null);setCliDirty([]);clearCliLiveDiffs();localFolderKeyRef.current=null;localFolderSelectionRef.current=null;localFilesRef.current=null;zipKeyRef.current=null;zipArchiveRef.current=null;zipFileRef.current=null;window.history.replaceState({},'',window.location.pathname);}
    function filterByFolder(path){setFolderFilter(function(prev){return prev===path?null:path;});}
    function renderRecentsList(){
        return React.createElement('div',{className:'sidebar-scroll'},
            recentAnalyses.length?React.createElement('div',{className:'recent-list'},
                recentAnalyses.map(function(item){
                    var active=cachedFromId===item.id||(data&&currentAnalysisSource()&&analysisCacheKey(currentAnalysisSource().sourceType,currentAnalysisSource().sourceKey)===item.id);
                    return React.createElement('div',{key:item.id,className:'recent-item'+(active?' active':''),onClick:function(){loadRecentAnalysis(item.id);}},
                        React.createElement('div',{className:'recent-item-main'},
                            React.createElement('div',{className:'recent-item-title'},item.title),
                            React.createElement('div',{className:'recent-item-meta'},item.sourceType,' · ',item.fileCount,' files · ',formatRecentTime(item.savedAt))
                        ),
                        React.createElement('div',{className:'recent-item-actions'},
                            React.createElement('button',{className:'recent-mini-btn',title:'Re-analyze',onClick:function(e){e.stopPropagation();reanalyzeRecent(item.id);}},'Re-analyze'),
                            React.createElement('button',{className:'recent-mini-btn danger'+(pendingRecentDelete===item.id?' armed':''),title:pendingRecentDelete===item.id?'Click again to delete':'Delete cached analysis',onClick:function(e){requestRecentDelete(item.id,e);}},pendingRecentDelete===item.id?'Confirm?':'Delete')
                        )
                    );
                })
            ):React.createElement('div',{className:'recent-empty'},'Analyses you run are cached here so the same tree is not fetched twice.')
        );
    }
    function renderColorByControl(){
        if(graphConfig.vizType!=='graph'&&graphConfig.vizType!=='graph3d')return null;
        return React.createElement('div',{className:'color-by',role:'group','aria-label':'Color graph by'},
            React.createElement('span',{className:'color-by-label'},'Color'),
            React.createElement('button',{type:'button',className:'color-by-btn'+(colorMode==='folder'?' active':''),onClick:function(){setColorMode('folder');}},'Folder'),
            React.createElement('button',{type:'button',className:'color-by-btn'+(colorMode==='layer'?' active':''),onClick:function(){setColorMode('layer');}},'Layer'),
            React.createElement('button',{type:'button',className:'color-by-btn'+(colorMode==='churn'?' active':''),onClick:function(){setColorMode('churn');}},'Churn')
        );
    }
    function renderCodeViewPrefs(){
        if(graphConfig.vizType!=='code')return null;
        return React.createElement('div',{className:'color-by code-view-prefs',role:'toolbar','aria-label':'Code view options'},
            React.createElement('div',{className:'code-view-prefs-row'},
                React.createElement('button',{type:'button',className:'color-by-btn'+(codeViewExpand?' active':''),'aria-pressed':codeViewExpand?'true':'false',onClick:function(){setCodeViewExpand(!codeViewExpand);}},'Expand All'),
                React.createElement('button',{type:'button',className:'color-by-btn'+(codeViewWrap?' active':''),'aria-pressed':codeViewWrap?'true':'false',onClick:function(){setCodeViewWrap(!codeViewWrap);}},'Wrap Text')
            )
        );
    }
    function renderSidebarEmpty(title,desc){
        return React.createElement('div',{className:'empty-state'},
            React.createElement(Icon,{name:'search',size:'xxl',className:'empty-icon'}),
            React.createElement('div',{className:'empty-title'},title),
            React.createElement('div',{className:'empty-desc'},desc)
        );
    }

    function renderOverviewPane(){
        if(!data)return renderSidebarEmpty('No Repository','Enter a GitHub URL, open a folder, or load a ZIP archive');
        return React.createElement('div',{className:'sidebar-scroll'},
            React.createElement('div',{className:'health-score',style:{marginBottom:10}},
                React.createElement(HealthRing,{score:health.score,grade:health.grade}),
                React.createElement('div',{className:'health-info'},
                    React.createElement('div',{className:'health-grade',style:{color:health.score>=80?'var(--green)':health.score>=60?'var(--orange)':'var(--red)'}},health.score,'/100'),
                    React.createElement('div',{className:'health-label'},'Health Score')
                )
            ),
            (cachedFromId||cliDirty.length>0)&&React.createElement('div',{className:'stale-banner'},
                React.createElement('span',null,cliDirty.length?(data.beam?'Sources changed. Relationships refresh after compilation.':'Watched files changed. Re-analyze to refresh.'):'Cached analysis. Re-analyze to refresh.'),
                React.createElement('button',{className:'top-btn primary',onClick:refreshAnalysis,disabled:loading},'Re-analyze')
            ),
            React.createElement('div',{className:'stats-grid'},
                React.createElement('div',{className:'stat-card'},React.createElement('div',{className:'stat-value'},data.stats.files),React.createElement('div',{className:'stat-label'},'Files')),
                React.createElement('div',{className:'stat-card'},React.createElement('div',{className:'stat-value'},data.stats.functions),React.createElement('div',{className:'stat-label'},'Functions')),
                React.createElement('div',{className:'stat-card'},React.createElement('div',{className:'stat-value'},data.stats.connections),React.createElement('div',{className:'stat-label'},'Links')),
                React.createElement('div',{className:'stat-card'+(data.stats.dead>10?' warn':''),style:{cursor:data.stats.dead>0?'pointer':'default'},onClick:function(){if(data.stats.dead>0)setShowUnused(true);}},React.createElement('div',{className:'stat-value'},data.stats.dead),React.createElement('div',{className:'stat-label'},data.deadFunctions.some(function(f){return f.certainty==='unverified';})?'No callers found':'Unused'))
            ),
            React.createElement('div',{className:'loc-stat'},
                React.createElement('div',{className:'loc-value'},data.stats.loc?data.stats.loc.toLocaleString():'0'),
                React.createElement('div',{className:'loc-label'},'Lines of Code')
            ),
            data.stats.languages&&data.stats.languages.length>0&&React.createElement(React.Fragment,null,
                React.createElement('div',{className:'lang-bar'},
                    data.stats.languages.slice(0,6).map(function(l,i){return React.createElement('div',{key:l.ext,className:'lang-bar-segment',style:{width:l.pct+'%',background:COLORS[i%COLORS.length]}});})
                ),
                React.createElement('div',{className:'lang-legend'},
                    data.stats.languages.slice(0,6).map(function(l,i){return React.createElement('div',{key:l.ext,className:'lang-item'},
                        React.createElement('div',{className:'lang-dot',style:{background:COLORS[i%COLORS.length]}}),
                        React.createElement('span',null,l.ext,' ',l.pct,'%')
                    );})
                )
            )
        );
    }
    function renderFilesPane(){
        if(!data)return renderSidebarEmpty('No Files','Analyze a repository to browse its folder tree');
        var results=projectSearchResults;
        function openResult(result){
            if(result.kind==='file')goToFile(result.path);
            else openSourceLocation({path:result.path,range:{start:{line:result.line-1,character:0}}});
        }
        return React.createElement(React.Fragment,null,
            React.createElement('div',{style:{display:'flex',gap:4,padding:8}},
                React.createElement('button',{className:'top-btn','aria-label':'Back',title:'Back',disabled:navigation.index<1,onClick:function(){navigateHistory(-1);}},'←'),
                React.createElement('button',{className:'top-btn','aria-label':'Forward',title:'Forward',disabled:navigation.index>=navigation.entries.length-1,onClick:function(){navigateHistory(1);}},'→'),
                React.createElement('input',{ref:fileSearchRef,type:'search',className:'form-input','aria-label':'Find files and symbols',placeholder:'Find files and symbols',value:fileQuery,style:{minWidth:0},onChange:function(e){setFileQuery(e.target.value);setSearchLimit(40);},onKeyDown:function(e){if(e.key==='Enter'&&results[0])openResult(results[0]);if(e.key==='Escape')setFileQuery('');}})),
            folderFilter&&React.createElement('div',{className:'sidebar-filter'},
                React.createElement('button',{className:'top-btn',style:{width:'100%'},onClick:function(){setFolderFilter(null);}},
                    React.createElement(Icon,{name:'close',size:'s'}),' Clear Filter: ',folderFilter)),
            React.createElement('div',{className:'sidebar-scroll'},fileQuery.trim()?React.createElement(React.Fragment,null,
                results.slice(0,searchLimit).map(function(result,i){return React.createElement('button',{key:result.kind+result.path+result.line+i,className:'tree-file'+(selected&&selected.path===result.path?' active':''),style:{width:'100%',textAlign:'left',border:0,background:selected&&selected.path===result.path?'var(--accbg)':'transparent',color:'inherit',display:'block'},onClick:function(){openResult(result);}},
                    React.createElement('div',{style:{overflowWrap:'anywhere'}},result.label),
                    React.createElement('div',{style:{fontSize:9,color:'var(--t3)',overflowWrap:'anywhere'}},result.path,result.kind==='file'?'':':'+result.line));}),
                results.length===0&&React.createElement('div',{style:{padding:12,color:'var(--t3)'}},'No matches'),
                results.length>searchLimit&&React.createElement('button',{className:'top-btn',onClick:function(){setSearchLimit(function(n){return n+40;});}},'Show more')
            ):React.createElement(TreeNode,{node:data.tree,selected:selected,onSelect:goToFile,expanded:expandedPaths,toggle:togglePath,filterFolder:filterByFolder,activeFilter:folderFilter}))
        );
    }

    function getArchitectureViewStats(diagram,includeTests,includeBuildOutput){
        if(!diagram)return{blocks:0,dependencies:0,routes:0,apiRoutes:0,databaseTouchpoints:0,warnings:0};
        var blocks=getVisibleArchitectureBlocks(diagram.blocks||[],!!includeTests,!!includeBuildOutput);
        var visibleIds=new Set(blocks.map(function(block){return block.id;}));
        var dependencies=(diagram.dependencies||[]).filter(function(dep){return visibleIds.has(dep.from)&&visibleIds.has(dep.to);});
        var stats=computeArchitectureStats(blocks,dependencies);
        stats.warnings=diagram.stats&&diagram.stats.warnings!=null?diagram.stats.warnings:(diagram.warnings?diagram.warnings.length:0);
        return stats;
    }
    function architectureGroupDotColor(group){
        if(group==='Browser App'||group==='App Entry / Shell'||group==='Analysis Core'||group==='Frontend Routes'||group==='Frontend Page Components')return'var(--blue)';
        if(group==='GitHub Action'||group==='Repository Collection'||group==='Backend API / Platform Logic')return'var(--purple)';
        if(group==='Rendering / Reports'||group==='Storage'||group==='Configuration')return'var(--orange)';
        if(group==='Content / Data')return'var(--green)';
        if(group==='Testing'||group==='Fixtures / Examples'||group==='Build Output')return'var(--t3)';
        return'var(--t2)';
    }
    useLayoutEffect(function(){
        var panel=document.querySelector('.panel-content');if(panel)panel.scrollTop=0;
    },[selected&&selected.path,rightTab,selectedArchitectureBlock]);
    function selectArchitectureBlock(id){
        setSelectedArchitectureBlock(id);setSelected(null);setBlastRadius(null);setRightTab('details');
    }
    function renderArchitectureBlockList(blocks,emptyText){
        if(!blocks||!blocks.length)return React.createElement('div',{style:{fontSize:10,color:'var(--t3)',padding:8}},emptyText);
        return React.createElement('div',{className:'architecture-list'},blocks.map(function(block){
            return React.createElement('button',{type:'button',key:block.id,className:'top-btn',onClick:function(){selectArchitectureBlock(block.id);}},
                React.createElement(StatusDot,{color:architectureGroupDotColor(block.group)}),block.title);
        }));
    }
    function renderArchitectureBlockDetails(diagram,block){
        var dependencies=groupArchitectureRelationships((diagram.dependencies||[]).filter(function(d){return d.from===block.id||d.to===block.id;}));
        return React.createElement(React.Fragment,null,
            React.createElement('button',{type:'button',className:'top-btn',onClick:function(){setSelectedArchitectureBlock(null);}},'← Architecture'),
            React.createElement('div',{className:'card','data-architecture-block':block.id},
                React.createElement('div',{className:'card-header'},React.createElement('div',{className:'card-title'},block.title)),
                React.createElement('div',{className:'card-body'},
                    React.createElement('div',{style:{fontSize:10,color:'var(--t2)',marginBottom:8}},block.group),
                    React.createElement('div',{style:{maxHeight:'35vh',overflowY:'auto'}},(block.files||[]).map(function(path){
                        var declaration=(block.declarations||[]).find(function(d){return d.path===path&&d.kind==='module';});
                        return React.createElement('button',{type:'button',key:path,className:'top-btn',style:{width:'100%',whiteSpace:'normal',textAlign:'left',marginBottom:4},onClick:function(){openSourceLocation({path:path,range:{start:{line:declaration?declaration.line-1:0,character:0}}});}},path);
                    }))
                )
            ),
            dependencies.length>0&&React.createElement('div',{className:'card'},
                React.createElement('div',{className:'card-header'},React.createElement('div',{className:'card-title'},'Connections')),
                React.createElement('div',{className:'card-body'},dependencies.map(function(dep,i){
                    var other=findBlockById(diagram.blocks,dep.from===block.id?dep.to:dep.from);if(!other)return null;
                    return React.createElement('button',{type:'button',key:i,className:'top-btn',title:dep.kinds.concat(dep.evidence).join(' · '),style:{width:'100%',whiteSpace:'normal',textAlign:'left',marginBottom:4},onClick:function(){selectArchitectureBlock(other.id);}},dep.from===block.id?'→ ':'← ',other.title,' · ',dep.labels.join(', '));
                }))
            )
        );
    }
    function renderArchitectureSummary(){
        var diagram=data&&data.architectureDiagram;
        if(!diagram)return React.createElement('div',{className:'empty-state'},React.createElement('div',{className:'empty-title'},'No architecture diagram'));
        var activeBlock=findBlockById(diagram.blocks,selectedArchitectureBlock);
        if(activeBlock)return renderArchitectureBlockDetails(diagram,activeBlock);
        var stats=getArchitectureViewStats(diagram,architectureIncludeTests,architectureIncludeBuildOutput);
        var blocks=getVisibleArchitectureBlocks(diagram.blocks||[],architectureIncludeTests,architectureIncludeBuildOutput);
        var hidden=diagram.hiddenSummary||{build:0,tests:0,fixtures:0,lowSignal:0,total:0};
        var groupOrder=groupBlocksByArchitectureGroup(blocks,diagram.profile||'generic').order;
        var groupCards=groupOrder.map(function(group){
            var groupBlocks=blocks.filter(function(block){return block.group===group;});
            if(!groupBlocks.length)return null;
            return React.createElement('div',{key:group,className:'card'},
                React.createElement('div',{className:'card-header'},
                    React.createElement('div',{className:'card-title'},group),
                    React.createElement('span',{className:'badge badge-default'},groupBlocks.length)
                ),
                React.createElement('div',{className:'card-body'},renderArchitectureBlockList(groupBlocks,'No blocks in this group.'))
            );
        }).filter(Boolean);
        return React.createElement(React.Fragment,null,
            React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},React.createElement(Icon,{name:'layers',size:'m'}),' Architecture Summary'),
            React.createElement('div',{className:'stats-grid',style:{marginBottom:12}},
                React.createElement('div',{className:'stat-card'},React.createElement('div',{className:'stat-value'},stats.blocks||0),React.createElement('div',{className:'stat-label'},'Blocks')),
                React.createElement('div',{className:'stat-card'},React.createElement('div',{className:'stat-value'},stats.dependencies||0),React.createElement('div',{className:'stat-label'},'Deps')),
                React.createElement('div',{className:'stat-card'},React.createElement('div',{className:'stat-value'},stats.routes||0),React.createElement('div',{className:'stat-label'},'Routes')),
                React.createElement('div',{className:'stat-card warn'},React.createElement('div',{className:'stat-value'},stats.databaseTouchpoints||0),React.createElement('div',{className:'stat-label'},'DB Touches'))
            ),
            React.createElement('div',{className:'card'},
                React.createElement('div',{className:'card-header'},React.createElement('div',{className:'card-title'},React.createElement(Icon,{name:'globe',size:'s'}),' Framework'),React.createElement('span',{className:'badge badge-info'},diagram.framework)),
                React.createElement('div',{className:'card-body'},
                    React.createElement('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},
                        React.createElement('button',{className:'top-btn'+(architectureIncludeTests?' primary':''),style:{fontSize:10,padding:'4px 10px'},onClick:function(){setArchitectureIncludeTests(function(v){return !v;});},type:'button'},'Tests'),
                        React.createElement('button',{className:'top-btn'+(architectureIncludeBuildOutput?' primary':''),style:{fontSize:10,padding:'4px 10px'},onClick:function(){setArchitectureIncludeBuildOutput(function(v){return !v;});},type:'button'},'Build output')
                    ),
                    React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginTop:8}},'Pan: drag diagram · Zoom: scroll wheel · Export: navbar Export button')
                )
            ),
            hidden.total>0&&React.createElement('div',{className:'card'},
                React.createElement('div',{className:'card-header'},React.createElement('div',{className:'card-title'},React.createElement(Icon,{name:'info',size:'s'}),' Hidden from diagram'),React.createElement('span',{className:'badge badge-default'},hidden.total)),
                React.createElement('div',{className:'card-body'},
                    hidden.build>0&&React.createElement('div',{style:{fontSize:10,color:'var(--t2)',marginBottom:4}},hidden.build,' build file',hidden.build===1?'':'s'),
                    hidden.tests>0&&React.createElement('div',{style:{fontSize:10,color:'var(--t2)',marginBottom:4}},hidden.tests,' test file',hidden.tests===1?'':'s'),
                    hidden.fixtures>0&&React.createElement('div',{style:{fontSize:10,color:'var(--t2)',marginBottom:4}},hidden.fixtures,' fixture file',hidden.fixtures===1?'':'s'),
                    hidden.lowSignal>0&&React.createElement('div',{style:{fontSize:10,color:'var(--t2)',marginBottom:4}},hidden.lowSignal,' low-signal utility file',hidden.lowSignal===1?'':'s')
                )
            ),
            groupCards,
            diagram.warnings&&diagram.warnings.length>0&&React.createElement('div',{className:'card'},
                React.createElement('div',{className:'card-header'},React.createElement('div',{className:'card-title'},React.createElement(Icon,{name:'warning',size:'s'}),' Warnings'),React.createElement('span',{className:'badge badge-warning'},diagram.warnings.length)),
                React.createElement('div',{className:'card-body'},diagram.warnings.map(function(warning,i){return React.createElement('div',{key:i,style:{fontSize:10,color:'var(--t2)',marginBottom:6,lineHeight:1.5}},warning);}))
            )
        );
    }
    var health=useMemo(function(){return calcHealth(data);},[data]);
    return React.createElement('div',{className:'app',style:{'--topbar-height':topbarHeight+'px'}},
        React.createElement('input',{ref:zipInputRef,type:'file',accept:'.zip,application/zip,application/x-zip-compressed',style:{display:'none'},onChange:handleZipSelected}),
        React.createElement('input',{ref:folderInputRef,type:'file',webkitdirectory:'',directory:'',mozdirectory:'',multiple:true,style:{display:'none'},onChange:handleFolderSelected}),
        React.createElement('div',{className:'topbar',ref:topbarRef},
            isMobile&&React.createElement(React.Fragment,null,
                React.createElement('div',{className:'mobile-brand-row'},
                    React.createElement('div',{className:'logo',onClick:function(){setShowPrivacy(true);}},
                        React.createElement('div',{className:'logo-mark'},React.createElement(Icon,{name:'logo',size:'l'})),
                        React.createElement('span',{className:'logo-text'},'CODEFLOW')
                    ),
                    React.createElement('div',{className:'mobile-action-stack'},
                        data&&!localSourceKind&&React.createElement('button',{className:'top-btn mobile-icon-btn','aria-label':'Analyze Pull Request',title:'Pull Request',onClick:function(){setShowPR(true);},type:'button'},React.createElement(Icon,{name:'pull-request',size:'m'})),
                        data&&React.createElement('button',{className:'top-btn mobile-icon-btn','aria-label':'Export analysis',title:'Export',onClick:function(){setShowExport(true);},type:'button'},React.createElement(Icon,{name:'export',size:'m'})),
                        data&&!localSourceKind&&React.createElement('button',{className:'top-btn mobile-icon-btn','aria-label':'Copy share link',title:'Share',onClick:copyLink,type:'button'},React.createElement(Icon,{name:'share',size:'m'})),
                        React.createElement('button',{className:'top-btn mobile-icon-btn','aria-label':'Toggle theme',title:'Theme',onClick:function(){setTheme(function(t){return t==='dark'?'light':'dark';});},type:'button'},React.createElement(Icon,{name:theme==='dark'?'sun':'moon',size:'m'}))
                    )
                ),
                React.createElement('div',{className:'mobile-source-controls'},
                    React.createElement('div',{className:'mobile-primary-row'},
                        React.createElement('input',{className:'repo-input','aria-label':'Repository URL',placeholder:'owner/repo or GitHub URL',value:repoUrl,onChange:function(e){setRepoUrl(e.target.value);},onKeyDown:function(e){if(e.key==='Enter'&&!loading)analyze();}}),
                        React.createElement('button',{id:'mobile-analyze-btn',className:'top-btn primary mobile-analyze-btn','aria-label':'Analyze repository',title:'Analyze',onClick:analyze,disabled:loading||!repoUrl,type:'button'},
                            React.createElement(Icon,{name:loading?'activity':'search',size:'m'})
                        )
                    ),
                    React.createElement('div',{className:'mobile-secondary-row'},
                        React.createElement('select',{className:'auth-select','aria-label':'Authentication Method',value:authMethod,onChange:function(e){setAuthMethod(e.target.value);}},
                            React.createElement('option',{value:'none'},'No Auth'),
                            React.createElement('option',{value:'pat'},'Token'),
                            React.createElement('option',{value:'github_app'},'App')
                        ),
                        React.createElement('div',{className:'auth-inputs'},
                            authMethod==='pat'&&React.createElement('input',{className:'repo-input',type:'password','aria-label':'GitHub Token',placeholder:'Personal Access Token',value:token,onChange:function(e){setToken(e.target.value);},onKeyDown:function(e){if(e.key==='Enter'&&!loading)analyze();}}),
                            authMethod==='github_app'&&React.createElement(React.Fragment,null,
                                React.createElement('input',{className:'repo-input','aria-label':'App ID',placeholder:'App ID',value:appId,onChange:function(e){setAppId(e.target.value);},onKeyDown:function(e){if(e.key==='Enter'&&!loading)analyze();}}),
                                React.createElement('button',{className:'private-key-btn'+(privateKey?' has-key':''),'aria-label':'Set Private Key',onClick:function(){setShowKeyModal(true);},type:'button'},
                                    React.createElement(Icon,{name:privateKey?'key':'shield',size:'m'}),
                                    privateKey?'Key':'Private Key'
                                )
                            )
                        ),
                        React.createElement('button',{className:'top-btn','aria-label':'Edit exclude patterns',onClick:function(){openExcludeModal();},disabled:loading,type:'button',style:customExcludeCount?{borderColor:'var(--acc)',color:'var(--acc)'}:null},
                            React.createElement(Icon,{name:'ban',size:'m'}),
                            'Excludes',
                            customExcludeCount>0?' ('+customExcludeCount+')':''
                        ),
                        React.createElement('button',{className:'top-btn','aria-label':'Open local folder',onClick:function(){openLocalFolder();},disabled:loading,type:'button'},
                            React.createElement(Icon,{name:'folder',size:'m'}),
                            'Folder'
                        ),
                        React.createElement('button',{className:'top-btn','aria-label':'Open ZIP archive',onClick:function(){openLocalZip();},disabled:loading,type:'button'},
                            React.createElement(Icon,{name:'archive',size:'m'}),
                            'ZIP'
                        ),
                        parseUrl(repoUrl)&&React.createElement('button',{className:'top-btn','aria-label':'Download GitHub ZIP',onClick:downloadCurrentGithubZip,disabled:loading,type:'button'},
                            React.createElement(Icon,{name:'export',size:'m'}),
                            'ZIP URL'
                        ),
                        data&&React.createElement('button',{className:'refresh-btn','aria-label':'Re-analyze',onClick:refreshAnalysis,disabled:loading,title:'Re-analyze',type:'button'},
                            React.createElement(Icon,{name:'refresh',size:'m'}),
                            cachedFromId||cliDirty.length?'Re-analyze':'Refresh'
                        ),
                        data&&React.createElement('button',{className:'reset-btn','aria-label':'Reset analysis',onClick:resetAnalysis,title:'Clear & Reset',type:'button'},
                            React.createElement(Icon,{name:'close',size:'m'}),
                            'Reset'
                        )
                    )
                )
            ),
            React.createElement('div',{className:'logo',onClick:function(){setShowPrivacy(true);}},
                React.createElement('div',{className:'logo-mark'},React.createElement(Icon,{name:'logo',size:'l'})),
                React.createElement('span',{className:'logo-text'},'CODEFLOW')
            ),
            React.createElement('div',{className:'repo-input-group'},
                React.createElement('input',{className:'repo-input','aria-label':'Repository URL',placeholder:'owner/repo or GitHub URL',value:repoUrl,onChange:function(e){setRepoUrl(e.target.value);},onKeyDown:function(e){if(e.key==='Enter'&&!loading)analyze();}}),
                React.createElement('select',{className:'auth-select','aria-label':'Authentication Method',value:authMethod,onChange:function(e){setAuthMethod(e.target.value);}},
                    React.createElement('option',{value:'none'},'No Auth'),
                    React.createElement('option',{value:'pat'},'Token (PAT)'),
                    React.createElement('option',{value:'github_app'},'GitHub App')
                ),
                React.createElement('div',{className:'auth-inputs'},
                    authMethod==='pat'&&React.createElement('input',{className:'repo-input',type:'password','aria-label':'GitHub Token',placeholder:'Personal Access Token',value:token,onChange:function(e){setToken(e.target.value);},onKeyDown:function(e){if(e.key==='Enter'&&!loading)analyze();},style:{minWidth:140}}),
                    authMethod==='github_app'&&React.createElement(React.Fragment,null,
                        React.createElement('input',{className:'repo-input','aria-label':'App ID',placeholder:'App ID',value:appId,onChange:function(e){setAppId(e.target.value);},onKeyDown:function(e){if(e.key==='Enter'&&!loading)analyze();},style:{width:80}}),
                        React.createElement('button',{className:'private-key-btn'+(privateKey?' has-key':''),'aria-label':'Set Private Key',onClick:function(){setShowKeyModal(true);},type:'button'},
                            React.createElement(Icon,{name:privateKey?'key':'shield',size:'m'}),
                            privateKey?'Key Set':'Private Key'
                        )
                    )
                ),
                React.createElement('button',{className:'top-btn','aria-label':'Edit exclude patterns',title:'Edit exclude patterns'+(customExcludeCount>0?' ('+customExcludeCount+')':''),onClick:function(){openExcludeModal();},disabled:loading,style:customExcludeCount?{borderColor:'var(--acc)',color:'var(--acc)'}:null},
                    React.createElement(Icon,{name:'ban',size:'m'}),
                    !data&&'Excludes',
                    (!data&&customExcludeCount>0)?' ('+customExcludeCount+')':''
                ),
                React.createElement('button',{id:'analyze-btn',className:'top-btn primary','aria-label':'Analyze repository',title:'Analyze repository',onClick:analyze,disabled:loading||!repoUrl},
                    React.createElement(Icon,{name:loading?'activity':'search',size:'m'}),
                    !data&&'Analyze'
                ),
                React.createElement('button',{className:'top-btn','aria-label':'Open local folder',title:'Open local folder',onClick:function(){openLocalFolder();},disabled:loading},
                    React.createElement(Icon,{name:'folder',size:'m'}),
                    !data&&'Open Folder'
                ),
                React.createElement('button',{className:'top-btn','aria-label':'Open ZIP archive',title:'Open ZIP archive',onClick:function(){openLocalZip();},disabled:loading},
                    React.createElement(Icon,{name:'archive',size:'m'}),
                    !data&&'Open ZIP'
                ),
                parseUrl(repoUrl)&&React.createElement('button',{className:'top-btn','aria-label':'Download GitHub ZIP',title:'Download a ZIP of this repo, then open it here',onClick:downloadCurrentGithubZip,disabled:loading},
                    React.createElement(Icon,{name:'export',size:'m'}),
                    !data&&'Download ZIP'
                ),
                data&&React.createElement('button',{className:'refresh-btn','aria-label':'Re-analyze',onClick:refreshAnalysis,disabled:loading,title:cachedFromId||cliDirty.length?'Re-analyze (cached or stale)':'Refresh Analysis'},
                    React.createElement(Icon,{name:'refresh',size:'m'})
                ),
                data&&React.createElement('button',{className:'reset-btn','aria-label':'Reset analysis',onClick:resetAnalysis,title:'Clear & Reset'},
                    React.createElement(Icon,{name:'close',size:'m'})
                )
            ),
            isMobile&&React.createElement('div',{className:'mobile-panel-actions'},
                React.createElement('button',{className:'top-btn'+(mobilePanel==='explorer'?' active':''),'aria-label':'Toggle explorer panel',onClick:function(){toggleMobilePanel('explorer');},type:'button'},
                    React.createElement(Icon,{name:'folder',size:'m'}),
                    'Explorer'
                ),
                React.createElement('button',{className:'top-btn'+(mobilePanel==='details'?' active':''),'aria-label':'Toggle details panel',onClick:function(){toggleMobilePanel('details');},disabled:!data,type:'button'},
                    React.createElement(Icon,{name:selected?'file':'layout',size:'m'}),
                    selected?'Inspector':'Insights'
                )
            ),
            React.createElement('div',{className:'topbar-actions'},
                React.createElement('button',{className:'top-btn','aria-label':'Analyze Pull Request',title:'Analyze Pull Request',onClick:function(){setShowPR(true);},disabled:!data||!!localSourceKind},React.createElement(Icon,{name:'pull-request',size:'m'}),!data&&'PR'),
                React.createElement('button',{className:'top-btn','aria-label':'Export analysis',title:'Export analysis',onClick:function(){setShowExport(true);},disabled:!data},React.createElement(Icon,{name:'export',size:'m'}),!data&&'Export'),
                React.createElement('button',{className:'top-btn','aria-label':'Copy share link',title:'Copy share link',onClick:copyLink,disabled:!data||!!localSourceKind},React.createElement(Icon,{name:'share',size:'m'}),!data&&'Share'),
                React.createElement('button',{className:'top-btn','aria-label':'Toggle theme',title:theme==='dark'?'Switch to light mode':'Switch to dark mode',onClick:function(){setTheme(function(t){return t==='dark'?'light':'dark';});}},React.createElement(Icon,{name:theme==='dark'?'sun':'moon',size:'m'}),!data&&(theme==='dark'?'Light':'Dark'))
            )
        ),
        React.createElement('div',{className:'main'},
            isMobile&&React.createElement('button',{type:'button',className:'mobile-panel-backdrop'+(mobilePanel?' visible':''),'aria-label':'Close mobile panel',onClick:function(){setMobilePanel(null);}}),
            React.createElement('div',{className:'sidebar'+(isMobile&&mobilePanel==='explorer'?' mobile-visible':''),style:{width:isMobile?'100vw':sidebarWidth}},
                isMobile&&React.createElement('div',{className:'mobile-panel-header'},
                    React.createElement('div',{className:'mobile-panel-meta'},
                        React.createElement('div',{className:'mobile-panel-title'},leftTab==='overview'?'Overview':leftTab==='files'?'Files':'Recents'),
                        React.createElement('div',{className:'mobile-panel-subtitle'},leftTab==='recents'?(recentAnalyses.length?recentAnalyses.length+' cached analyses':'No cached analyses'):data?(folderFilter?'Filtered by '+folderFilter:data.files.length+' files ready to browse'):'Analyze a repo or open a folder')
                    ),
                    React.createElement('button',{className:'mobile-panel-close',type:'button','aria-label':'Close explorer panel',onClick:function(){setMobilePanel(null);}},
                        React.createElement(Icon,{name:'close',size:'m'})
                    )
                ),
                React.createElement('div',{className:'resize-handle',onMouseDown:function(e){
                    e.preventDefault();
                    var startX=e.clientX,startW=sidebarWidth;
                    function onMove(e){setSidebarWidth(Math.max(180,Math.min(400,startW+e.clientX-startX)));}
                    function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
                    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
                }}),
                React.createElement('div',{className:'sidebar-tabs',role:'tablist','aria-label':'Left rail'},
                    React.createElement('button',{type:'button',role:'tab','aria-selected':leftTab==='overview',className:'sidebar-tab'+(leftTab==='overview'?' active':''),onClick:function(){setLeftTab('overview');}},'Overview'),
                    React.createElement('button',{type:'button',role:'tab','aria-selected':leftTab==='files',className:'sidebar-tab'+(leftTab==='files'?' active':''),onClick:function(){setLeftTab('files');}},'Files'),
                    React.createElement('button',{type:'button',role:'tab','aria-selected':leftTab==='recents',className:'sidebar-tab'+(leftTab==='recents'?' active':''),onClick:function(){setLeftTab('recents');}},'Recents')
                ),
                React.createElement('div',{className:'sidebar-pane'},
                    leftTab==='overview'&&renderOverviewPane(),
                    leftTab==='files'&&renderFilesPane(),
                    leftTab==='recents'&&renderRecentsList()
                )
            ),
            React.createElement('div',{className:'canvas-area'},
                    React.createElement(NativeCanvas,{key:loadedSourceIdentity?.sourceType+':'+loadedSourceIdentity?.sourceKey,ref:nativeCanvasRef,
                        data,active:!!data&&!loading,projectIdentity:loadedSourceIdentity,currentHydrationId,investigation,graphConfig,colorMap,colorMode,theme,lineThickness,
                        codeViewExpand,codeViewWrap,cliLiveByPath,sourceFocus,codeSourceFailed,canReadSource:canReadLiveFileSource(),activeSymbol,
                        viewport:{width:viewportWidth,sidebarWidth,rightPanelWidth},onSelect:selectFile,onOpen:openCodeFile,onClose:closeCodeCard,
                        onRetrySource:retryCodeSource,onSourceClick:beamSourceClick,onActiveSymbol:setActiveSymbol,onTooltip:setTooltip,getNodeColor,
                        restoredScene:restoredNativeScene,onSceneRestored:()=>{workspaceRestoreRef.current=null;}}),

                loading?React.createElement('div',{className:'loading'},React.createElement('div',{className:'spinner'}),React.createElement('div',{className:'loading-text'},'Analyzing...'),React.createElement('div',{className:'loading-progress'},progress)):
                !data?React.createElement('div',{className:'empty-state'},
                    React.createElement(Icon,{name:'logo',size:'xxl',className:'empty-icon'}),
                    React.createElement('div',{className:'empty-title'},'CodeFlow'),
                    React.createElement('div',{className:'empty-desc'},'Visualize architecture, blast radius, ownership, patterns & security\n\nEnter a GitHub URL, open a folder, or load a ZIP archive'),
                    parseUrl(repoUrl)&&React.createElement('div',{className:'github-hint'},
                        'The folder picker is faster when the API is rate-limited. ',
                        React.createElement('button',{type:'button',onClick:downloadCurrentGithubZip},'Download ZIP'),
                        ' and use Open ZIP to read it in-page.'
                    ),
                    cliStatus&&cliStatus.ok&&React.createElement('div',{className:'cli-chip',style:{marginTop:10}},'CLI watching ',cliStatus.name||cliStatus.root)
                ):
                React.createElement(React.Fragment,null,
                    React.createElement('div',{className:'viz-selector'},
                        React.createElement('select',{className:'viz-select','aria-label':'Visualization type',value:graphConfig.vizType,onChange:function(e){changeVisualization(e.target.value);}},
                            React.createElement('option',{value:'graph'},'Graph'),
                            React.createElement('option',{value:'code'},'Code'),
                            React.createElement('option',{value:'graph3d'},'3D Graph'),
                            React.createElement('option',{value:'treemap'},'Treemap'),
                            React.createElement('option',{value:'matrix'},'Matrix'),
                            React.createElement('option',{value:'dendro'},'Tree'),
                            React.createElement('option',{value:'sankey'},'Flow'),
                            React.createElement('option',{value:'disjoint'},'Cluster'),
                            React.createElement('option',{value:'bundle'},'Bundle'),
                            React.createElement('option',{value:'architecture'},'Block Diagram')
                        )
                    ),
                    graphConfig.vizType==='graph3d'&&React.createElement(Graph3DView,{ref:graph3dViewRef,data,folderFilter,colorMap,colorMode,theme,config:graphConfig,selectedPath:selected&&selected.path,blastRadius,lineThickness,onSelect:function(path){if(path)selectFile(path);else{setSelected(null);setBlastRadius(null);}}}),
                    graphConfig.vizType==='treemap'&&React.createElement('div',{ref:treemapRef,className:'treemap-container'}),
                    graphConfig.vizType==='matrix'&&React.createElement('div',{ref:matrixRef,className:'matrix-container',style:{width:'100%',height:'100%',overflow:'auto',display:'flex',alignItems:'center',justifyContent:'center'}}),
                    graphConfig.vizType==='dendro'&&React.createElement('div',{ref:dendroRef,className:'dendro-container',style:{width:'100%',height:'100%',position:'relative'}}),
                    graphConfig.vizType==='sankey'&&React.createElement('div',{ref:sankeyRef,className:'sankey-container',style:{width:'100%',height:'100%',position:'relative'}}),
                    graphConfig.vizType==='disjoint'&&React.createElement('div',{ref:disjointRef,className:'disjoint-container',style:{width:'100%',height:'100%',position:'relative'}}),
                    graphConfig.vizType==='bundle'&&React.createElement('div',{ref:bundleRef,className:'bundle-container'}),
                    graphConfig.vizType==='architecture'&&React.createElement(ArchitectureView,{ref:architectureViewRef,diagram:data&&data.architectureDiagram,theme,includeTests:architectureIncludeTests,includeBuildOutput:architectureIncludeBuildOutput,selectedBlock:selectedArchitectureBlock,onSelect:selectArchitectureBlock}),
                    vizUsesLineThickness(graphConfig.vizType)&&React.createElement('div',{className:'canvas-toolbar'},
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('button',{className:'tool-btn',onClick:zoomIn,'aria-label':'Zoom in'},'+'),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('button',{className:'tool-btn',onClick:zoomOut,'aria-label':'Zoom out'},'−'),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('button',{className:'tool-btn',onClick:resetZoom,'aria-label':'Reset zoom'},'⟲'),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('button',{className:'tool-btn',onClick:fitView,'aria-label':'Fit view'},'⊡'),
                        React.createElement('button',{className:'tool-btn'+(showGraphConfig?' active':''),onClick:function(){setShowGraphConfig(!showGraphConfig);},'aria-label':'Graph settings',style:showGraphConfig?{background:'var(--accbg)',borderColor:'var(--acc)'}:{}},
                            React.createElement(Icon,{name:'settings',size:'m'})
                        )
                    ),
                    vizUsesLineThickness(graphConfig.vizType)&&showGraphConfig&&React.createElement('div',{className:'graph-config'+(vizHasGraphToolbar(graphConfig.vizType)?'':' thickness-only')},
                        (graphConfig.vizType==='graph'||graphConfig.vizType==='code')&&React.createElement('div',{className:'graph-config-title'},'Layout'),
                        (graphConfig.vizType==='graph'||graphConfig.vizType==='code')&&React.createElement('div',{className:'view-toggle',style:{flexWrap:'wrap'}},
                            React.createElement('button',{className:'view-btn'+(graphConfig.viewMode==='force'?' active':''),onClick:function(){setGraphConfig(Object.assign({},graphConfig,{viewMode:'force'}));}},'Force'),
                            React.createElement('button',{className:'view-btn'+(graphConfig.viewMode==='radial'?' active':''),onClick:function(){setGraphConfig(Object.assign({},graphConfig,{viewMode:'radial'}));}},'Radial'),
                            React.createElement('button',{className:'view-btn'+(graphConfig.viewMode==='hierarchical'?' active':''),onClick:function(){setGraphConfig(Object.assign({},graphConfig,{viewMode:'hierarchical'}));}},'Layers'),
                            React.createElement('button',{className:'view-btn'+(graphConfig.viewMode==='grid'?' active':''),onClick:function(){setGraphConfig(Object.assign({},graphConfig,{viewMode:'grid'}));}},'Grid'),
                            React.createElement('button',{className:'view-btn'+(graphConfig.viewMode==='metro'?' active':''),onClick:function(){setGraphConfig(Object.assign({},graphConfig,{viewMode:'metro'}));}},'Metro')
                        ),
                        React.createElement('div',{className:'graph-config-title',style:{marginTop:(graphConfig.vizType==='graph'||graphConfig.vizType==='code')?8:0}},vizHasGraphToolbar(graphConfig.vizType)?'Spacing':'Lines'),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('div',{className:'config-row'},
                            React.createElement('span',{className:'config-label'},'Spread'),
                            React.createElement('input',{type:'range',className:'config-slider',min:'50',max:'500',value:graphConfig.spacing,onChange:function(e){setGraphConfig(Object.assign({},graphConfig,{spacing:parseInt(e.target.value)}));}}),
                            React.createElement('span',{className:'config-value'},graphConfig.spacing)
                        ),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('div',{className:'config-row'},
                            React.createElement('span',{className:'config-label'},'Links'),
                            React.createElement('input',{type:'range',className:'config-slider',min:'30',max:'200',value:graphConfig.linkDist,onChange:function(e){setGraphConfig(Object.assign({},graphConfig,{linkDist:parseInt(e.target.value)}));}}),
                            React.createElement('span',{className:'config-value'},graphConfig.linkDist)
                        ),
                        React.createElement('div',{className:'config-row'},
                            React.createElement('span',{className:'config-label'},'Thickness'),
                            React.createElement('input',{type:'range',className:'config-slider',min:String(LINE_THICKNESS_MIN),max:String(LINE_THICKNESS_MAX),step:'1',value:lineThickness,'aria-label':'Line thickness',onChange:function(e){persistLineThickness(e.target.value);}}),
                            React.createElement('span',{className:'config-value'},lineThickness)
                        ),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('div',{className:'graph-config-title',style:{marginTop:8}},'Display'),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('label',{className:'config-check'},
                            React.createElement('input',{type:'checkbox',checked:graphConfig.showLabels,onChange:function(e){setGraphConfig(Object.assign({},graphConfig,{showLabels:e.target.checked}));}}),
                            'Show labels'
                        ),
                        vizHasGraphToolbar(graphConfig.vizType)&&React.createElement('label',{className:'config-check',style:{marginTop:6}},
                            React.createElement('input',{type:'checkbox',checked:graphConfig.curvedLinks,onChange:function(e){setGraphConfig(Object.assign({},graphConfig,{curvedLinks:e.target.checked}));}}),
                            'Curved links'
                        ),
                        graphConfig.vizType==='graph3d'&&React.createElement('label',{className:'config-check',style:{marginTop:6}},
                            React.createElement('input',{type:'checkbox',checked:!!graphConfig.autoRotate,onChange:function(e){setGraphConfig(Object.assign({},graphConfig,{autoRotate:e.target.checked}));}}),
                            'Auto-rotate'
                        )
                    ),
                    graphConfig.vizType!=='architecture'&&React.createElement('div',{className:'canvas-info'},
                        React.createElement('div',{className:'info-chip'},React.createElement('strong',null,folderFilter?data.files.filter(function(f){return f.folder===folderFilter||f.folder.startsWith(folderFilter+'/');}).length:data.files.length),' files'),
                        React.createElement('div',{className:'info-chip'},React.createElement('strong',null,data.connections.length),' links'),
                        data.excludePatterns&&data.excludePatterns.length>0&&React.createElement('div',{className:'info-chip'},
                            React.createElement(Icon,{name:'ban',size:'s'}),
                            ' ',
                            React.createElement('strong',null,data.excludePatterns.length),
                            ' custom excludes'
                        ),
                        selected&&blastRadius&&React.createElement('div',{className:'info-chip'},
                            React.createElement(Icon,{name:'impact',size:'s'}),
                            ' ',
                            React.createElement('strong',null,blastRadius.count),
                            ' dependents',
                            blastRadius.fnsUsed>0?' • '+blastRadius.fnsUsed+' fns used':''
                        )
                    ),
                    renderColorByControl(),
                    renderCodeViewPrefs(),
                    graphConfig.vizType!=='architecture'&&graphConfig.vizType!=='code'&&React.createElement('div',{className:'legend'+(legendCollapsed?' collapsed':'')+((graphConfig.vizType==='graph'||graphConfig.vizType==='graph3d')?' with-color-by':'')},
                        React.createElement('div',{className:'legend-header',onClick:function(){setLegendCollapsed(!legendCollapsed);}},
                            React.createElement('div',{className:'legend-title',style:{margin:0}},colorMode==='folder'?'Folders':colorMode==='layer'?'Layers':'Churn'),
                            React.createElement('span',{className:'legend-toggle'},'▼')
                        ),
                        React.createElement('div',{className:'legend-content'},
                            colorMode==='folder'&&data.folders.slice(0,12).map(function(f,i){return React.createElement('div',{key:f,className:'legend-item'+(folderFilter===f?' active':''),onClick:function(e){e.stopPropagation();filterByFolder(f);}},React.createElement('div',{className:'legend-color',style:{background:colorMap[f]||COLORS[i%COLORS.length]}}),f||'root');}),
                            colorMode==='folder'&&data.folders.length>12&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginTop:4}},'+',data.folders.length-12,' more'),
                            colorMode==='layer'&&Object.entries(LAYER_COLORS).map(function(e){return React.createElement('div',{key:e[0],className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:e[1]}}),e[0]=== 'modules' ? 'Modules' : e[0]=== 'forms' ? 'UserForms' : e[0]=== 'classes' ? 'Classes' : e[0]);}),
                            colorMode==='churn'&&React.createElement(React.Fragment,null,React.createElement('div',{className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:'#ff5f5f'}}),'High (7+ commits)'),React.createElement('div',{className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:'#ff9f43'}}),'Medium (4-6)'),React.createElement('div',{className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:'#22c55e'}}),'Low (0-3)'))
                        )
                    ),
                    tooltip&&React.createElement('div',{className:'tooltip',style:{left:tooltip.x,top:tooltip.y}},React.createElement('div',{className:'tooltip-title'},tooltip.title),React.createElement('div',{className:'tooltip-content'},tooltip.content))
                )
            ),
            React.createElement('div',{className:'right-panel'+(isMobile&&mobilePanel==='details'?' mobile-visible':''),style:{width:isMobile?'100vw':rightPanelWidth}},
                isMobile&&React.createElement('div',{className:'mobile-panel-header'},
                    React.createElement('div',{className:'mobile-panel-meta'},
                        React.createElement('div',{className:'mobile-panel-title'},selected?selected.name:'Insights'),
                        React.createElement('div',{className:'mobile-panel-subtitle'},selected?selected.path:(data?'Browse issues, patterns, and security findings':'Select a file to inspect it'))
                    ),
                    React.createElement('button',{className:'mobile-panel-close',type:'button','aria-label':'Close details panel',onClick:function(){setMobilePanel(null);}},
                        React.createElement(Icon,{name:'close',size:'m'})
                    )
                ),
                React.createElement('div',{className:'resize-handle',onMouseDown:function(e){
                    e.preventDefault();
                    var startX=e.clientX,startW=rightPanelWidth;
                    function onMove(e){setRightPanelWidth(Math.max(280,Math.min(500,startW-(e.clientX-startX))));}
                    function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
                    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
                }}),
                data?React.createElement(React.Fragment,null,
                    React.createElement('div',{className:'panel-tabs'},
                        React.createElement('button',{className:'panel-tab'+(rightTab==='details'?' active':''),onClick:function(){setRightTab('details');setDrillDown(null);}},selected?iconLabel('file','FILE'):(graphConfig.vizType==='architecture'?iconLabel('layers','ARCH'):iconLabel('search','ISSUES'))),
                        data.beam&&React.createElement('button',{className:'panel-tab'+(rightTab==='runtime'?' active':''),onClick:function(){setRightTab('runtime');}},'RUNTIME'),
                        React.createElement('button',{className:'panel-tab'+(rightTab==='patterns'?' active':''),onClick:function(){setRightTab('patterns');setDrillDown(null);}},iconLabel('puzzle','PATTERNS'),React.createElement('span',{className:'panel-tab-pill'},data.patterns.length)),
                        React.createElement('button',{className:'panel-tab'+(rightTab==='security'?' active':''),onClick:function(){setRightTab('security');setDrillDown(null);}},iconLabel('security','SECURITY'),data.stats.security>0&&React.createElement('span',{className:'panel-tab-pill alert'},data.stats.security)),
                        React.createElement('button',{className:'panel-tab'+(rightTab==='suggestions'?' active':''),onClick:function(){setRightTab('suggestions');setDrillDown(null);}},iconLabel('action','ACTIONS'),data.suggestions&&data.suggestions.length>0&&React.createElement('span',{className:'panel-tab-pill alert'},data.suggestions.length))
                    ),
                    React.createElement('div',{className:'panel-content'},
                        data.beam&&rightTab==='runtime'&&React.createElement(RuntimePanel,{index:runtimeIndex,inspection:runtimeInspection,onOpen:openSourceLocation}),
                        rightTab==='details'&&(selected?React.createElement(React.Fragment,null,
                            React.createElement('button',{className:'top-btn',style:{width:'100%',marginBottom:12},onClick:function(){setSelected(null);setBlastRadius(null);}},'← Back to Issues'),
                            React.createElement('div',{className:'panel-header',style:{margin:'0 -12px 12px',padding:12}},
                                React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}},
                                    React.createElement('div',null,
                                        React.createElement('div',{className:'panel-title'},React.createElement(Icon,{name:'file',size:'m'}),' ',selected.name),
                                        React.createElement('div',{className:'panel-subtitle'},selected.folder||'root',' • ',selected.layer,' • ',selected.lines,' lines',selected.complexity&&selected.complexity.score>0?' • Complexity: '+selected.complexity.score:'')
                                    ),
                                    React.createElement('button',{className:'view-file-btn',onClick:function(){openFilePreview(selected.path);}},iconLabel('eye','View Source'))
                                )
                            ),
                            data.beam&&React.createElement(SourceNavigation,{path:selected.path,symbols:beamSymbols,locations:beamLocations,error:beamNavigationError,onOpen:openSourceLocation,onReferences:(path,position)=>navigateBeamSymbol('references',path,position)}),
                            React.createElement(SourceProcesses,{index:runtimeIndex,path:selected.path,onSelect:id=>{runtimeInspection.setFocus(id);setRightTab('runtime');}}),
                            blastRadius&&React.createElement('div',{className:'card',style:{marginBottom:12}},
                                React.createElement('div',{className:'card-header',onClick:function(){toggleCard('blast');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('blast')?' open':'')},'▶'),React.createElement(Icon,{name:'impact',size:'s'}),' Impact Analysis'),React.createElement('span',{className:'badge badge-'+(blastRadius.level==='low'?'success':blastRadius.level==='medium'?'warning':'danger')},blastRadius.level.toUpperCase())),
                                expandedCards.has('blast')&&React.createElement('div',{className:'card-body'},
                                    React.createElement('div',{style:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}},
                                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--acc)'}},blastRadius.count),
                                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Direct Dependents')
                                        ),
                                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--purple)'}},blastRadius.transitiveCount||0),
                                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Transitive')
                                        ),
                                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--green)'}},blastRadius.fnsUsed||0),
                                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Fns Exported')
                                        ),
                                        React.createElement('div',{style:{background:'var(--bg0)',padding:8,borderRadius:6,textAlign:'center'}},
                                            React.createElement('div',{style:{fontSize:16,fontWeight:600,color:'var(--orange)'}},(blastRadius.dependencies||[]).length),
                                            React.createElement('div',{style:{fontSize:9,color:'var(--t3)'}},'Dependencies')
                                        )
                                    ),
                                    (blastRadius.count>0||blastRadius.fnsUsed>0)&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginBottom:8,padding:'6px 8px',background:'var(--bg0)',borderRadius:4}},
                                        blastRadius.count>0?blastRadius.count+' file'+(blastRadius.count>1?'s':'')+' directly depend on this file':'',
                                        blastRadius.count>0&&blastRadius.fnsUsed>0?' • ':'',
                                        blastRadius.fnsUsed>0?blastRadius.fnsUsed+' function'+(blastRadius.fnsUsed>1?'s':'')+' used '+blastRadius.totalCalls+' times':''
                                    ),
                                    blastRadius.affected.length>0&&React.createElement('div',{className:'blast-detail'},
                                        React.createElement('div',{style:{fontSize:9,fontWeight:600,marginBottom:6}},'Files that import from this:'),
                                        blastRadius.affected.slice(0,8).map(function(path){return React.createElement('div',{key:path,className:'blast-file',onClick:function(){goToFile(path);}},React.createElement(Icon,{name:'file',size:'s'}),' ',path.split('/').pop());}),
                                        blastRadius.affected.length>8&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginTop:4}},'+',blastRadius.affected.length-8,' more')
                                    ),
                                    (blastRadius.dependencies||[]).length>0&&React.createElement('div',{className:'blast-detail',style:{marginTop:8}},
                                        React.createElement('div',{style:{fontSize:9,fontWeight:600,marginBottom:6,color:'var(--orange)'}},'Dependencies (risk if these change):'),
                                        blastRadius.dependencies.slice(0,5).map(function(path){return React.createElement('div',{key:path,className:'blast-file',onClick:function(){goToFile(path);}},React.createElement(Icon,{name:'file',size:'s'}),' ',path.split('/').pop());}),
                                        blastRadius.dependencies.length>5&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginTop:4}},'+',blastRadius.dependencies.length-5,' more')
                                    )
                                )
                            ),
                            (function(){
                                var outgoing=[],incoming=[];
                                var connByFile={out:{},in:{}};
                                data.connections.forEach(function(c){
                                    var src=typeof c.source==='object'?c.source.id:c.source;
                                    var tgt=typeof c.target==='object'?c.target.id:c.target;
                                    if(src===selected.path){
                                        if(!connByFile.out[tgt])connByFile.out[tgt]={file:tgt,fns:[]};
                                        connByFile.out[tgt].fns.push({name:c.evidence==='mix xref'?c.kind:c.fn,count:c.count,evidence:c.evidence});
                                    }
                                    if(tgt===selected.path){
                                        if(!connByFile.in[src])connByFile.in[src]={file:src,fns:[]};
                                        connByFile.in[src].fns.push({name:c.evidence==='mix xref'?c.kind:c.fn,count:c.count,evidence:c.evidence});
                                    }
                                });
                                outgoing=Object.values(connByFile.out).sort(function(a,b){return b.fns.length-a.fns.length;});
                                incoming=Object.values(connByFile.in).sort(function(a,b){return b.fns.length-a.fns.length;});
                                var totalConns=outgoing.length+incoming.length;
                                return totalConns>0&&React.createElement('div',{className:'card',style:{marginBottom:12}},
                                    React.createElement('div',{className:'card-header',onClick:function(){toggleCard('conns');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('conns')?' open':'')},'▶'),React.createElement(Icon,{name:'link',size:'s'}),' Connections'),React.createElement('span',{className:'badge badge-default'},totalConns)),
                                    expandedCards.has('conns')&&React.createElement('div',{className:'card-body',style:{padding:0}},
                                        outgoing.length>0&&React.createElement(React.Fragment,null,
                                            React.createElement('div',{style:{fontSize:9,fontWeight:600,color:'var(--t3)',padding:'8px 12px',background:'var(--bg2)',borderBottom:'1px solid var(--border)'}},'Used by (',outgoing.length,' files)'),
                                            outgoing.map(function(conn){
                                                var isOpen=expandedCards.has('conn-out-'+conn.file);
                                                return React.createElement('div',{key:conn.file,className:'conn-item'},
                                                    React.createElement('div',{className:'conn-header',onClick:function(e){e.stopPropagation();toggleCard('conn-out-'+conn.file);}},
                                                        React.createElement('span',{className:'card-toggle'+(isOpen?' open':''),style:{fontSize:8,marginRight:6}},'▶'),
                                                        React.createElement('span',{className:'conn-file-icon'},React.createElement(Icon,{name:'file',size:'s'})),
                                                        React.createElement('span',{className:'conn-file-name'},conn.file.split('/').pop()),
                                                        React.createElement('span',{className:'badge badge-default',style:{marginLeft:'auto'}},conn.fns.length,' relationship',conn.fns.length!==1?'s':'')
                                                    ),
                                                    isOpen&&React.createElement('div',{className:'conn-fns'},
                                                        conn.fns.map(function(fn,i){return React.createElement('div',{key:i,className:'conn-fn'},
                                                            React.createElement('span',{className:'conn-fn-name'},fn.name,fn.evidence==='mix xref'?'':'()'),
                                                            React.createElement('span',{className:'conn-fn-count'},fn.evidence==='mix xref'?'mix xref':fn.count+'×')
                                                        );}),
                                                        React.createElement('div',{className:'conn-goto',onClick:function(){goToFile(conn.file);}},'→ View ',conn.file.split('/').pop())
                                                    )
                                                );
                                            }),
                                        ),
                                        incoming.length>0&&React.createElement(React.Fragment,null,
                                            React.createElement('div',{style:{fontSize:9,fontWeight:600,color:'var(--t3)',padding:'8px 12px',background:'var(--bg2)',borderBottom:'1px solid var(--border)',borderTop:outgoing.length>0?'1px solid var(--border)':'none'}},'Depends on (',incoming.length,' files)'),
                                            incoming.map(function(conn){
                                                var isOpen=expandedCards.has('conn-in-'+conn.file);
                                                return React.createElement('div',{key:conn.file,className:'conn-item'},
                                                    React.createElement('div',{className:'conn-header',onClick:function(e){e.stopPropagation();toggleCard('conn-in-'+conn.file);}},
                                                        React.createElement('span',{className:'card-toggle'+(isOpen?' open':''),style:{fontSize:8,marginRight:6}},'▶'),
                                                        React.createElement('span',{className:'conn-file-icon'},React.createElement(Icon,{name:'file',size:'s'})),
                                                        React.createElement('span',{className:'conn-file-name'},conn.file.split('/').pop()),
                                                        React.createElement('span',{className:'badge badge-default',style:{marginLeft:'auto'}},conn.fns.length,' relationship',conn.fns.length!==1?'s':'')
                                                    ),
                                                    isOpen&&React.createElement('div',{className:'conn-fns'},
                                                        conn.fns.map(function(fn,i){return React.createElement('div',{key:i,className:'conn-fn'},
                                                            React.createElement('span',{className:'conn-fn-name'},fn.name,fn.evidence==='mix xref'?'':'()'),
                                                            React.createElement('span',{className:'conn-fn-count'},fn.evidence==='mix xref'?'mix xref':fn.count+'×')
                                                        );}),
                                                        React.createElement('div',{className:'conn-goto',onClick:function(){goToFile(conn.file);}},'→ View ',conn.file.split('/').pop())
                                                    )
                                                );
                                            }),
                                        )
                                    )
                                );
                            })(),
                            React.createElement('div',{className:'card',style:{marginBottom:12}},
                                React.createElement('div',{className:'card-header',onClick:function(){toggleCard('own');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('own')?' open':'')},'▶'),React.createElement(Icon,{name:'users',size:'s'}),' Ownership')),
                                expandedCards.has('own')&&React.createElement('div',{className:'card-body'},
                                    ownerLoading?React.createElement('div',{className:'loading-owner'},'Loading ownership data...'):
                                    ownership&&ownership.length>0?React.createElement(React.Fragment,null,
                                        React.createElement('div',{className:'owner-bar'},ownership.slice(0,5).map(function(o,i){return React.createElement('div',{key:i,className:'owner-segment',style:{width:o.percent+'%',background:COLORS[i%COLORS.length]}});})),
                                        React.createElement('div',{className:'owner-list'},ownership.slice(0,5).map(function(o,i){return React.createElement('div',{key:i,className:'owner-item'},React.createElement('div',{className:'owner-avatar',style:{background:COLORS[i%COLORS.length]}},o.name[0].toUpperCase()),React.createElement('span',{className:'owner-name'},o.name),React.createElement('span',{className:'owner-percent'},o.percent,'%'));}))
                                    ):React.createElement('div',{style:{fontSize:10,color:'var(--t3)',padding:8}},'No ownership data available')
                                )
                            ),
                            React.createElement('div',{className:'card'},
                                React.createElement('div',{className:'card-header',onClick:function(){toggleCard('fns');}},React.createElement('div',{className:'card-title'},React.createElement('span',{className:'card-toggle'+(expandedCards.has('fns')?' open':'')},'▶'),React.createElement(Icon,{name:'bolt',size:'s'}),' Functions (',selected.functions.length,')')),
                                expandedCards.has('fns')&&React.createElement('div',{className:'card-body',style:{padding:8}},
                                    selected.functions.length===0?React.createElement('div',{style:{fontSize:10,color:'var(--t3)',padding:8,textAlign:'center'}},'No functions detected'):
                                    selected.functions.map(function(fn){
                                        var statKey=fn.key||Parser.functionKey(fn);
                                        var st=data.fnStats[statKey]||data.fnStats[fn.name];
                                        var expandKey=statKey||fn.name;
                                        var isExpanded=expandedFns.has(expandKey);
                                        var intCalls=st?st.internal:0,extCalls=st?st.external:0;
                                        return React.createElement('div',{key:expandKey,className:'fn-item'},
                                            React.createElement('div',{className:'fn-header',onClick:function(){toggleFn(expandKey);}},
                                                React.createElement('span',{className:'fn-name'},fn.name,fn.evidence==='mix xref'?'':'()'),
                                                React.createElement('span',{style:{display:'flex',alignItems:'center',gap:4}},
                                                    React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(selected.path,fn.line);},title:'View source'},React.createElement(Icon,{name:'eye',size:'s'})),
                                                    React.createElement('span',{className:'fn-line'},'L',fn.line),
                                                    React.createElement('span',{className:'badge badge-default',title:'Internal calls (same file)'},intCalls,' int'),
                                                    React.createElement('span',{className:'badge '+(extCalls>10?'badge-danger':extCalls>0?'badge-warning':'badge-default'),title:'External calls (other files)'},extCalls,' ext')
                                                )
                                            ),
                                            isExpanded&&React.createElement(React.Fragment,null,
                                                fn.code&&React.createElement('div',{className:'fn-code'},fn.code),
                                                st&&st.callers&&st.callers.length>0&&React.createElement('div',{className:'fn-callers'},
                                                    React.createElement('div',{className:'fn-callers-title'},'External callers:'),
                                                    st.callers.slice(0,8).map(function(c,i){return React.createElement('div',{key:i,className:'fn-caller',onClick:function(){goToFile(c.file);}},
                                                        React.createElement(Icon,{name:'file',size:'s'}),
                                                        React.createElement('span',null,c.name),
                                                        React.createElement('span',{style:{marginLeft:'auto',color:'var(--t3)'}},c.count,'×')
                                                    );}),
                                                    st.callers.length>8&&React.createElement('div',{style:{fontSize:9,color:'var(--t3)',padding:'4px 6px'}},'+',st.callers.length-8,' more')
                                                ),
                                                intCalls===0&&extCalls===0&&React.createElement('div',{style:{fontSize:9,color:'var(--orange)',padding:8,textAlign:'center',background:'rgba(255,159,67,0.1)',borderRadius:4}},
                                                    React.createElement(Icon,{name:'warning',size:'s'}),
                                                    st&&st.usageCertainty==='unverified'?' No callers found by source analysis; runtime use is unknown.':' No callers found by source analysis.'
                                                )
                                            )
                                        );
                                    })
                                )
                            )
                        ):graphConfig.vizType==='architecture'?renderArchitectureSummary():React.createElement(React.Fragment,null,
                            React.createElement(AnalysisTools,{assessments:data.assessments}),
                            React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},React.createElement(Icon,{name:'search',size:'m'}),' Architecture Issues (',data.issues.length,')'),
                            data.issues.length===0?React.createElement('div',{style:{textAlign:'center',padding:20}},React.createElement(Icon,{name:'spark',size:'xxl',className:'empty-icon'}),React.createElement('div',{style:{color:'var(--green)'}},'No issues detected!')):
                            data.issues.map(function(issue,i){return React.createElement('div',{key:i,className:'security-item '+(issue.type==='critical'?'high':'medium'),style:{cursor:'pointer'},onClick:function(){if(issue.sourceLocation&&issue.sourceLocation.path)openSourceLocation(issue.sourceLocation);else setDrillDown({type:'issue',data:issue});}},
                                React.createElement('div',{className:'security-header'},
                                    React.createElement(StatusDot,{color:issue.type==='critical'?'var(--red)':'var(--orange)'}),
                                    React.createElement('span',{className:'security-title'},issue.title)
                                ),
                                React.createElement('div',{className:'security-desc'},issue.desc),
                                React.createElement('div',{style:{fontSize:9,color:'var(--acc)',marginTop:6}},'Click for details (',issue.items?issue.items.length:0,' items) →')
                            );})
                        )),
                        rightTab==='patterns'&&React.createElement(React.Fragment,null,
                            React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},React.createElement(Icon,{name:'puzzle',size:'m'}),' Design Patterns & Anti-Patterns'),
                            data.patterns.length===0?React.createElement('div',{style:{textAlign:'center',padding:20,color:'var(--t3)'}},React.createElement(Icon,{name:'puzzle',size:'xxl',className:'empty-icon'}),React.createElement('div',null,'No patterns detected'),React.createElement('div',{style:{fontSize:10,marginTop:8}},'Patterns are detected based on code structure')):
                            data.patterns.map(function(p,i){return React.createElement('div',{key:i,className:'pattern-item'+(p.isAnti?' anti':''),style:{cursor:'pointer'},onClick:function(){setDrillDown({type:'pattern',data:p});}},
                                React.createElement('div',{className:'pattern-header'},
                                    React.createElement(Icon,{name:p.icon,size:'m',className:'pattern-icon'}),
                                    React.createElement('span',{className:'pattern-name'},p.name),
                                    p.isAnti&&React.createElement('span',{className:'badge badge-danger',style:{marginLeft:8}},'Anti-pattern')
                                ),
                                React.createElement('div',{className:'pattern-desc'},p.desc),
                                React.createElement('div',{style:{fontSize:9,color:'var(--acc)',marginTop:6}},'Click for details (',p.files.length,' files) →')
                            );})
                        ),
                        rightTab==='security'&&React.createElement(React.Fragment,null,
                            React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},React.createElement(Icon,{name:'security',size:'m'}),' Security Analysis'),
                            data.securityIssues.length===0?React.createElement('div',{style:{textAlign:'center',padding:20}},React.createElement(Icon,{name:'security',size:'xxl',className:'empty-icon'}),React.createElement('div',{style:{color:'var(--green)',fontWeight:600}},'No security issues found!'),React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:8}},'Your code passed all security checks')):
                            React.createElement(React.Fragment,null,
                                React.createElement('div',{style:{display:'flex',gap:8,marginBottom:12}},
                                    React.createElement('div',{className:'badge badge-danger'},data.securityIssues.filter(function(i){return i.severity==='high';}).length,' High'),
                                    React.createElement('div',{className:'badge badge-warning'},data.securityIssues.filter(function(i){return i.severity==='medium';}).length,' Medium'),
                                    React.createElement('div',{className:'badge badge-info'},data.securityIssues.filter(function(i){return i.severity==='low';}).length,' Low'),
                                    React.createElement('div',{className:'badge badge-default'},data.securityIssues.filter(function(i){return i.severity==='info';}).length,' Info')
                                ),
                                data.securityIssues.map(function(issue,i){return React.createElement('div',{key:i,className:'security-item '+issue.severity,style:{cursor:'pointer'},onClick:function(){setDrillDown({type:'security',data:issue});}},
                                    React.createElement('div',{className:'security-header'},
                                        React.createElement(StatusDot,{color:getSeverityColor(issue.severity)}),
                                        React.createElement('span',{className:'security-title'},issue.title)
                                    ),
                                    React.createElement('div',{className:'security-desc'},issue.desc),
                                    React.createElement('div',{style:{fontSize:9,color:'var(--acc)',marginTop:6}},'Click for details →'),
                                    issue.code&&React.createElement('div',{className:'security-code'},issue.code)
                                );})
                            )
                        ),
                        rightTab==='suggestions'&&React.createElement(React.Fragment,null,
                            React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},React.createElement(Icon,{name:'action',size:'m'}),' Actionable Suggestions'),
                            (!data.suggestions||data.suggestions.length===0)?React.createElement('div',{style:{textAlign:'center',padding:20}},React.createElement(Icon,{name:'spark',size:'xxl',className:'empty-icon'}),React.createElement('div',{style:{color:'var(--green)',fontWeight:600}},'No issues to address!'),React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:8}},'Your codebase looks healthy')):
                            React.createElement(React.Fragment,null,
                                React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginBottom:12}},'Prioritized recommendations based on your codebase analysis'),
                                data.suggestions.map(function(s,i){
                                    var suggestionTone=s.priority==='critical'
                                        ? getAccentBlockStyle('rgba(255,95,95,0.36)','rgba(255,95,95,0.08)',{padding:12,marginBottom:10})
                                        : s.priority==='high'
                                            ? getAccentBlockStyle('rgba(255,159,67,0.34)','rgba(255,159,67,0.08)',{padding:12,marginBottom:10})
                                            : getAccentBlockStyle('rgba(0,255,157,0.28)','rgba(0,255,157,0.08)',{padding:12,marginBottom:10});
                                    return React.createElement('div',{key:i,className:'suggestion-card',style:suggestionTone},
                                    React.createElement('div',{style:{display:'flex',alignItems:'center',gap:8,marginBottom:6}},
                                        React.createElement(Icon,{name:s.icon,size:'l'}),
                                        React.createElement('span',{style:{fontWeight:600,fontSize:11}},s.title),
                                        React.createElement('span',{className:'badge badge-'+(s.priority==='critical'?'danger':s.priority==='high'?'warning':'info'),style:{marginLeft:'auto',fontSize:8}},s.priority.toUpperCase())
                                    ),
                                    React.createElement('div',{style:{fontSize:10,color:'var(--t2)',marginBottom:8}},s.desc),
                                    React.createElement('div',{style:{fontSize:9,background:'var(--bg2)',padding:'6px 8px',borderRadius:4,marginBottom:6}},
                                        React.createElement('span',{style:{color:'var(--t3)'}},'Action: '),
                                        React.createElement('span',{style:{color:'var(--t1)'}},s.action)
                                    ),
                                    React.createElement('div',{style:{fontSize:9,color:'var(--green)'}},React.createElement(Icon,{name:'spark',size:'s'}),' ',s.impact)
                                );}),
                                data.duplicates&&data.duplicates.length>0&&React.createElement('div',{style:{marginTop:16}},
                                    React.createElement('div',{style:{fontSize:11,fontWeight:600,marginBottom:8}},React.createElement(Icon,{name:'copy',size:'m'}),' Duplicate Functions (',data.duplicates.length,')'),
                                    data.duplicates.slice(0,10).map(function(d,i){return React.createElement('div',{key:i,style:{background:'var(--bg0)',borderRadius:6,padding:8,marginBottom:6,fontSize:10,cursor:'pointer'},onClick:function(){setDrillDown({type:'duplicate',data:d});}},
                                        React.createElement('div',{style:{fontWeight:600,color:d.type==='code'?'var(--purple)':'var(--orange)'}},d.type==='code'?'Similar Code':'Same Name',': ',d.name),
                                        React.createElement('div',{style:{fontSize:9,color:'var(--acc)',marginTop:4}},'Click for details (',d.files.length,' locations) →')
                                    );})
                                )
                            )
                        )
                    )
                ):React.createElement('div',{className:'empty-state'},
                    React.createElement(Icon,{name:'chart',size:'xxl',className:'empty-icon'}),
                    React.createElement('div',{className:'empty-title'},'Analysis'),
                    React.createElement('div',{className:'empty-desc'},'Analyze a GitHub repo, local folder, or ZIP archive to see insights')
                )
            )
        ),
        showExport&&React.createElement('div',{className:'modal-overlay',onClick:function(){setShowExport(false);}},
            React.createElement('div',{className:'modal',onClick:function(e){e.stopPropagation();},style:{maxWidth:480}},
                React.createElement('div',{className:'modal-header'},React.createElement('div',{className:'modal-title'},iconLabel('export','Export','m')),React.createElement('button',{className:'modal-close',onClick:function(){setShowExport(false);}},'×')),
                React.createElement('div',{className:'modal-body'},
                    data&&data.architectureDiagram&&React.createElement(React.Fragment,null,
                        React.createElement('div',{style:{fontSize:10,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',marginBottom:8}},graphConfig.vizType==='architecture'?'Block Diagram (current view)':'Block Diagram'),
                        React.createElement('div',{className:'export-options'},
                            React.createElement('div',{className:'export-option',onClick:function(){copyMermaid();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'copy',size:'xl'})),React.createElement('div',{className:'export-option-label'},'Copy Mermaid')),
                            React.createElement('div',{className:'export-option',onClick:function(){downloadMermaid();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'code',size:'xl'})),React.createElement('div',{className:'export-option-label'},'Mermaid File')),
                            React.createElement('div',{className:'export-option',onClick:function(){downloadArchitectureSVG();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'image',size:'xl'})),React.createElement('div',{className:'export-option-label'},'Diagram SVG'))
                        )
                    ),
                    graphConfig.vizType!=='architecture'&&React.createElement(React.Fragment,null,
                        React.createElement('div',{style:{fontSize:10,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',marginBottom:8,marginTop:data&&data.architectureDiagram?16:0}},'Graph Visualization'),
                        !graphSvgExportEnabled(graphConfig.vizType)&&React.createElement('div',{style:{fontSize:9,color:'var(--t2)',marginBottom:10,lineHeight:1.4}},'Code cards are HTML overlays, not SVG. Switch to Graph to export an image.'),
                        React.createElement('div',{className:'export-options'},
                            React.createElement('div',{className:'export-option'+(graphSvgExportEnabled(graphConfig.vizType)?'':' disabled'),'aria-disabled':graphSvgExportEnabled(graphConfig.vizType)?undefined:'true',onClick:function(){if(!graphSvgExportEnabled(graphConfig.vizType))return;exportSVG();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'image',size:'xl'})),React.createElement('div',{className:'export-option-label'},'SVG Image')),
                            React.createElement('div',{className:'export-option'+(graphConfig.vizType==='graph'?'':' disabled'),'aria-disabled':graphConfig.vizType==='graph'?undefined:'true',onClick:function(){if(graphConfig.vizType!=='graph')return;exportPDF();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'file-pdf',size:'xl'})),React.createElement('div',{className:'export-option-label'},'PDF Document')),
                            React.createElement('div',{className:'export-option',onClick:function(){copyLink();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'link',size:'xl'})),React.createElement('div',{className:'export-option-label'},'Share Link'))
                        )
                    ),
                    React.createElement(React.Fragment,null,
                    React.createElement('div',{style:{fontSize:10,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',marginBottom:8,marginTop:16}},'Analysis Report'),
                    React.createElement('div',{style:{fontSize:9,color:'var(--t2)',marginBottom:10}},'Complete analysis with files, functions, patterns, security issues, and dependencies'),
                    React.createElement('div',{className:'export-options'},
                        React.createElement('div',{className:'export-option',onClick:function(){generateReport('json');setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'code',size:'xl'})),React.createElement('div',{className:'export-option-label'},'JSON Report')),
                        React.createElement('div',{className:'export-option',onClick:function(){generateReport('md');setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'note',size:'xl'})),React.createElement('div',{className:'export-option-label'},'Markdown')),
                        React.createElement('div',{className:'export-option',onClick:function(){generateReport('txt');setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'file',size:'xl'})),React.createElement('div',{className:'export-option-label'},'Plain Text'))
                    )
                    ),
                    React.createElement('div',{style:{fontSize:10,fontWeight:600,color:'var(--t3)',textTransform:'uppercase',marginBottom:8,marginTop:16}},'Raw Data'),
                    React.createElement('div',{className:'export-options'},
                        React.createElement('div',{className:'export-option',onClick:function(){exportJSON();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'settings',size:'xl'})),React.createElement('div',{className:'export-option-label'},'Raw JSON'))
                    )
                )
            )
        ),
        showExcludeModal&&React.createElement('div',{className:'modal-overlay',onClick:closeExcludeModal},
            React.createElement('div',{className:'modal',onClick:function(e){e.stopPropagation();},style:{maxWidth:540}},
                React.createElement('div',{className:'modal-header'},
                    React.createElement('div',{className:'modal-title'},iconLabel('ban','Exclude Patterns','m')),
                    React.createElement('div',{style:{display:'flex',alignItems:'center',gap:12}},
                        React.createElement('div',{className:'exclude-count'},parseExcludePatterns(excludePatternDraft).length,' custom'),
                        React.createElement('button',{className:'modal-close',onClick:closeExcludeModal},'×')
                    )
                ),
                React.createElement('div',{className:'modal-body'},
                    React.createElement('div',{className:'exclude-note'},
                        'Common build and cache folders are already excluded by default. Add project-specific patterns here before scanning a repo or opening a local folder.'
                    ),
                    React.createElement('div',{className:'exclude-note'},
                        'Supports exact names like ',React.createElement('code',null,'.git'),' or ',React.createElement('code',null,'attachments'),
                        ', file globs like ',React.createElement('code',null,'*.png'),
                        ', and path globs like ',React.createElement('code',null,'uploads/**'),' or ',React.createElement('code',null,'**/cache/**'),'.'
                    ),
                    React.createElement('div',{className:'form-group'},
                        React.createElement('label',{className:'form-label'},'Always Excluded'),
                        React.createElement('div',{className:'exclude-chip-list'},
                            DEFAULT_EXCLUDE_CHIPS.map(function(pattern){return React.createElement('div',{key:pattern,className:'exclude-chip'},pattern);})
                        )
                    ),
                    React.createElement('div',{className:'form-group'},
                        React.createElement('label',{className:'form-label'},'Custom Patterns'),
                        React.createElement('textarea',{className:'form-input exclude-textarea','aria-label':'Custom exclude patterns',placeholder:'attachments\nuploads/**\n**/cache/**\n*.png\n*.log',value:excludePatternDraft,onChange:function(e){setExcludePatternDraft(e.target.value);},rows:8}),
                        React.createElement('div',{className:'exclude-help'},'Use one pattern per line, or separate patterns with commas. Changes apply to the next analysis or refresh.')
                    )
                ),
                React.createElement('div',{className:'modal-footer'},
                    excludePatternDraft&&React.createElement('button',{className:'top-btn',onClick:function(){setExcludePatternDraft('');},style:{marginRight:'auto'}},'Clear Custom'),
                    React.createElement('button',{className:'top-btn',onClick:closeExcludeModal},'Cancel'),
                    React.createElement('button',{className:'top-btn primary',onClick:saveExcludePatterns},'Save')
                )
            )
        ),
        showPR&&React.createElement('div',{className:'modal-overlay',onClick:function(){setShowPR(false);}},
            React.createElement('div',{className:'modal pr-modal',onClick:function(e){e.stopPropagation();}},
                React.createElement('div',{className:'modal-header'},React.createElement('div',{className:'modal-title'},iconLabel('chart','PR Impact Analyzer','m')),React.createElement('button',{className:'modal-close',onClick:function(){setShowPR(false);}},'×')),
                React.createElement('div',{className:'modal-body',style:{maxHeight:'75vh',overflowY:'auto'}},
                    React.createElement('div',{className:'form-group'},React.createElement('label',{className:'form-label'},'Pull Request URL'),React.createElement('input',{className:'form-input','aria-label':'Pull Request URL',placeholder:'https://github.com/owner/repo/pull/123',value:prUrl,onChange:function(e){setPrUrl(e.target.value);},onKeyDown:function(e){if(e.key==='Enter')analyzePR();}})),
                    React.createElement('button',{className:'top-btn primary','aria-label':'Analyze Pull Request',onClick:analyzePR,style:{marginBottom:16,width:'100%'}},iconLabel('search','Analyze PR Impact')),
                    prData&&(function(){
                        var risk = calcPRRisk(prData, data);
                        var reviewers = findSuggestedReviewers(prData, data);
                        var testImpact = findTestImpact(prData, data);
                        var chains = findDependencyChains(prData, data);
                        var riskColor = risk.level === 'critical' ? 'var(--red)' : risk.level === 'high' ? 'var(--orange)' : risk.level === 'medium' ? 'var(--blue)' : 'var(--green)';
                        return React.createElement(React.Fragment, null,
                            React.createElement('div',{className:'pr-header',style:{marginBottom:16}},
                                React.createElement('div',{className:'pr-title',style:{fontSize:14}},prData.title),
                                React.createElement('div',{className:'pr-stats',style:{marginTop:8}},
                                    React.createElement('span',{className:'pr-add'},'+',prData.additions||0),
                                    React.createElement('span',{className:'pr-del'},'-',prData.deletions||0),
                                    React.createElement('span',{style:{color:'var(--t3)',marginLeft:8}},prData.files?prData.files.length:0,' files')
                                )
                            ),
                            React.createElement('div',{className:'pr-impact-grid'},
                                React.createElement('div',{className:'pr-impact-card'},
                                    React.createElement('div',{className:'pr-risk-meter'},
                                        React.createElement('div',{className:'pr-risk-circle',style:{borderColor:riskColor,background:'rgba('+[risk.level==='critical'?'255,95,95':risk.level==='high'?'255,159,67':risk.level==='medium'?'77,159,255':'34,197,94'].join(',')+',0.1)'}},
                                            React.createElement('div',{className:'pr-risk-value',style:{color:riskColor}},risk.score),
                                            React.createElement('div',{className:'pr-risk-text',style:{color:riskColor}},risk.level)
                                        ),
                                        React.createElement('div',{style:{marginTop:12,fontSize:10,color:'var(--t2)',textAlign:'center'}},'Risk Score')
                                    ),
                                    risk.factors.length > 0 && React.createElement('div',{style:{marginTop:12}},
                                        risk.factors.map(function(f,i) { return React.createElement('div',{key:i,style:{fontSize:9,color:'var(--t2)',padding:'4px 0',borderTop:i>0?'1px solid var(--border2)':'none'}},'• ',f); })
                                    )
                                ),
                                React.createElement('div',{className:'pr-impact-card'},
                                    React.createElement('div',{className:'pr-impact-card-title'},iconLabel('impact','Impact Metrics')),
                                    React.createElement('div',{className:'pr-metric-row'},React.createElement('span',{className:'pr-metric-label'},'Total Blast Radius'),React.createElement('span',{className:'pr-metric-value'},risk.totalBlast,' files')),
                                    React.createElement('div',{className:'pr-metric-row'},React.createElement('span',{className:'pr-metric-label'},'Files Changed'),React.createElement('span',{className:'pr-metric-value'},prData.files?prData.files.length:0)),
                                    React.createElement('div',{className:'pr-metric-row'},React.createElement('span',{className:'pr-metric-label'},'Lines Modified'),React.createElement('span',{className:'pr-metric-value'},(prData.additions||0)+(prData.deletions||0))),
                                    React.createElement('div',{className:'pr-metric-row'},React.createElement('span',{className:'pr-metric-label'},'Net Change'),React.createElement('span',{className:'pr-metric-value',style:{color:(prData.additions||0)-(prData.deletions||0)>=0?'var(--green)':'var(--red)'}},(prData.additions||0)-(prData.deletions||0)>0?'+':'',(prData.additions||0)-(prData.deletions||0)))
                                ),
                                reviewers.length > 0 && React.createElement('div',{className:'pr-impact-card'},
                                    React.createElement('div',{className:'pr-impact-card-title'},iconLabel('users','Suggested Reviewers')),
                                    reviewers.map(function(r,i) { return React.createElement('div',{key:i,className:'pr-reviewer-card'},
                                        React.createElement('div',{className:'pr-reviewer-avatar',style:{background:r.avatar}},r.name[0]),
                                        React.createElement('div',{className:'pr-reviewer-info'},
                                            React.createElement('div',{className:'pr-reviewer-name'},r.name),
                                            React.createElement('div',{className:'pr-reviewer-reason'},r.reason)
                                        )
                                    ); })
                                ),
                                testImpact.length > 0 && React.createElement('div',{className:'pr-impact-card'},
                                    React.createElement('div',{className:'pr-impact-card-title'},iconLabel('beaker','Test Impact')),
                                    React.createElement('div',{className:'pr-test-impact'},
                                        testImpact.slice(0,5).map(function(t,i) { return React.createElement('div',{key:i,className:'pr-test-file'},
                                            React.createElement('span',{className:'pr-test-icon'},React.createElement(Icon,{name:t.suggested?'spark':'security',size:'s'})),
                                            React.createElement('span',{style:{flex:1}},t.file),
                                            t.suggested && React.createElement('span',{className:'badge badge-info'},'suggested')
                                        ); })
                                    )
                                )
                            ),
                            chains.length > 0 && React.createElement('div',{className:'pr-impact-card',style:{marginTop:16}},
                                React.createElement('div',{className:'pr-impact-card-title'},iconLabel('link','Dependency Chains')),
                                React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginBottom:12}},'Files that import modified files (downstream impact)'),
                                chains.map(function(chain,i) { return React.createElement('div',{key:i,className:'pr-dependency-chain',style:{marginBottom:8}},
                                    chain.map(function(node,j) { return React.createElement(React.Fragment,{key:j},
                                        React.createElement('span',{className:'pr-chain-node'+(j===0?' changed':'')},node),
                                        j < chain.length - 1 && React.createElement('span',{className:'pr-chain-arrow'},'→')
                                    ); })
                                ); })
                            ),
                            risk.hotspots.length > 0 && React.createElement('div',{className:'pr-impact-card',style:{marginTop:16}},
                                React.createElement('div',{className:'pr-impact-card-title'},iconLabel('activity','Hotspots')),
                                React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginBottom:12}},'Files with highest blast radius'),
                                risk.hotspots.map(function(h,i) {
                                    var maxBlast = Math.max.apply(null, risk.hotspots.map(function(x){return x.blast;})) || 1;
                                    return React.createElement('div',{key:i,className:'pr-hotspot'},
                                        React.createElement('span',{style:{fontSize:10,color:'var(--t1)',minWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},h.file.split('/').pop()),
                                        React.createElement('div',{className:'pr-hotspot-bar'},
                                            React.createElement('div',{className:'pr-hotspot-fill',style:{width:(h.blast/maxBlast*100)+'%',background:'linear-gradient(90deg, var(--orange), var(--red))'}})
                                        ),
                                        React.createElement('span',{style:{fontSize:9,color:'var(--t3)',minWidth:50,textAlign:'right'}},h.blast,' files')
                                    );
                                })
                            ),
                            React.createElement('div',{className:'pr-impact-card',style:{marginTop:16}},
                                React.createElement('div',{className:'pr-impact-card-title'},iconLabel('folder','Changed Files')),
                                React.createElement('div',{className:'pr-files-list'},
                                    prData.files&&prData.files.slice(0,20).map(function(f,i){
                                        var existing=data&&data.files.find(function(df){return df.path===f.filename;});
                                        var blast=existing?calcBlast(f.filename,data.connections,data.files):null;
                                        var statusColor = f.status === 'added' ? 'var(--green)' : f.status === 'removed' ? 'var(--red)' : 'var(--blue)';
                                        return React.createElement('div',{key:i,className:'pr-file-row'},
                                            React.createElement('div',{className:'pr-file-status',style:{background:statusColor}}),
                                            React.createElement('div',{className:'pr-file-info'},
                                                React.createElement('div',{className:'pr-file-path'},f.filename.split('/').pop()),
                                                React.createElement('div',{className:'pr-file-folder'},f.filename.includes('/')?f.filename.substring(0,f.filename.lastIndexOf('/')):'root')
                                            ),
                                            React.createElement('div',{className:'pr-file-badges'},
                                                f.additions>0&&React.createElement('span',{className:'pr-mini-badge',style:{background:'rgba(34,197,94,0.2)',color:'var(--green)'}},'+',f.additions),
                                                f.deletions>0&&React.createElement('span',{className:'pr-mini-badge',style:{background:'rgba(255,95,95,0.2)',color:'var(--red)'}},'-',f.deletions),
                                                blast&&React.createElement('span',{className:'pr-mini-badge',style:{background:blast.level==='low'?'rgba(34,197,94,0.2)':blast.level==='medium'?'rgba(255,159,67,0.2)':'rgba(255,95,95,0.2)',color:blast.level==='low'?'var(--green)':blast.level==='medium'?'var(--orange)':'var(--red)'}},React.createElement(Icon,{name:'impact',size:'s'}),' ',blast.count)
                                            )
                                        );
                                    }),
                                    prData.files&&prData.files.length>20&&React.createElement('div',{style:{textAlign:'center',padding:8,fontSize:10,color:'var(--t3)'}},'+',prData.files.length-20,' more files')
                                )
                            )
                        );
                    })()
                )
            )
        ),
        isMobile&&React.createElement('div',{className:'mobile-bottom-nav'},
            React.createElement('button',{className:'top-btn'+(mobilePanel==='explorer'?' active':''),'aria-label':'Open explorer panel',onClick:function(){toggleMobilePanel('explorer');},type:'button'},
                React.createElement(Icon,{name:'folder',size:'m'}),
                'Explorer'
            ),
            React.createElement('button',{className:'top-btn'+(!mobilePanel?' active':''),'aria-label':'Show canvas',onClick:function(){setMobilePanel(null);},type:'button'},
                React.createElement(Icon,{name:'graph',size:'m'}),
                'Canvas'
            ),
            React.createElement('button',{className:'top-btn'+(mobilePanel==='details'?' active':''),'aria-label':'Open insights panel',onClick:function(){toggleMobilePanel('details');},disabled:!data,type:'button'},
                React.createElement(Icon,{name:selected?'file':'layout',size:'m'}),
                selected?'Inspector':'Insights'
            )
        ),
        drillDown&&React.createElement('div',{className:'modal-overlay',onClick:function(){setDrillDown(null);}},
            React.createElement('div',{className:'modal',onClick:function(e){e.stopPropagation();},style:{maxWidth:600,maxHeight:'85vh',display:'flex',flexDirection:'column'}},
                React.createElement('div',{className:'modal-header'},
                    React.createElement('div',{className:'modal-title'},
                        drillDown.type==='issue'?React.createElement(React.Fragment,null,React.createElement(StatusDot,{color:drillDown.data.type==='critical'?'var(--red)':'var(--orange)'}),' ',drillDown.data.title):
                        drillDown.type==='pattern'?iconLabel(drillDown.data.icon,drillDown.data.name,'m'):
                        drillDown.type==='security'?React.createElement(React.Fragment,null,React.createElement(StatusDot,{color:getSeverityColor(drillDown.data.severity)}),' ',drillDown.data.title):
                        drillDown.type==='duplicate'?iconLabel(drillDown.data.type==='code'?'copy':'note',(drillDown.data.type==='code'?'Similar Code':'Duplicate Name')+': '+drillDown.data.name,'m'):
                        'Details'
                    ),
                    React.createElement('button',{className:'modal-close',onClick:function(){setDrillDown(null);}},'×')
                ),
                React.createElement('div',{className:'modal-body',style:{overflowY:'auto',flex:1}},
                    // Issue drill-down
                    drillDown.type==='issue'&&React.createElement(React.Fragment,null,
                        React.createElement('div',{style:{background:'var(--bg0)',padding:12,borderRadius:8,marginBottom:16}},
                            React.createElement('div',{style:{fontSize:11,color:'var(--t2)'}},drillDown.data.desc)
                        ),
                        React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},'All Affected Items (',drillDown.data.items?drillDown.data.items.length:0,')'),
                        drillDown.data.items&&drillDown.data.items.map(function(item,j){return React.createElement('div',{key:j,style:getAccentBlockStyle('rgba(0,255,157,0.28)','rgba(0,255,157,0.08)',{padding:12,marginBottom:8})},
                            React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
                                React.createElement('div',{style:{fontWeight:600,fontSize:11}},item.name),
                                item.file&&React.createElement('div',{style:{display:'flex',gap:6}},
                                    React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(item.file,item.line);}},iconLabel('eye','View')),
                                    React.createElement('button',{style:{fontSize:9,padding:'4px 8px',background:'var(--acc)',color:'var(--bg0)',border:'none',borderRadius:4,cursor:'pointer'},onClick:function(e){e.stopPropagation();goToFile(item.file);setDrillDown(null);}},'Go to file →')
                                )
                            ),
                            item.file&&React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:4,fontFamily:'monospace'}},item.file,item.line?' : '+item.line:''),
                            (item.lines||item.fns||item.imports||item.score)&&React.createElement('div',{style:{display:'flex',gap:12,marginTop:8}},
                                item.lines&&React.createElement('span',{style:{fontSize:9,color:'var(--purple)'}},item.lines,' lines'),
                                item.fns&&React.createElement('span',{style:{fontSize:9,color:'var(--orange)'}},item.fns,' functions'),
                                item.imports&&React.createElement('span',{style:{fontSize:9,color:'var(--blue)'}},item.imports,' imports'),
                                item.score&&React.createElement('span',{style:{fontSize:9,color:'var(--red)'}},'Complexity: ',item.score)
                            ),
                            item.code&&React.createElement('pre',{style:{fontSize:9,background:'var(--bg2)',padding:8,borderRadius:4,marginTop:8,overflow:'auto',maxHeight:100,fontFamily:'monospace'}},item.code),
                            item.suggestion&&React.createElement('div',{style:{fontSize:10,color:'var(--acc)',marginTop:8,padding:'6px 8px',background:'var(--bg2)',borderRadius:4}},React.createElement(Icon,{name:'spark',size:'s'}),' ',item.suggestion),
                            // For items with nested files (like duplicates)
                            item.files&&React.createElement('div',{style:{marginTop:8}},
                                React.createElement('div',{style:{fontSize:9,color:'var(--t3)',marginBottom:4}},'Locations:'),
                                item.files.map(function(f,k){return React.createElement('div',{key:k,style:{fontSize:9,color:'var(--t2)',padding:'4px 8px',background:'var(--bg2)',borderRadius:4,marginBottom:4,display:'flex',justifyContent:'space-between',alignItems:'center'}},
                                    React.createElement('span',{style:{fontFamily:'monospace',cursor:'pointer',flex:1},onClick:function(){goToFile(f.file||f);setDrillDown(null);}},typeof f==='string'?f.split('/').pop():(f.file||'').split('/').pop(),f.line?' :'+f.line:''),
                                    React.createElement('div',{style:{display:'flex',gap:4}},
                                        React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(f.file||f,f.line);}},React.createElement(Icon,{name:'eye',size:'s'})),
                                        React.createElement('span',{style:{color:'var(--acc)',cursor:'pointer'},onClick:function(){goToFile(f.file||f);setDrillDown(null);}},'→')
                                    )
                                );})
                            )
                        );})
                    ),
                    // Pattern drill-down
                    drillDown.type==='pattern'&&React.createElement(React.Fragment,null,
                        React.createElement('div',{style:{background:'var(--bg0)',padding:12,borderRadius:8,marginBottom:16}},
                            React.createElement('div',{style:{fontSize:11,color:'var(--t2)'}},drillDown.data.desc),
                            drillDown.data.isAnti&&React.createElement('div',{style:{marginTop:8}},React.createElement('span',{className:'badge badge-danger'},'Anti-pattern'))
                        ),
                        drillDown.data.metrics&&React.createElement('div',{style:{display:'flex',gap:12,marginBottom:16}},
                            Object.entries(drillDown.data.metrics).map(function(e){return React.createElement('div',{key:e[0],style:{background:'var(--bg0)',padding:12,borderRadius:8,textAlign:'center',flex:1}},
                                React.createElement('div',{style:{fontSize:20,fontWeight:600,color:'var(--acc)'}},e[1]),
                                React.createElement('div',{style:{fontSize:9,color:'var(--t3)',textTransform:'capitalize'}},e[0])
                            );})
                        ),
                        React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},'All Files (',drillDown.data.files.length,')'),
                        drillDown.data.files.map(function(f,j){return React.createElement('div',{key:j,style:getAccentBlockStyle('rgba(0,255,157,0.28)','rgba(0,255,157,0.08)',{padding:12,marginBottom:8})},
                            React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
                                React.createElement('div',{style:{fontWeight:600,fontSize:11,cursor:'pointer'},onClick:function(){goToFile(f.path);setDrillDown(null);}},f.name),
                                React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(f.path);}},iconLabel('eye','View'))
                            ),
                            React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:4,fontFamily:'monospace',cursor:'pointer'},onClick:function(){goToFile(f.path);setDrillDown(null);}},f.path),
                            f.fns&&React.createElement('div',{style:{fontSize:10,color:'var(--orange)',marginTop:4}},f.fns,' functions'),
                            f.lines&&React.createElement('div',{style:{fontSize:10,color:'var(--purple)',marginTop:4}},f.lines,' lines')
                        );})
                    ),
                    // Security drill-down
                    drillDown.type==='security'&&React.createElement(React.Fragment,null,
                        React.createElement('div',{style:drillDown.data.severity==='high'
                            ? getAccentBlockStyle('rgba(255,95,95,0.36)','rgba(255,95,95,0.1)',{padding:12,marginBottom:16})
                            : drillDown.data.severity==='medium'
                                ? getAccentBlockStyle('rgba(255,159,67,0.34)','rgba(255,180,100,0.1)',{padding:12,marginBottom:16})
                                : drillDown.data.severity==='info'
                                    ? getAccentBlockStyle('rgba(92,92,102,0.34)','rgba(92,92,102,0.1)',{padding:12,marginBottom:16})
                                    : getAccentBlockStyle('rgba(77,159,255,0.34)','rgba(100,180,255,0.1)',{padding:12,marginBottom:16})},
                            React.createElement('div',{style:{fontSize:11,fontWeight:600,marginBottom:4}},drillDown.data.severity.toUpperCase()+' Severity'),
                            React.createElement('div',{style:{fontSize:11,color:'var(--t2)'}},drillDown.data.desc)
                        ),
                        React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},'Location'),
                        React.createElement('div',{style:{background:'var(--bg0)',padding:12,borderRadius:8,marginBottom:16}},
                            React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
                                React.createElement('div',{style:{fontWeight:600,fontSize:11,cursor:'pointer'},onClick:function(){goToFile(drillDown.data.path);setDrillDown(null);}},drillDown.data.file),
                                React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(drillDown.data.path,drillDown.data.line);}},iconLabel('eye','View'))
                            ),
                            React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:4,fontFamily:'monospace',cursor:'pointer'},onClick:function(){goToFile(drillDown.data.path);setDrillDown(null);}},drillDown.data.path),
                            drillDown.data.line&&React.createElement('div',{style:{fontSize:10,color:'var(--orange)',marginTop:4}},'Line ',drillDown.data.line)
                        ),
                        drillDown.data.code&&React.createElement(React.Fragment,null,
                            React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},'Code'),
                            React.createElement('pre',{style:{background:'var(--bg0)',padding:12,borderRadius:8,fontSize:10,fontFamily:'monospace',overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-all'}},drillDown.data.code)
                        ),
                        React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12,marginTop:16}},'How to Fix'),
                        React.createElement('div',{style:{background:'var(--bg0)',padding:12,borderRadius:8,fontSize:10}},
                            drillDown.data.title==='Hardcoded Secret'?'Move credentials to environment variables (process.env) or a secrets manager like AWS Secrets Manager, HashiCorp Vault, or .env files (not committed to git).':
                            drillDown.data.title==='SQL Injection Risk'?'Use parameterized queries or prepared statements. Never concatenate user input directly into SQL strings.':
                            drillDown.data.title==='XSS Vulnerability'?'Sanitize user input before rendering. Use textContent instead of innerHTML, or use a sanitization library like DOMPurify.':
                            drillDown.data.title==='Dynamic Code Execution'?'Avoid eval() entirely. Use JSON.parse() for JSON, or Function constructor only with trusted input.':
                            'Review the flagged code and apply security best practices.'
                        )
                    ),
                    // Duplicate drill-down
                    drillDown.type==='duplicate'&&React.createElement(React.Fragment,null,
                        React.createElement('div',{style:{background:'var(--bg0)',padding:12,borderRadius:8,marginBottom:16}},
                            React.createElement('div',{style:{fontSize:11,color:'var(--t2)'}},drillDown.data.suggestion)
                        ),
                        React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12}},'All Locations (',drillDown.data.files.length,')'),
                        drillDown.data.files.map(function(f,j){return React.createElement('div',{key:j,style:drillDown.data.type==='code'
                            ? getAccentBlockStyle('rgba(167,139,250,0.34)','rgba(167,139,250,0.08)',{padding:12,marginBottom:8})
                            : getAccentBlockStyle('rgba(255,159,67,0.34)','rgba(255,159,67,0.08)',{padding:12,marginBottom:8})},
                            React.createElement('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center'}},
                                React.createElement('div',{style:{fontWeight:600,fontSize:11,cursor:'pointer'},onClick:function(){goToFile(f.file);setDrillDown(null);}},f.name||drillDown.data.name),
                                React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(f.file,f.line);}},iconLabel('eye','View'))
                            ),
                            React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:4,fontFamily:'monospace',cursor:'pointer'},onClick:function(){goToFile(f.file);setDrillDown(null);}},f.file),
                            f.line&&React.createElement('div',{style:{fontSize:10,color:'var(--orange)',marginTop:4}},'Line ',f.line)
                        );}),
                        React.createElement('div',{style:{fontSize:12,fontWeight:600,marginBottom:12,marginTop:16}},'Suggested Action'),
                        React.createElement('div',{style:{background:'var(--bg0)',padding:12,borderRadius:8,fontSize:10}},
                            drillDown.data.type==='code'?'Extract the similar code into a shared utility function. This reduces maintenance burden and ensures consistent behavior.':
                            'Consider renaming these functions to be more specific, or consolidate them into a single shared function if they serve the same purpose.'
                        )
                    )
                )
            )
        ),
        showPrivacy&&React.createElement('div',{className:'modal-overlay',onClick:function(){setShowPrivacy(false);}},
            React.createElement('div',{className:'modal privacy-modal',onClick:function(e){e.stopPropagation();}},
                React.createElement('div',{className:'modal-header'},React.createElement('div',{className:'modal-title'},iconLabel('lock','Privacy & Security','m')),React.createElement('button',{className:'modal-close',onClick:function(){setShowPrivacy(false);}},'×')),
                React.createElement('div',{className:'modal-body'},
                    React.createElement('div',{className:'privacy-item'},
                        React.createElement('div',{className:'privacy-icon'},React.createElement(Icon,{name:'globe',size:'l'})),
                        React.createElement('div',null,React.createElement('div',{className:'privacy-title'},'100% Browser-Based'),React.createElement('div',{className:'privacy-text'},'CodeFlow runs entirely in your browser. No backend servers, no data collection.'))
                    ),
                    React.createElement('div',{className:'privacy-item'},
                        React.createElement('div',{className:'privacy-icon'},React.createElement(Icon,{name:'key',size:'l'})),
                        React.createElement('div',null,React.createElement('div',{className:'privacy-title'},'Your Token Stays Local'),React.createElement('div',{className:'privacy-text'},'Your GitHub token is stored only in your browser\'s memory. It\'s never saved, logged, or transmitted anywhere except directly to GitHub\'s API.'))
                    ),
                    React.createElement('div',{className:'privacy-item'},
                        React.createElement('div',{className:'privacy-icon'},React.createElement(Icon,{name:'share',size:'l'})),
                        React.createElement('div',null,React.createElement('div',{className:'privacy-title'},'Direct API Calls'),React.createElement('div',{className:'privacy-text'},'All GitHub API calls go directly from your browser to api.github.com. We have no proxy, no middleware, no way to intercept your data.'))
                    ),
                    React.createElement('div',{className:'privacy-item'},
                        React.createElement('div',{className:'privacy-icon'},React.createElement(Icon,{name:'ban',size:'l'})),
                        React.createElement('div',null,React.createElement('div',{className:'privacy-title'},'Local Workspace'),React.createElement('div',{className:'privacy-text'},'Investigation settings and recent analysis are saved in this browser. Source analysis runs locally; GitHub imports contact GitHub.'))
                    ),
                    React.createElement('div',{style:{marginTop:16,padding:12,background:'var(--accbg)',borderRadius:8,fontSize:10,color:'var(--t1)'}},
                        React.createElement(Icon,{name:'spark',size:'s'}),
                        ' Tip: Create a ',
                        React.createElement('a',{href:'https://github.com/settings/tokens',target:'_blank',rel:'noopener',style:{color:'var(--acc)'}},'Personal Access Token'),
                        ' with only "public_repo" scope for extra peace of mind when analyzing public repositories.'
                    )
                ),
                React.createElement('div',{className:'modal-footer'},
                    React.createElement('button',{className:'top-btn primary',onClick:function(){setShowPrivacy(false);}},'Got it!')
                )
            )
        ),
        showKeyModal&&React.createElement('div',{className:'modal-overlay',onClick:function(){setShowKeyModal(false);}},
            React.createElement('div',{className:'modal key-modal',onClick:function(e){e.stopPropagation();}},
                React.createElement('div',{className:'modal-header'},React.createElement('div',{className:'modal-title'},iconLabel('key','GitHub App Private Key','m')),React.createElement('button',{className:'modal-close',onClick:function(){setShowKeyModal(false);}},'×')),
                React.createElement('div',{className:'modal-body'},
                    React.createElement('div',{className:'key-info'},
                        'Paste the private key from your GitHub App. This key is stored only in memory and never leaves your browser.',
                        React.createElement('br'),React.createElement('br'),
                        'To get a private key:',React.createElement('br'),
                        '1. Go to GitHub → Settings → Developer settings → GitHub Apps',React.createElement('br'),
                        '2. Select your app → Generate a private key',React.createElement('br'),
                        '3. Open the downloaded ',React.createElement('code',null,'.pem'),' file and paste its contents below'
                    ),
                    React.createElement('div',{className:'form-group'},
                        React.createElement('label',{className:'form-label'},'Private Key (PEM format)'),
                        React.createElement('textarea',{className:'form-input',placeholder:'-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----',value:privateKey,onChange:function(e){setPrivateKey(e.target.value);},rows:10})
                    )
                ),
                React.createElement('div',{className:'modal-footer'},
                    privateKey&&React.createElement('button',{className:'top-btn',onClick:function(){setPrivateKey('');},style:{marginRight:'auto'}},'Clear Key'),
                    React.createElement('button',{className:'top-btn',onClick:function(){setShowKeyModal(false);}},'Cancel'),
                    React.createElement('button',{className:'top-btn primary',onClick:function(){setShowKeyModal(false);}},'Save')
                )
            )
        ),
        showUnused&&data&&data.deadFunctions&&React.createElement('div',{className:'modal-overlay',onClick:function(){setShowUnused(false);}},
            React.createElement('div',{className:'modal',style:{maxWidth:650,maxHeight:'85vh'},onClick:function(e){e.stopPropagation();}},
                React.createElement('div',{className:'modal-header'},React.createElement('div',{className:'modal-title'},iconLabel('warning','Functions Without Observed Callers','m')),React.createElement('button',{className:'modal-close',onClick:function(){setShowUnused(false);}},'×')),
                React.createElement('div',{className:'modal-body',style:{maxHeight:'70vh',overflowY:'auto'}},
                    React.createElement('div',{className:'unused-summary'},
                        React.createElement('div',{className:'unused-summary-item'},
                            React.createElement('div',{className:'unused-summary-value'},data.deadFunctions.length),
                            React.createElement('div',{className:'unused-summary-label'},'Candidates')
                        ),
                        React.createElement('div',{className:'unused-summary-item'},
                            React.createElement('div',{className:'unused-summary-value'},data.deadFunctions.reduce(function(s,f){return s+f.codeLines;},0)),
                            React.createElement('div',{className:'unused-summary-label'},'Candidate Lines')
                        ),
                        React.createElement('div',{className:'unused-summary-item'},
                            React.createElement('div',{className:'unused-summary-value'},[...new Set(data.deadFunctions.map(function(f){return f.file;}))].length),
                            React.createElement('div',{className:'unused-summary-label'},'Files Affected')
                        )
                    ),
                    React.createElement('div',{style:Object.assign(getAccentBlockStyle('rgba(255,159,67,0.34)','rgba(255,159,67,0.08)'),{fontSize:10,color:'var(--t3)',marginBottom:12,padding:'8px 12px',borderRadius:6})},'Source analysis found no callers for these functions. Callbacks, macros and dynamic invocation can remain undetected; verify usage before removing code.'),
                    data.deadFunctions.map(function(fn,i){
                        var isExpanded=expandedFns.has('dead-'+fn.name);
                        return React.createElement('div',{key:i,className:'unused-fn'},
                            React.createElement('div',{className:'unused-fn-header',onClick:function(){toggleFn('dead-'+fn.name);}},
                                React.createElement('div',null,
                                    React.createElement('span',{className:'unused-fn-name'},fn.name,fn.evidence==='mix xref'?'':'()'),
                                    React.createElement('div',{className:'unused-fn-path'},
                                        React.createElement('span',null,React.createElement(Icon,{name:'folder',size:'s'}),' ',fn.folder||'root'),
                                        React.createElement('span',null,'→'),
                                        React.createElement('span',{className:'unused-fn-file',onClick:function(e){e.stopPropagation();goToFile(fn.file);setShowUnused(false);}},fn.file.split('/').pop())
                                    )
                                ),
                                React.createElement('div',{className:'unused-fn-meta'},
                                    React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(fn.file,fn.line);},title:'View source'},React.createElement(Icon,{name:'eye',size:'s'})),
                                    React.createElement('span',{className:'unused-fn-lines'},fn.codeLines,' lines'),
                                    fn.line&&React.createElement('span',{className:'unused-fn-loc'},'L',fn.line),
                                    React.createElement('span',{style:{fontSize:10,color:'var(--t3)'}},isExpanded?'▼':'▶')
                                )
                            ),
                            isExpanded&&fn.code&&React.createElement('div',{className:'unused-fn-preview'},
                                React.createElement('div',{className:'unused-fn-code'},fn.code)
                            )
                        );
                    })
                ),
                React.createElement('div',{className:'modal-footer',style:{display:'flex',gap:8}},
                    React.createElement('button',{className:'top-btn',onClick:function(){data.deadFunctions.forEach(function(fn){expandedFns.add('dead-'+fn.name);});setExpandedFns(new Set(expandedFns));}},'Expand All'),
                    React.createElement('button',{className:'top-btn',onClick:function(){setExpandedFns(new Set());}},'Collapse All'),
                    React.createElement('button',{className:'top-btn primary',onClick:function(){setShowUnused(false);}},'Close')
                )
            )
        ),
        confirmDialog&&(function(){
            var tone=getDialogTone(confirmDialog.tone);
            return React.createElement('div',{className:'modal-overlay',style:{zIndex:1200},onClick:function(){closeConfirmDialog(false);}},
                React.createElement('div',{className:'modal confirm-modal',onClick:function(e){e.stopPropagation();}},
                    React.createElement('div',{className:'modal-body'},
                        React.createElement('div',{className:'confirm-content'},
                            React.createElement('div',{className:'confirm-icon',style:{color:tone.color,background:tone.background,border:'1px solid '+tone.borderColor}},
                                React.createElement(Icon,{name:confirmDialog.icon||'warning',size:'l'})
                            ),
                            React.createElement('div',{className:'confirm-copy'},
                                React.createElement('div',{className:'confirm-title'},confirmDialog.title),
                                React.createElement('div',{className:'confirm-message'},confirmDialog.message)
                            )
                        )
                    ),
                    React.createElement('div',{className:'modal-footer'},
                        React.createElement('button',{className:'top-btn',onClick:function(){closeConfirmDialog(false);}},confirmDialog.cancelLabel||'Cancel'),
                        React.createElement('button',{className:'top-btn primary',style:{background:tone.color,borderColor:tone.color,color:'var(--bg0)'},onClick:function(){closeConfirmDialog(true);}},confirmDialog.confirmLabel||'Continue')
                    )
                )
            );
        })(),
        toast&&React.createElement('div',{className:'toast '+(toast.type||'success'),'role':'alert'},toast.msg),
        filePreview&&React.createElement('div',{className:'file-preview-overlay',onClick:function(){setFilePreview(null);}},
            React.createElement('div',{className:'file-preview-modal',onClick:function(e){e.stopPropagation();}},
                React.createElement('div',{className:'file-preview-header'},
                    React.createElement('div',{className:'file-preview-title'},
                        React.createElement('span',{className:'file-preview-icon'},React.createElement(Icon,{name:getFilePreviewIconName(filePreview.filename),size:'l'})),
                        React.createElement('span',{className:'file-preview-name'},filePreview.filename),
                        React.createElement('span',{className:'file-preview-path'},filePreview.path)
                    ),
                    React.createElement('div',{className:'file-preview-actions'},
                        filePreview.line&&React.createElement('span',{className:'file-preview-line-badge'},'Line ',filePreview.line),
                        React.createElement('button',{className:'file-preview-close',onClick:function(){setFilePreview(null);}},'×')
                    )
                ),
                React.createElement('div',{className:'file-preview-content',ref:filePreviewRef},
                    filePreview.loading?React.createElement('div',{className:'file-preview-loading'},
                        React.createElement('div',{className:'spinner'}),
                        React.createElement('div',{className:'file-preview-loading-text'},'Loading file...')
                    ):filePreview.error?React.createElement('div',{className:'file-preview-error'},
                        React.createElement(Icon,{name:'warning',size:'xxl',className:'file-preview-error-icon'}),
                        React.createElement('div',null,filePreview.error)
                    ):filePreview.content?React.createElement('pre',{className:'file-preview-code'},
                        asCodeLines(highlightSyntax(filePreview.content,filePreview.filename)).map(function(lineHtml,i){
                            var lineNum=i+1;
                            var isHighlighted=filePreview.line&&lineNum===filePreview.line;
                            return React.createElement('div',{key:i,className:'file-preview-line'+(isHighlighted?' highlighted':'')},
                                React.createElement('span',{className:'file-preview-linenum'},lineNum),
                                React.createElement('span',{className:'file-preview-text',dangerouslySetInnerHTML:{__html:lineHtml||' '}})
                            );
                        })
                    ):null
                )
            )
        ),
        error&&React.createElement('div',{style:{position:'fixed',bottom:20,right:20,background:'var(--red)',color:'white',padding:'12px 20px',borderRadius:8,zIndex:1000,maxWidth:350},'role':'alert'},[error,React.createElement('button',{'aria-label':'Dismiss error','onClick':function(){setError(null);},style:{marginLeft:12,background:'none',border:'none',color:'white',cursor:'pointer',fontSize:16}},'×')])
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ErrorBoundary,null,React.createElement(App)));
