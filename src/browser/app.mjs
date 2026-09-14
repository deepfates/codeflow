import {createSourceNavigationHook} from './source-navigation.mjs';
import {createProjectHook,parseUrl,buildAppUrl} from './project.mjs';
import {createAlternateViews} from '../views/alternate.mjs';
import {indexSourceFindings} from '../project/source-findings.mjs';
import {sourceFindingColor,FINDING_COLORS} from '../views/graph-style.mjs';
import {createNativeCanvas} from '../views/native-canvas.mjs';
import {indexRuntime} from '../project/runtime-index.mjs';
import {createInspectionPanels} from '../views/inspection.mjs';
import {createRuntimeInspectionHook} from './runtime-inspection.mjs';
import {createGraph3DView} from '../views/graph3d.mjs';
import {createArchitectureView} from '../views/architecture.mjs';

import {exportAnalysis} from '../project/export.mjs';
import {generateAnalysisReport} from '../project/reports.mjs';
import {highlightSyntax} from '../views/highlight.mjs';
import {createInvestigationState,reduceInvestigation} from '../investigation/state.mjs';
import {LINE_THICKNESS_MIN,LINE_THICKNESS_MAX,readUiPrefs,persistUiPrefs} from '../investigation/preferences.mjs';
import {githubZipDownloadUrl,analysisCacheKey} from '../project/identity.mjs';
import {asCodeLines,fileHasLoadedSource} from '../project/source.mjs';

import {formatRecentTime,armRecentDelete} from '../investigation/recent-analyses.mjs';
import {searchProject,folderFilterAfterCodeNav,filesForOpenedCodePaths} from '../investigation/navigation.mjs';
import {restoreWorkspace} from '../investigation/workspace.mjs';
import {codeFileNavOpensCard,graphSvgExportEnabled,vizUsesLineThickness,vizHasGraphToolbar} from '../views/capabilities.mjs';

import {snapshotZoomTransform} from '../views/camera.mjs';

import {groupArchitectureRelationships,findBlockById,getVisibleArchitectureBlocks,computeArchitectureStats,groupBlocksByArchitectureGroup,generateMermaidBlockDiagram} from '../analysis/architecture.mjs';

import {calcBlast,calcHealth} from '../analysis/metrics.mjs';
import {DEFAULT_EXCLUDE_CHIPS,parseExcludePatterns,compileExcludePatterns} from '../project/exclusions.mjs';
import {countFiles} from '../project/tree.mjs';

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
const useProject=createProjectHook({React,runAnalysisData,GitHub,JSZip:globalThis.JSZip});

const{useState,useReducer,useEffect,useLayoutEffect,useRef,useMemo,useCallback}=React;
const {SourceNavigation,AnalysisTools,SourceProcesses,SourceFindings,RuntimePanel}=createInspectionPanels(React);
const useRuntimeInspection=createRuntimeInspectionHook(React);
const useSourceNavigation=createSourceNavigationHook(React);
const ArchitectureView=createArchitectureView({React,mermaid:globalThis.mermaid});
const COLORS=['#4d9fff','#a78bfa','#22d3ee','#00ff9d','#ff9f43','#ec4899','#ff5f5f','#84cc16'];
const LAYER_COLORS={ui:'#4d9fff',components:'#22d3ee',services:'#a78bfa',utils:'#00ff9d',data:'#ff9f43',config:'#ec4899',test:'#f59e0b',modules:'#a78bfa',forms:'#22d3ee',classes:'#ff9f43',note:'#c084fc'};
const NativeCanvas=createNativeCanvas({React,d3:globalThis.d3,Icon,COLORS,LAYER_COLORS});
const {TreemapView,MatrixView,DendrogramView,SankeyView,DisjointView,BundleView}=createAlternateViews({React,d3:globalThis.d3,colors:COLORS});
const Graph3DView=createGraph3DView({React,getRuntime:()=>({ForceGraph3D:globalThis.ForceGraph3D,THREE:globalThis.THREE}),colors:COLORS,layerColors:LAYER_COLORS});

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

    var _a=useState(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'),theme=_a[0],setTheme=_a[1];
    var _b=useState(''),repoUrl=_b[0],setRepoUrl=_b[1];
    var _c=useState(''),token=_c[0],setToken=_c[1];
    var _authMethod=useState('none'),authMethod=_authMethod[0],setAuthMethod=_authMethod[1];// 'none', 'pat', 'github_app'
    var _appId=useState(''),appId=_appId[0],setAppId=_appId[1];
    var _privateKey=useState(''),privateKey=_privateKey[0],setPrivateKey=_privateKey[1];
    var _showKeyModal=useState(false),showKeyModal=_showKeyModal[0],setShowKeyModal=_showKeyModal[1];
    var _ai=useState(''),excludePatternInput=_ai[0],setExcludePatternInput=_ai[1];
    var activeExcludePatterns=useMemo(function(){return compileExcludePatterns(excludePatternInput);},[excludePatternInput]);
    const project=useProject({repoUrl,auth:{authMethod,token,appId,privateKey},excludePatterns:activeExcludePatterns,confirm:requestConfirm,notify:showNotification,onReset:resetProjectPresentation,onRepositoryURL:setRepoUrl});
    const {data,repoInfo,localSourceKind,loading,progress,recentAnalyses,cachedFromId,cliStatus,cliDirty,cliLiveByPath,beamAnalysis,localTools,codeSourceFailed}=project;
    const [pickerError,setPickerError]=useState(null);
    const error=pickerError||project.error;
    const analyze=()=>{setPickerError(null);return project.openGitHub(repoUrl);};
    const refreshAnalysis=project.refresh,reanalyzeRecent=project.refreshRecent,removeRecentAnalysis=project.removeRecent;
    function loadRecentAnalysis(id){clearPendingRecentDelete();return project.openRecent(id);}
    function currentAnalysisSource(){return project.source;}
    function readLiveFileSource(path){return project.readSource(path);}
    function resetProjectPresentation({cached=false}={}){setPickerError(null);setSelected(null);setBlastRadius(null);setOwnership(null);setFolderFilter(null);setPrData(null);closeFilePreview();setMobilePanel(null);setShowGraphConfig(false);setActiveSymbol(null);setExpandedPaths(new Set(['']));if(cached)setGraphConfig(cfg=>({...cfg,vizType:cfg.vizType==='architecture'?'graph':cfg.vizType}));}

    const [investigation,dispatchInvestigation]=useReducer((state,action)=>reduceInvestigation(state,action,data),undefined,createInvestigationState);
    const selected=useMemo(()=>data&&data.files.find(file=>file.path===investigation.selectedPath)||null,[data,investigation.selectedPath]);
    const folderFilter=investigation.scope,openedCodePaths=investigation.openedPaths,navigation=investigation.navigation;
    function setSelected(file){dispatchInvestigation({type:'select',path:file?file.path:null,record:false});}
    function setFolderFilter(scope){dispatchInvestigation({type:'scope',scope:typeof scope==='function'?scope(folderFilter):scope});}

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

    // null | 'folder' | 'zip'
    var _ah=useState(false),showExcludeModal=_ah[0],setShowExcludeModal=_ah[1];

    var _aj=useState(''),excludePatternDraft=_aj[0],setExcludePatternDraft=_aj[1];
    var _al=useState(null),confirmDialog=_al[0],setConfirmDialog=_al[1];
    var _am=useState(window.innerWidth),viewportWidth=_am[0],setViewportWidth=_am[1];
    var _an=useState(null),mobilePanel=_an[0],setMobilePanel=_an[1];
    var _ao=useState(48),topbarHeight=_ao[0],setTopbarHeight=_ao[1];
    var _archTests=useState(false),architectureIncludeTests=_archTests[0],setArchitectureIncludeTests=_archTests[1];
    var _archBuild=useState(false),architectureIncludeBuildOutput=_archBuild[0],setArchitectureIncludeBuildOutput=_archBuild[1];
    var [selectedArchitectureBlock,setSelectedArchitectureBlock]=useState(null);

    var _activeSym=useState(null),activeSymbol=_activeSym[0],setActiveSymbol=_activeSym[1];
    var _pendingDel=useState(null),pendingRecentDelete=_pendingDel[0],setPendingRecentDelete=_pendingDel[1];

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

    const sourceNavigation=useSourceNavigation({connection:localTools,selection:investigation,loading,language:beamAnalysis?.language,onOpen:openSourceLocation});
    const {symbols:beamSymbols,locations:beamLocations,error:beamNavigationError}=sourceNavigation;
    function openSourceLocation(location){
        if(!location.range&&Number.isInteger(location.line)&&location.line>0){const position={line:location.line-1,character:0};location={...location,range:{start:position,end:position}};}
        if(!location.path){sourceNavigation.unavailable('Source is outside this project.');return;}
        if(!data.files.some(function(file){return file.path===location.path;})){sourceNavigation.unavailable('Source is excluded or unavailable in this project.');return;}
        setGraphConfig(function(prev){return Object.assign({},prev,{vizType:'code'});});
        nativeCanvasRef.current?.prepareSource(location);
        openCodeFile(location.path,false,location.range);setRightTab('details');

    }

    function openAssessmentSource(item){
        const location=item.sourceLocation||{path:typeof item==='string'?item:item.path||item.file,line:item.line,range:item.range};
        if(location.range||(Number.isInteger(location.line)&&location.line>0))openSourceLocation(location);
        else goToFile(location.path);
        setDrillDown(null);
    }

    function navigateBeamSymbol(method,path,position){return sourceNavigation.navigate(method,path,position);}
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

    var isMobile=viewportWidth<=980;

    var graph3dViewRef=useRef(null);
    var alternateViewRef=useRef(null);
    var topbarRef=useRef(null);
    var filePreviewRef=useRef(null);
    const previewRequestRef=useRef(null);
    useEffect(()=>()=>{previewRequestRef.current=null;},[]);
    var architectureViewRef=useRef(null);

    var openedSceneRef=useRef('');
    var workspaceKeyRef=useRef(null),workspaceRestoreRef=useRef(null);

    var analysisHydrationIdRef=useRef('');

    var _codeExpand=useState(false),codeViewExpand=_codeExpand[0],setCodeViewExpand=_codeExpand[1];
    var _codeWrap=useState(true),codeViewWrap=_codeWrap[0],setCodeViewWrap=_codeWrap[1];
    var _lineThick=useState(readUiPrefs().lineThickness),lineThickness=_lineThick[0],setLineThickness=_lineThick[1];
    var pendingRecentDeleteTimerRef=useRef(null);
    var zipInputRef=useRef(null);

    var folderInputRef=useRef(null);

    var pendingExcludePatternsRef=useRef(null);
    var confirmResolverRef=useRef(null);

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

    },[]);

    var currentHydrationId=project.hydrationId;
    const loadedSourceIdentity=project.identity;
    // Each callback closes over this project's workspace record. An old view's
    // final event cannot write into the next project's camera snapshots.
    const workspaceCameras=useMemo(()=>({}),[loadedSourceIdentity?.sourceType,loadedSourceIdentity?.sourceKey]);
    analysisHydrationIdRef.current=currentHydrationId;
    const runtimeInspection=useRuntimeInspection(localTools,cliStatus?.runtimeNode||'');
    const runtimeIndex=useMemo(()=>indexRuntime(runtimeInspection.snapshot,data?.files||[]),[runtimeInspection.snapshot,data]);
    function clearPendingRecentDelete(){
        if(pendingRecentDeleteTimerRef.current){
            clearTimeout(pendingRecentDeleteTimerRef.current);
            pendingRecentDeleteTimerRef.current=null;
        }
        setPendingRecentDelete(null);
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
            project.openFolder(dirHandle,compiledPatterns||activeExcludePatterns);
        }).catch(function(e){
            if(e.name!=='AbortError'){
                setPickerError('Failed to open folder: '+(e.message||e));
            }
        });
    }

    function openLocalFolder(){
        launchLocalFolderPicker();
    }

    function openLocalZip(){
        if(!window.JSZip){
            setPickerError('ZIP support failed to load. Check your network connection and try again.');
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
        project.openArchive(file);
    }

    function handleFolderSelected(e){
        var fileList=e.target.files;
        if(!fileList||fileList.length===0)return;
        project.openSelectedFiles(Array.from(fileList),pendingExcludePatternsRef.current||activeExcludePatterns);
    }

    var hadAnalysisRef=useRef(false);
    var selectFile=useCallback(function(path,location){
        dispatchInvestigation({type:'select',path,...location,camera:snapshotZoomTransform(nativeCanvasRef.current?.snapshotScene().camera)});
    },[]);

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
        project.retrySource(path);
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
        if(colorMode==='findings')return colorMap[d.id]||FINDING_COLORS.none;
        if(colorMode==='churn')return colorMap[d.id]||'#22c55e';
        return COLORS[0];
    }

    var togglePath=useCallback(function(p){setExpandedPaths(function(prev){var n=new Set(prev);if(n.has(p))n.delete(p);else n.add(p);return n;});},[]);
    var toggleCard=useCallback(function(id){setExpandedCards(function(prev){var n=new Set(prev);if(n.has(id))n.delete(id);else n.add(id);return n;});},[]);
    var toggleFn=useCallback(function(name){setExpandedFns(function(prev){var n=new Set(prev);if(n.has(name))n.delete(name);else n.add(name);return n;});},[]);

    function canReadLiveFileSource(){return project.sourceAvailable;}

    function closeFilePreview(){
        previewRequestRef.current=null;
        setFilePreview(null);
    }

    // A source read belongs to the project; only its current preview request may
    // present the result. Closing or opening another preview detaches the old one.
    function openFilePreview(path,line){
        if(!repoInfo)return;
        const request={};
        previewRequestRef.current=request;
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
            if(previewRequestRef.current!==request||analysisHydrationIdRef.current!==previewId)return;
            if(typeof content==='string'){
                setFilePreview({path:path,filename:filename,content:content,line:line||null,loading:false,error:null});
                return;
            }
            setFilePreview({path:path,filename:filename,content:null,line:line||null,loading:false,error:canReadLiveFileSource()?'Could not load file content':'Reopen this project to preview source'});
        });
    }

    // Scroll to highlighted line after file preview loads
    useEffect(function(){
        if(filePreview&&filePreview.content&&filePreview.line&&filePreviewRef.current){
            const timer=setTimeout(function(){
                var el=filePreviewRef.current.querySelector('.file-preview-line.highlighted');
                if(el)el.scrollIntoView({behavior:'smooth',block:'center'});
            },100);
            return function(){clearTimeout(timer);};
        }
    },[filePreview]);

    const folderColors=useMemo(()=>{const colors={};data?.folders.forEach((folder,i)=>{colors[folder]=COLORS[i%COLORS.length];});colors.root=COLORS[0];return colors;},[data?.folders]);
    const findingsByFile=useMemo(()=>indexSourceFindings(data),[data]);
    var colorMap=useMemo(function(){
        if(!data)return{};
        var m={};
        if(colorMode==='folder')return folderColors;
        else if(colorMode==='layer')data.files.forEach(function(f){m[f.path]=LAYER_COLORS[f.layer]||COLORS[0];});
        else if(colorMode==='findings')data.files.forEach(file=>{m[file.path]=sourceFindingColor(findingsByFile.get(file.path));});
        else if(colorMode==='churn'){
            var maxC=Math.max.apply(null,data.files.map(function(f){return f.churn||0;}))||1;
            data.files.forEach(function(f){var r=(f.churn||0)/maxC;m[f.path]=r>0.7?'#ff5f5f':r>0.4?'#ff9f43':'#22c55e';});
        }
        return m;
    },[data,colorMode,folderColors]);
    const legendColorMode=graphConfig.vizType==='graph'||graphConfig.vizType==='graph3d'?colorMode:'folder';
    const legendColors=graphConfig.vizType==='graph'||graphConfig.vizType==='graph3d'?colorMap:folderColors;

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
        Object.assign(workspaceCameras,restored.viewCameras);
        setSelectedArchitectureBlock(restored.architectureBlockId);
        setRestoredNativeScene(restored);
        dispatchInvestigation({type:'restore',workspace:restored});
    },[currentHydrationId]);
    useEffect(function(){
        if(!data)return;
        function save(){
            if(!workspaceKeyRef.current||workspaceRestoreRef.current)return;
            try{localStorage.setItem(workspaceKeyRef.current,JSON.stringify({version:1,scope:folderFilter,selected:selected&&selected.path,
                opened:openedCodePaths,view:graphConfig.vizType,architectureBlockId:selectedArchitectureBlock,navigation:navigation,viewCameras:workspaceCameras,...nativeCanvasRef.current?.snapshotScene()}));}catch(e){}
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

    useEffect(()=>{project.ensureSources(openedCodePaths);},[codeViewFiles,project.codeSourceFailed,project.sourceAvailable]);

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
    async function export3DImage(){
        try{
            const blob=await graph3dViewRef.current.snapshotImage();
            const url=URL.createObjectURL(blob),link=document.createElement('a');
            link.href=url;link.download='codeflow-'+Date.now()+'.png';link.click();
            URL.revokeObjectURL(url);
        }catch(error){showNotification(error.message||'Could not export the 3D view.','error');}
    }
    function exportSVG(){
        if(!graphSvgExportEnabled(graphConfig.vizType)){
            showNotification('Switch to Graph view to export SVG. Code cards are HTML overlays.','error');
            return;
        }
        const sourceSvg=graphConfig.vizType==='graph'?nativeCanvasRef.current?.svgElement:alternateViewRef.current?.svgElement;
        if(!sourceSvg)return;
        var svgClone=sourceSvg.cloneNode(true);
        svgClone.setAttribute('xmlns','http://www.w3.org/2000/svg');
        svgClone.setAttribute('width',sourceSvg.clientWidth);
        svgClone.setAttribute('height',sourceSvg.clientHeight);
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
        var report=generateAnalysisReport({data,repository:getAnalysisSourceLabel(),analyzedAt:new Date().toISOString(),format});
        var url=URL.createObjectURL(new Blob([report.content],{type:report.mimeType}));
        var link=document.createElement('a');link.href=url;link.download=report.filename;link.click();
        URL.revokeObjectURL(url);
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
    function resetAnalysis(){project.clear();resetProjectPresentation();setRepoUrl('');setArchitectureIncludeTests(false);setArchitectureIncludeBuildOutput(false);window.history.replaceState({},'',window.location.pathname);}
    function filterByFolder(path){
        setFolderFilter(function(prev){return prev===path?null:path;});
        if(path&&path!==folderFilter)setExpandedPaths(function(prev){
            const expanded=new Set(prev);expanded.add('');
            const parts=path.split('/');
            parts.forEach((_,index)=>expanded.add(parts.slice(0,index+1).join('/')));
            return expanded;
        });
    }
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
            React.createElement('button',{type:'button',className:'color-by-btn'+(colorMode==='churn'?' active':''),onClick:function(){setColorMode('churn');}},'Churn'),
            React.createElement('button',{type:'button',className:'color-by-btn'+(colorMode==='findings'?' active':''),onClick:function(){setColorMode('findings');}},'Findings')
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
                    graphConfig.vizType==='treemap'&&React.createElement(TreemapView,{ref:alternateViewRef,key:loadedSourceIdentity?.sourceType+':'+loadedSourceIdentity?.sourceKey,restoredCamera:workspaceCameras.treemap,onCameraChange:camera=>{workspaceCameras.treemap=camera;},files:data.files,folderFilter,onSelect:path=>{if(path)selectFile(path);else{setSelected(null);setBlastRadius(null);}},colorMap:folderColors,selectedPath:selected?.path,blastRadius}),
                    graphConfig.vizType==='matrix'&&React.createElement(MatrixView,{ref:alternateViewRef,key:loadedSourceIdentity?.sourceType+':'+loadedSourceIdentity?.sourceKey,restoredCamera:workspaceCameras.matrix,onCameraChange:camera=>{workspaceCameras.matrix=camera;},files:data.files,folderFilter,onSelect:path=>{if(path)selectFile(path);else{setSelected(null);setBlastRadius(null);}},connections:data.connections}),
                    graphConfig.vizType==='dendro'&&React.createElement(DendrogramView,{ref:alternateViewRef,key:loadedSourceIdentity?.sourceType+':'+loadedSourceIdentity?.sourceKey,restoredCamera:workspaceCameras.dendro,onCameraChange:camera=>{workspaceCameras.dendro=camera;},files:data.files,folderFilter,onSelect:path=>{if(path)selectFile(path);else{setSelected(null);setBlastRadius(null);}},colorMap:folderColors,lineThickness,onScope:filterByFolder}),
                    graphConfig.vizType==='sankey'&&React.createElement(SankeyView,{ref:alternateViewRef,key:loadedSourceIdentity?.sourceType+':'+loadedSourceIdentity?.sourceKey,restoredCamera:workspaceCameras.sankey,onCameraChange:camera=>{workspaceCameras.sankey=camera;},files:data.files,folderFilter,connections:data.connections,colorMap:folderColors,lineThickness,onScope:filterByFolder}),
                    graphConfig.vizType==='disjoint'&&React.createElement(DisjointView,{ref:alternateViewRef,key:loadedSourceIdentity?.sourceType+':'+loadedSourceIdentity?.sourceKey,restoredCamera:workspaceCameras.disjoint,onCameraChange:camera=>{workspaceCameras.disjoint=camera;},files:data.files,folderFilter,onSelect:path=>{if(path)selectFile(path);else{setSelected(null);setBlastRadius(null);}},connections:data.connections,colorMap:folderColors,lineThickness}),
                    graphConfig.vizType==='bundle'&&React.createElement(BundleView,{ref:alternateViewRef,key:loadedSourceIdentity?.sourceType+':'+loadedSourceIdentity?.sourceKey,restoredCamera:workspaceCameras.bundle,onCameraChange:camera=>{workspaceCameras.bundle=camera;},files:data.files,folderFilter,onSelect:path=>{if(path)selectFile(path);else{setSelected(null);setBlastRadius(null);}},connections:data.connections,colorMap:folderColors,selectedPath:selected?.path,blastRadius,lineThickness,onScope:filterByFolder}),
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
                            React.createElement('div',{className:'legend-title',style:{margin:0}},legendColorMode==='folder'?'Folders':legendColorMode==='layer'?'Layers':legendColorMode==='findings'?'Findings':'Churn'),
                            React.createElement('span',{className:'legend-toggle'},'▼')
                        ),
                        React.createElement('div',{className:'legend-content'},
                            legendColorMode==='folder'&&data.folders.map(function(f,i){return React.createElement('div',{key:f,className:'legend-item'+(folderFilter===f?' active':''),onClick:function(e){e.stopPropagation();filterByFolder(f);}},React.createElement('div',{className:'legend-color',style:{background:legendColors[f]||COLORS[i%COLORS.length]}}),f||'root');}),
                            legendColorMode==='layer'&&Object.entries(LAYER_COLORS).map(function(e){return React.createElement('div',{key:e[0],className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:e[1]}}),e[0]=== 'modules' ? 'Modules' : e[0]=== 'forms' ? 'UserForms' : e[0]=== 'classes' ? 'Classes' : e[0]);}),
                            legendColorMode==='findings'&&[['critical','Critical / high'],['warning','Warning / medium'],['info','Low / info'],['none','No recorded findings']].map(([key,label])=>React.createElement('div',{key,className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:FINDING_COLORS[key]}}),label)),
                            legendColorMode==='churn'&&React.createElement(React.Fragment,null,React.createElement('div',{className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:'#ff5f5f'}}),'High (7+ commits)'),React.createElement('div',{className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:'#ff9f43'}}),'Medium (4-6)'),React.createElement('div',{className:'legend-item'},React.createElement('div',{className:'legend-color',style:{background:'#22c55e'}}),'Low (0-3)'))
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
                            React.createElement(SourceProcesses,{index:runtimeIndex,path:selected.path,onSelect:id=>{runtimeInspection.setFocus(id);setRightTab('runtime');}}),
                            React.createElement(SourceFindings,{summary:findingsByFile.get(selected.path),onOpen:openSourceLocation}),
                            data.beam&&React.createElement(SourceNavigation,{path:selected.path,symbols:beamSymbols,locations:beamLocations,error:beamNavigationError,onOpen:openSourceLocation,onReferences:(path,position)=>navigateBeamSymbol('references',path,position)}),
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
                                                    st.callers.map(function(c,i){return React.createElement('div',{key:i,className:'fn-caller',onClick:function(){goToFile(c.file);}},
                                                        React.createElement(Icon,{name:'file',size:'s'}),
                                                        React.createElement('span',null,c.name),
                                                        React.createElement('span',{style:{marginLeft:'auto',color:'var(--t3)'}},c.count,'×')
                                                    );})
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
                        graphConfig.vizType==='code'&&React.createElement('div',{style:{fontSize:9,color:'var(--t2)',marginBottom:10,lineHeight:1.4}},'Code cards are HTML overlays, not SVG. Switch to Graph to export an image.'),
                        React.createElement('div',{className:'export-options'},
                            graphConfig.vizType==='graph3d'?React.createElement('div',{className:'export-option',onClick:function(){export3DImage();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'image',size:'xl'})),React.createElement('div',{className:'export-option-label'},'PNG Image')):React.createElement('div',{className:'export-option'+(graphSvgExportEnabled(graphConfig.vizType)?'':' disabled'),'aria-disabled':graphSvgExportEnabled(graphConfig.vizType)?undefined:'true',onClick:function(){if(!graphSvgExportEnabled(graphConfig.vizType))return;exportSVG();setShowExport(false);}},React.createElement('div',{className:'export-option-icon'},React.createElement(Icon,{name:'image',size:'xl'})),React.createElement('div',{className:'export-option-label'},'SVG Image')),
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
                                    React.createElement('button',{style:{fontSize:9,padding:'4px 8px',background:'var(--acc)',color:'var(--bg0)',border:'none',borderRadius:4,cursor:'pointer'},onClick:function(e){e.stopPropagation();openAssessmentSource(item);}},'Go to file →')
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
                                    React.createElement('span',{style:{fontFamily:'monospace',cursor:'pointer',flex:1},onClick:function(){openAssessmentSource(f);}},typeof f==='string'?f.split('/').pop():(f.file||'').split('/').pop(),f.line?' :'+f.line:''),
                                    React.createElement('div',{style:{display:'flex',gap:4}},
                                        React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(f.file||f,f.line);}},React.createElement(Icon,{name:'eye',size:'s'})),
                                        React.createElement('span',{style:{color:'var(--acc)',cursor:'pointer'},onClick:function(){openAssessmentSource(f);}},'→')
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
                                React.createElement('div',{style:{fontWeight:600,fontSize:11,cursor:'pointer'},onClick:function(){openAssessmentSource(drillDown.data);}},drillDown.data.file),
                                React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(drillDown.data.path,drillDown.data.line);}},iconLabel('eye','View'))
                            ),
                            React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:4,fontFamily:'monospace',cursor:'pointer'},onClick:function(){openAssessmentSource(drillDown.data);}},drillDown.data.path),
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
                                React.createElement('div',{style:{fontWeight:600,fontSize:11,cursor:'pointer'},onClick:function(){openAssessmentSource(f);}},f.name||drillDown.data.name),
                                React.createElement('button',{className:'view-file-btn',onClick:function(e){e.stopPropagation();openFilePreview(f.file,f.line);}},iconLabel('eye','View'))
                            ),
                            React.createElement('div',{style:{fontSize:10,color:'var(--t3)',marginTop:4,fontFamily:'monospace',cursor:'pointer'},onClick:function(){openAssessmentSource(f);}},f.file),
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
                                        React.createElement('span',{className:'unused-fn-file',onClick:function(e){e.stopPropagation();openAssessmentSource(fn);setShowUnused(false);}},fn.file.split('/').pop())
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
        filePreview&&React.createElement('div',{className:'file-preview-overlay',onClick:function(){closeFilePreview();}},
            React.createElement('div',{className:'file-preview-modal',onClick:function(e){e.stopPropagation();}},
                React.createElement('div',{className:'file-preview-header'},
                    React.createElement('div',{className:'file-preview-title'},
                        React.createElement('span',{className:'file-preview-icon'},React.createElement(Icon,{name:getFilePreviewIconName(filePreview.filename),size:'l'})),
                        React.createElement('span',{className:'file-preview-name'},filePreview.filename),
                        React.createElement('span',{className:'file-preview-path'},filePreview.path)
                    ),
                    React.createElement('div',{className:'file-preview-actions'},
                        filePreview.line&&React.createElement('span',{className:'file-preview-line-badge'},'Line ',filePreview.line),
                        React.createElement('button',{className:'file-preview-close',onClick:function(){closeFilePreview();}},'×')
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
        error&&React.createElement('div',{style:{position:'fixed',bottom:20,right:20,background:'var(--red)',color:'white',padding:'12px 20px',borderRadius:8,zIndex:1000,maxWidth:350},'role':'alert'},[error,React.createElement('button',{'aria-label':'Dismiss error','onClick':function(){project.dismissError();setPickerError(null);},style:{marginLeft:12,background:'none',border:'none',color:'white',cursor:'pointer',fontSize:16}},'×')])
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ErrorBoundary,null,React.createElement(App)));
