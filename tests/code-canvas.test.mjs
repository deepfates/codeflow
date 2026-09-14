import {highlightSyntax as highlight} from '../src/views/highlight.mjs';
import {createInvestigationState,reduceInvestigation} from '../src/investigation/state.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readableLabelScale, COLOR_BLOCK_ZOOM, CODE_FAR_ZOOM, zoomShowsColorBlocks, graphColorBlockScale, zoomHidesCodeText, graphColorBlockSize, codeColorBlockKindColor, colorBlockLooksLikeDiff, graphColorBlockFill, graphLinkStrokeWidth, scaleStrokeWidth, graph3dLinkWidth, forceLinkVisual, forceLinkRole, forceLinkParticlesNeedTickUpdate, prefersReducedMotion, subscribePrefersReducedMotion } from '../src/views/graph-style.mjs';
import { vizHasZoomColorBlocks, codeFileNavOpensCard, graphSvgExportEnabled, vizUsesLineThickness, vizHasGraphToolbar, vizHasCanvasMinimap, vizUsesForceLinkParticles } from '../src/views/capabilities.mjs';
import { codeColorBlockSections, extractFileSymbols, collectCrossFileSymbols, annotateHtmlWithSymbols, codeCardPillViewTop, escapeHtmlAttr } from '../src/views/source-symbols.mjs';
import { codeCardWrapColumns, codeCardWrappedLineCount, codeCardContentMetrics, codeCardVisualLineIndex, codeCardVisualLineEndIndex, CODE_CARD_LINE_HEIGHT, codeCardSize, CODE_CARD_WIDTH, CODE_CARD_MIN_HEIGHT, CODE_CARD_MAX_HEIGHT, applyCodeCardUserSize, codeCardSizeForDiff, clampCodeCardResize, CODE_CARD_MIN_WIDTH } from '../src/views/card-size.mjs';
import { applyCodeCardLayout, noteCodeCardPointerEnd, consumeCodeCardClick, codeCardDragDelta, codeViewWheelPanDelta, codeViewWheelAction, raiseCodeCardStack, codeCardZIndex, applyCodeCardStackOrder, codeViewDragRefresh, applyCodeCardDragFrame, applyCodeCardResizeFrame, codeCardResizeDelta, codeCanvasTransformStyle, codeCardAnchorStyle, readCodeCardBodyScroll, isCodeCanvasNativeScrollTarget, codeViewWheelUsesNativeScroll, isCodeCanvasDeselectTarget } from '../src/views/card-interaction.mjs';
import { nodeReplacedByCard, unburyNodesFromCards, appendCodeCardPlacement, reflowUnpinnedCodeCards, layoutCodeCardsByFolder, codeFolderCardBounds, liveGraphNodeXY, readCodeCardWorldBoxes, codeFolderHullBounds, codeFolderHullsByFolder, graphFolderCenters, parkLeftoverCodeNodes, leftoverCodeNodeGrid, translateCodeViewSiblings, bumpOverlappingCodeCards, nodeWorldBox, boxesOverlap, settleCodeViewAfterDrag, cardWorldBox, leftoverHullObstacles, leftoverSpatialCellKey, leftoverSeparationBuckets, leftoverSeparationNeighbors, separateLeftoverCodeNodes, preserveGraphNodeState, codeCardCollisionRadius } from '../src/views/canvas-layout.mjs';
import { getConnectedFilePaths, collectVisibleCodeFiles, codeViewSeedPath, filesForOpenedCodePaths, defaultCodeViewSeed, fileMatchesFolderFilter, pathMatchesFolderFilter, folderFilterAfterCodeNav, ensureCodeViewOpenedPaths, CODE_CARD_MAX, countVisibleCodeFiles, openCodeCardPaths, resolveOpenCodeCard, codeCardPlacementKeepSet, pruneCodeCardPlacements, hiddenOpenedCodePaths } from '../src/investigation/navigation.mjs';
import { nextCodeSourceReads, fileSourceDisplayState, recordCodeSourceFailure, clearCodeSourceFailure, analysisFileNeedsSource, mergeHydratedFileSources, fileHasLoadedSource, recordCodeSourceFailureIfCurrent, clearCodeSourceFailureIfCurrent, asCodeLines } from '../src/project/source.mjs';
import { codeCardSymbolLine, codeEdgeBezier, codeCardLinkPath, codeLinkPrefersVertical } from '../src/views/card-links.mjs';
import { codeCardDiffRows, normalizeCliWatchPath, noteCliWatchPath, cliWatchDiffPaths, fileHasAnalyzedSourceForDiff, mergeCliLiveContents, diffCodeLines, codeCardHasDiff, codeCardDiffClass, codeCardDiffLineNo, fileForCodeCardDiff, codeCardDiffLineIndex, bumpCliWatchDiffEpoch, cliWatchDiffRequestIsCurrent, retainCliWatchPathsAfterAnalysis, noteCliWatchDuringEvent, cliWatchEventIsAfterSnapshot, cliWatchSnapRevFromResponse, noteCliWatchPathIfRead, forgetCliWatchPath, analyzedFileForCliWatchPath, cliWatchLiveMatchesBaseline, cliWatchLiveClearsDirty, cliWatchLiveFromResponse, shouldApplyCliWatchLive, CLI_WATCH_MAX_BYTES, cliWatchLiveRejectsOversized, pendingCliWatchDiffPaths, startedCliWatchDiffPaths, cliWatchAppliesToAnalysis } from '../src/project/changes.mjs';
import { shouldFitCodeCamera, clampCodeViewFitScale, CODE_VIEW_MIN_FIT_SCALE, CODE_VIEW_MAX_FIT_SCALE, snapshotZoomTransform } from '../src/views/camera.mjs';
import { graphStructureKey, codeViewSceneKey, analysisHydrationId, analysisGraphKey, fileGraphIdentity, analysisCacheKey, githubZipDownloadUrl, resolveSafeCliPath, localFolderCacheMeta, cliRecordMatchesStatus, retainedZipMatchesRecord, githubCacheSourceKey, cachedAnalysisMatchesExcludes, githubSourceKeyForLoadedAnalysis, loadedAnalysisSourceIdentity, analysisHydrationIdFromParts, cliWatchCacheMeta, zipArchiveCacheMeta, retainedFolderMatchesRecord, hydratedSourceIsCurrent, hydrationRequestIsCurrent } from '../src/project/identity.mjs';
import { armRecentDelete, buildRecentAnalysisRecord, compactAnalysisForCache } from '../src/investigation/recent-analyses.mjs';
import { collectMinimapWorldBounds, collectMinimapContent, minimapCardInputs, viewportWorldRect, minimapFitRect, worldToMinimap, minimapToWorld, zoomTransformToCenterWorld, zoomTransformFromMinimapPoint, minimapPointerXY, colorWithAlpha, clampMinimapPoint, panTransformByViewportFraction, zoomTransformNudgeWorld, panTransformToWorldMidpoint } from '../src/views/minimap.mjs';
import { LINE_THICKNESS_DEFAULT, LINE_THICKNESS_MIN, LINE_THICKNESS_MAX, clampLineThickness, readUiPrefs, writeUiPrefs, UI_PREFS_STORAGE_KEY, persistUiPrefs, resolveUiPrefsStorage } from '../src/investigation/preferences.mjs';
const J = (v) => JSON.parse(JSON.stringify(v));

test('syntax highlighting preserves source text across markup and keyword passes', () => {
  const sources = [
    ['target.js', 'export function target() { return 42; }\nconst answer:Widget = target   ();'],
    ['sample.py', 'class Example:\n    def answer(self):\n        return 42 # class answer'],
    ['Sample.java', 'class Sample { int answer() { return 42; } }'],
    ['sample.rb', 'class Sample\n  def answer\n    42\n  end\nend'],
    ['sample.php', '<?php class Sample { function answer() { return 42; } }'],
    ['sample.html', '<main class="example" data-count="42">& source</main>'],
    ['sample.js', "// class return 42\nconst text = 'class return 42';\nif (a < 42 && b > 0) target  ();"],
  ];
  for (const [filename, source] of sources) {
    const rendered = highlight(source, filename).join('\n');
    const text = rendered.replace(/<\/?span\b[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.equal(text, source, filename + ' must retain every source character');
  }
  assert.match(highlight('return 42;', 'sample.js')[0], /<span class="syn-num">42<\/span>/);
  assert.match(highlight('return 42;', 'sample.js')[0], /<span class="syn-kw">return<\/span>/);
});

test('readable labels grow only when zoomed out', () => {
  assert.equal(readableLabelScale(1), 1);
  assert.equal(readableLabelScale(2), 1);
  assert.equal(readableLabelScale(0.5), 2);
  assert.ok(readableLabelScale(0.1) > 2);
});

test('color blocks replace fine chrome below the CodeCanvas zoom threshold', () => {
  assert.equal(COLOR_BLOCK_ZOOM, 0.4);
  assert.equal(CODE_FAR_ZOOM, 0.22);
  assert.equal(zoomShowsColorBlocks(1), false);
  assert.equal(zoomShowsColorBlocks(0.41), false);
  assert.equal(zoomShowsColorBlocks(0.4), true);
  assert.equal(zoomShowsColorBlocks(0.39), true);
  assert.equal(zoomShowsColorBlocks(0.2), true);
  assert.equal(graphColorBlockScale(1), 1);
  assert.ok(graphColorBlockScale(0.4) >= 1);
  assert.ok(graphColorBlockScale(0.2) > graphColorBlockScale(0.4));
  assert.equal(zoomHidesCodeText(0.4), false);
  assert.equal(zoomHidesCodeText(0.22), false);
  assert.equal(zoomHidesCodeText(0.21), true);
  assert.equal(vizHasZoomColorBlocks('graph'), true);
  assert.equal(vizHasZoomColorBlocks('code'), true);
  assert.equal(vizHasZoomColorBlocks('graph3d'), false);
  assert.equal(vizHasZoomColorBlocks('treemap'), false);
  assert.ok(graphColorBlockSize({ fnCount: 0 }) >= 18);
  assert.ok(graphColorBlockSize({ fnCount: 20 }) > graphColorBlockSize({ fnCount: 0 }));
});

test('zoom-out color blocks avoid red and green diff colors', () => {
  ['fn', 'import', 'export', 'var', 'file', 'class'].forEach((kind) => {
    const fill = codeColorBlockKindColor(kind);
    assert.equal(colorBlockLooksLikeDiff(fill), false, kind + ' ' + fill);
  });
  ['#00ff9d', '#22c55e', '#84cc16', '#98c379', '#ff5f5f', '#e06c75'].forEach((hex) => {
    assert.equal(colorBlockLooksLikeDiff(hex), true, hex);
    assert.equal(colorBlockLooksLikeDiff(graphColorBlockFill(hex)), false, hex);
  });
  ['#4d9fff', '#a78bfa', '#22d3ee', '#ff9f43', '#61afef'].forEach((hex) => {
    assert.equal(graphColorBlockFill(hex).toLowerCase(), hex.toLowerCase());
  });
  const churnHigh = graphColorBlockFill('#ff5f5f');
  const churnLow = graphColorBlockFill('#22c55e');
  assert.notEqual(churnHigh.toLowerCase(), '#ff5f5f');
  assert.notEqual(churnLow.toLowerCase(), '#22c55e');
  const folderPalette = ['#4d9fff', '#a78bfa', '#22d3ee', '#00ff9d', '#ff9f43', '#ec4899', '#ff5f5f', '#84cc16'];
  const folderFills = folderPalette.map((hex) => graphColorBlockFill(hex).toLowerCase());
  assert.equal(new Set(folderFills).size, folderPalette.length);
  folderFills.forEach((hex) => {
    assert.equal(colorBlockLooksLikeDiff(hex), false, hex);
  });
  const layerPalette = ['#4d9fff', '#22d3ee', '#a78bfa', '#00ff9d', '#ff9f43', '#ec4899', '#f59e0b', '#c084fc'];
  const layerFills = layerPalette.map((hex) => graphColorBlockFill(hex).toLowerCase());
  assert.equal(new Set(layerFills).size, layerPalette.length);
  assert.notEqual(graphColorBlockFill('#00ff9d').toLowerCase(), '#22d3ee');
  assert.notEqual(graphColorBlockFill('#ff5f5f').toLowerCase(), '#a78bfa');
  assert.notEqual(graphColorBlockFill('#84cc16').toLowerCase(), '#ff9f43');
});

test('code color blocks cover functions and leftover file regions', () => {
  const file = {
    path: 'src/app.js',
    name: 'app.js',
    content: 'import { add } from "./math.js";\n\nexport function render(){\n  return add(1, 2);\n}\n\nfunction helper(){\n  return 1;\n}\n',
    functions: [
      { name: 'render', line: 3, isExported: true },
      { name: 'helper', line: 7, isExported: false }
    ]
  };
  const sections = codeColorBlockSections(file, [{ source: 'src/math.js', target: 'src/app.js', fn: 'add' }]);
  const names = J(sections).map((s) => s.name);
  assert.ok(names.includes('render'));
  assert.ok(names.includes('helper'));
  assert.ok(names.includes('add') || names.includes('app.js'));
  const render = sections.find((s) => s.name === 'render');
  assert.equal(render.kind, 'export');
  assert.equal(render.startLine, 3);
  assert.ok(render.endLine >= 3);
  assert.ok(render.height >= 6);
  assert.equal(render.color, codeColorBlockKindColor('export'));
  const helper = sections.find((s) => s.name === 'helper');
  assert.equal(helper.kind, 'fn');
  assert.ok(helper.top > render.top);
  const empty = codeColorBlockSections({ name: 'notes.md', path: 'notes.md', content: '# hi\n' }, []);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].name, 'notes.md');
  assert.equal(empty[0].kind, 'file');
  const wrapCols = codeCardWrapColumns();
  const long = 'x'.repeat(800);
  const oneLiner = { name: 'one.js', path: 'one.js', content: long };
  const visualRows = codeCardWrappedLineCount(codeCardContentMetrics(oneLiner), { wrap: true });
  assert.ok(visualRows > 8);
  assert.equal(codeCardVisualLineIndex(oneLiner, 1, { wrap: true }), 1);
  assert.equal(codeCardVisualLineEndIndex(oneLiner, 1, { wrap: true }), visualRows);
  const wrappedFile = codeColorBlockSections(oneLiner, [], { wrap: true });
  assert.equal(wrappedFile.length, 1);
  assert.equal(wrappedFile[0].height, visualRows * CODE_CARD_LINE_HEIGHT);
  assert.ok(wrappedFile[0].height > CODE_CARD_LINE_HEIGHT);
  const mid = {
    name: 'mid.js',
    path: 'mid.js',
    content: 'function foo(){\n' + long + '\n}\nfunction bar(){\n  return 1;\n}\n',
    functions: [
      { name: 'foo', line: 1, isExported: false },
      { name: 'bar', line: 4, isExported: false }
    ]
  };
  const midSections = codeColorBlockSections(mid, [], { wrap: true });
  const foo = midSections.find((s) => s.name === 'foo');
  const fooEnd = 1 + Math.ceil(800 / wrapCols) + 1;
  assert.equal(foo.endLine, 3);
  assert.equal(codeCardVisualLineEndIndex(mid, 3, { wrap: true }), fooEnd);
  assert.equal(foo.height, fooEnd * CODE_CARD_LINE_HEIGHT);
});

test('card layout toggles color-block and far-zoom classes at the thresholds', () => {
  function trackingCard(path) {
    const classes = new Set();
    return {
      path,
      classes,
      getAttribute(name) { return name === 'data-code-card' ? path : null; },
      style: {},
      classList: {
        add(name) { classes.add(name); },
        remove(name) { classes.delete(name); }
      },
      querySelector() { return { style: {} }; }
    };
  }
  const near = trackingCard('a.js');
  const mid = trackingCard('b.js');
  const far = trackingCard('c.js');
  const layerFor = (card) => ({ style: {}, querySelectorAll() { return [card]; } });
  const nodes = { 'a.js': { x: 10, y: 10 }, 'b.js': { x: 10, y: 10 }, 'c.js': { x: 10, y: 10 } };
  const sizes = { 'a.js': { width: 100, height: 80 }, 'b.js': { width: 100, height: 80 }, 'c.js': { width: 100, height: 80 } };
  const nearLaid = applyCodeCardLayout(layerFor(near), nodes, { k: 1, x: 0, y: 0 }, sizes);
  assert.equal(nearLaid.colorBlocks, false);
  assert.equal(nearLaid.codeFar, false);
  assert.equal(near.classes.has('code-blocks'), false);
  assert.equal(near.classes.has('code-far'), false);
  const midLaid = applyCodeCardLayout(layerFor(mid), { 'b.js': { x: 10, y: 10 } }, { k: 0.3, x: 0, y: 0 }, sizes);
  assert.equal(midLaid.colorBlocks, true);
  assert.equal(midLaid.codeFar, false);
  assert.equal(mid.classes.has('code-blocks'), true);
  assert.equal(mid.classes.has('code-far'), false);
  const farLaid = applyCodeCardLayout(layerFor(far), { 'c.js': { x: 10, y: 10 } }, { k: 0.1, x: 0, y: 0 }, sizes);
  assert.equal(farLaid.colorBlocks, true);
  assert.equal(farLaid.codeFar, true);
  assert.equal(far.classes.has('code-blocks'), true);
  assert.equal(far.classes.has('code-far'), true);
});

test('open Code cards replace their nodes', () => {
  const cards = new Set(['src/app.js']);
  assert.equal(nodeReplacedByCard('src/app.js', cards), true);
  assert.equal(nodeReplacedByCard('src/math.js', cards), false);
  assert.equal(nodeReplacedByCard('src/app.js', null), false);
});

test('remaining Code nodes are pushed out from under cards', () => {
  const cards = new Set(['src/app.js']);
  const sizes = { 'src/app.js': { width: 400, height: 200 } };
  const nodes = [
    { id: 'src/app.js', x: 100, y: 100 },
    { id: 'src/math.js', x: 110, y: 105 }
  ];
  unburyNodesFromCards(nodes, cards, sizes, 20);
  assert.equal(nodes[0].x, 100);
  assert.equal(nodes[0].y, 100);
  const buried = Math.abs(nodes[1].x - 100) < 220 && Math.abs(nodes[1].y - 100) < 120;
  assert.equal(buried, false);
  assert.ok(Math.abs(nodes[1].x - 100) >= 220 || Math.abs(nodes[1].y - 100) >= 120);
});

test('connected files include both directions', () => {
  const paths = getConnectedFilePaths('src/app.js', [
    { source: 'src/math.js', target: 'src/app.js', fn: 'add' },
    { source: 'src/app.js', target: 'src/ui.js', fn: 'render' }
  ]);
  assert.deepEqual(J(paths).sort(), ['src/math.js', 'src/ui.js']);
});

test('symbol extraction finds imports, exports, and functions', () => {
  const file = {
    path: 'src/app.js',
    content: 'import { add } from "./math.js";\nexport function render(){ return add(1, 2); }\n',
    functions: [{ name: 'render', isExported: true }]
  };
  const symbols = extractFileSymbols(file, [{ source: 'src/math.js', target: 'src/app.js', fn: 'add' }]);
  const names = J(symbols).map((s) => s.name).sort();
  assert.deepEqual(names, ['add', 'render']);
  assert.equal(symbols.find((s) => s.name === 'add').kind, 'import');
  assert.equal(symbols.find((s) => s.name === 'render').kind, 'export');
});

test('cross-file symbols stay identifiable across visible files', () => {
  const files = [
    { path: 'a.js', content: 'export function shared(){}', functions: [{ name: 'shared', isExported: true }] },
    { path: 'b.js', content: 'import { shared } from "./a.js"; shared();', functions: [] }
  ];
  const symbols = collectCrossFileSymbols(files, [{ source: 'a.js', target: 'b.js', fn: 'shared' }]);
  const shared = symbols.find((s) => s.name === 'shared');
  assert.ok(shared);
  assert.equal(shared.files.length, 2);
});

test('symbol annotation wraps identifiers and skips HTML tags', () => {
  const html = '<span class="syn-fn">shared</span> and shared again';
  const out = annotateHtmlWithSymbols(html, [{ name: 'shared', kind: 'fn' }], 'shared');
  assert.match(out, /data-sym="shared"/);
  assert.doesNotMatch(out, /class="sym-mark[^"]*">class/);
});

test('visible code files prefer the selection and its neighbors', () => {
  const data = {
    files: [
      { path: 'a.js', folder: 'src', name: 'a.js', content: 'export function a(){}', functions: [{ name: 'a', isExported: true }] },
      { path: 'b.js', folder: 'src', name: 'b.js', content: 'import { a } from "./a.js"', functions: [] },
      { path: 'c.js', folder: 'other', name: 'c.js', content: '', functions: [] }
    ],
    connections: [{ source: 'a.js', target: 'b.js', fn: 'a' }]
  };
  const visible = collectVisibleCodeFiles('a.js', data, 'src');
  assert.deepEqual(J(visible).map((f) => f.path), ['a.js', 'b.js']);
});

test('visible code files are not capped at four', () => {
  const files = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js'].map((name) => ({
    path: name,
    folder: 'src',
    name,
    content: '',
    functions: []
  }));
  const connections = files.slice(1).map((file) => ({ source: 'a.js', target: file.path, fn: 'a' }));
  const visible = collectVisibleCodeFiles('a.js', { files, connections }, 'src');
  assert.deepEqual(J(visible).map((f) => f.path), ['a.js', 'b.js', 'c.js', 'd.js', 'e.js', 'f.js']);
  const seeded = collectVisibleCodeFiles(null, { files, connections }, 'src');
  assert.equal(seeded[0].path, 'a.js');
  assert.equal(seeded.length, 6);
});

test('large inventories still seed Code and retain explicitly opened cards', () => {
  const files = Array.from({ length: 400 }, (_, i) => ({ path: 'f'+i+'.js', folder: 'root', name: 'f'+i+'.js', functions: [] }));
  const data = { files, connections: [] };
  const seed = codeViewSeedPath(null, data, null);
  assert.ok(files.some(file => file.path === seed));
  assert.deepEqual(J(filesForOpenedCodePaths([seed, 'f399.js'], data, null)).map(file => file.path), [seed, 'f399.js']);
  assert.equal(data.files.length, 400);
});

test('Code view seeds the filtered folder when the selection is outside it', () => {
  const data = {
    files: [
      { path: 'src/hub.js', folder: 'src', name: 'hub.js', functions: [] },
      { path: 'src/leaf.js', folder: 'src', name: 'leaf.js', functions: [] },
      { path: 'lib/out.js', folder: 'lib', name: 'out.js', functions: [] }
    ],
    connections: [
      { source: 'src/hub.js', target: 'src/leaf.js', fn: 'h' },
      { source: 'lib/out.js', target: 'src/hub.js', fn: 'o' }
    ]
  };
  const visible = collectVisibleCodeFiles('lib/out.js', data, 'src');
  assert.equal(visible[0].path, 'src/hub.js');
  assert.ok(visible.every((file) => file.folder === 'src'));
  assert.equal(visible.some((file) => file.path === 'lib/out.js'), false);
});

test('Code view seeds cards without waiting for a click', () => {
  const files = [
    { path: 'leaf.js', folder: 'src', name: 'leaf.js', functions: [] },
    { path: 'hub.js', folder: 'src', name: 'hub.js', functions: [] },
    { path: 'other.js', folder: 'lib', name: 'other.js', functions: [] }
  ];
  const connections = [
    { source: 'hub.js', target: 'leaf.js', fn: 'h' },
    { source: 'hub.js', target: 'other.js', fn: 'h' }
  ];
  const data = { files, connections };
  assert.equal(defaultCodeViewSeed(data, 'src'), 'hub.js');
  assert.equal(codeViewSeedPath(null, data, 'src'), 'hub.js');
  assert.equal(codeViewSeedPath('leaf.js', data, 'src'), 'leaf.js');
  assert.equal(codeViewSeedPath('other.js', data, 'src'), 'hub.js');
  const visible = collectVisibleCodeFiles(null, data, 'src');
  assert.deepEqual(J(visible).map((f) => f.path), ['hub.js', 'leaf.js']);
  assert.equal(defaultCodeViewSeed({ files: [], connections: [] }, null), null);
  assert.equal(codeViewSeedPath('leaf.js', { files: [], connections: [] }, null), null);
  assert.equal(codeFileNavOpensCard('code'), true);
  assert.equal(codeFileNavOpensCard('graph'), false);
  assert.equal(codeFileNavOpensCard(null), false);
  assert.equal(graphSvgExportEnabled('graph'), true);
  assert.equal(graphSvgExportEnabled('graph3d'), false);
  assert.equal(graphSvgExportEnabled('code'), false);
});

test('out-of-filter Code nav clears the folder filter so the target card can render', () => {
  const files = [
    { path: 'src/a.js', folder: 'src', name: 'a.js' },
    { path: 'src/b.js', folder: 'src', name: 'b.js' },
    { path: 'lib/out.js', folder: 'lib', name: 'out.js' }
  ];
  const data = { files };
  assert.equal(fileMatchesFolderFilter(files[0], 'src'), true);
  assert.equal(fileMatchesFolderFilter(files[2], 'src'), false);
  assert.equal(pathMatchesFolderFilter('src/a.js', data, 'src'), true);
  assert.equal(pathMatchesFolderFilter('lib/out.js', data, 'src'), false);
  assert.equal(folderFilterAfterCodeNav('src/a.js', data, 'src'), 'src');
  assert.equal(folderFilterAfterCodeNav('lib/out.js', data, 'src'), null);
  assert.equal(folderFilterAfterCodeNav('lib/out.js', data, null), null);
  assert.deepEqual(
    J(filesForOpenedCodePaths(['src/a.js', 'lib/out.js'], data, 'src')).map((f) => f.path),
    ['src/a.js']
  );
  assert.deepEqual(
    J(filesForOpenedCodePaths(['src/a.js', 'lib/out.js'], data, null)).map((f) => f.path),
    ['src/a.js', 'lib/out.js']
  );
});

test('returning to Code opens the current selection without dropping old cards', () => {
  const data = {
    files: [
      { path: 'leaf.js', folder: 'src', name: 'leaf.js', functions: [] },
      { path: 'hub.js', folder: 'src', name: 'hub.js', functions: [] },
      { path: 'other.js', folder: 'src', name: 'other.js', functions: [] }
    ],
    connections: [
      { source: 'hub.js', target: 'leaf.js', fn: 'h' },
      { source: 'hub.js', target: 'other.js', fn: 'h' }
    ]
  };
  const reenter = ensureCodeViewOpenedPaths(['hub.js'], 'leaf.js', data, 'src');
  assert.deepEqual(J(reenter.paths), ['hub.js', 'leaf.js']);
  assert.equal(reenter.seed, 'leaf.js');
  assert.equal(reenter.inserted, true);
  assert.equal(reenter.opened, true);
  const already = ensureCodeViewOpenedPaths(['hub.js', 'leaf.js'], 'leaf.js', data, 'src');
  assert.deepEqual(J(already.paths), ['hub.js', 'leaf.js']);
  assert.equal(already.inserted, false);
  assert.equal(already.opened, true);
  const empty = ensureCodeViewOpenedPaths([], null, data, 'src');
  assert.deepEqual(J(empty.paths), ['hub.js']);
  assert.equal(empty.seed, 'hub.js');
  const capped = Array.from({ length: CODE_CARD_MAX }, (_, i) => 'f' + i + '.js');
  const replaced = ensureCodeViewOpenedPaths(capped, 'leaf.js', data, 'src');
  assert.equal(replaced.opened, true);
  assert.equal(replaced.inserted, true);
  assert.equal(replaced.paths.length, CODE_CARD_MAX + 1);
  assert.equal(replaced.paths[replaced.paths.length - 1], 'leaf.js');
  assert.equal(replaced.paths.indexOf('f0.js'), 0);
  assert.equal(replaced.paths.indexOf('f1.js'), 1);
});

test('high-degree neighborhoods stay within the card cap', () => {
  const files = Array.from({ length: 30 }, (_, i) => ({
    path: i === 0 ? 'hub.js' : 'n' + i + '.js',
    folder: 'src',
    name: i === 0 ? 'hub.js' : 'n' + i + '.js',
    functions: []
  }));
  files[20].content = 'export const kept = 1;\n';
  const connections = files.slice(1).map((file) => ({ source: 'hub.js', target: file.path, fn: 'hub' }));
  const visible = collectVisibleCodeFiles('hub.js', { files, connections }, 'src');
  assert.equal(visible.length, CODE_CARD_MAX);
  assert.equal(visible[0].path, 'hub.js');
  assert.ok(visible.some((file) => file.path === 'n20.js'));
  assert.equal(countVisibleCodeFiles('hub.js', { files, connections }, 'src'), 30);
  assert.ok(countVisibleCodeFiles('hub.js', { files, connections }, 'src') > visible.length);
});

test('a drag does not select the card on the leftover click', () => {
  assert.deepEqual(J(noteCodeCardPointerEnd(true)), { select: false, ignoreNextClick: true });
  assert.deepEqual(J(noteCodeCardPointerEnd(false)), { select: true, ignoreNextClick: false });
  assert.deepEqual(J(consumeCodeCardClick(true)), { ignore: true, ignoreNextClick: false });
  assert.deepEqual(J(consumeCodeCardClick(false)), { ignore: false, ignoreNextClick: false });
});

test('card drag activation uses screen pixels, not zoomed graph units', () => {
  const far = codeCardDragDelta(101, 100, 100, 100, 0.08, 3);
  assert.equal(far.moved, false);
  assert.ok(Math.abs(far.x) > 3);
  const near = codeCardDragDelta(104, 100, 100, 100, 5, 3);
  assert.equal(near.moved, true);
  assert.ok(Math.abs(near.x) < 3);
  const still = codeCardDragDelta(100, 100, 100, 100, 1, 3);
  assert.equal(still.moved, false);
  assert.equal(still.x, 0);
});

test('code cards use a uniform width and grow with line count', () => {
  const empty = codeCardSize(null);
  assert.equal(empty.width, CODE_CARD_WIDTH);
  assert.equal(empty.height, CODE_CARD_MIN_HEIGHT);
  assert.equal(empty.clipped, false);
  const short = codeCardSize({ content: 'const x = 1;\n' });
  const tall = codeCardSize({ content: Array(40).fill('const value = 1;').join('\n') });
  assert.equal(short.width, CODE_CARD_WIDTH);
  assert.equal(tall.width, CODE_CARD_WIDTH);
  assert.ok(tall.height > short.height);
  const huge = codeCardSize({ content: Array(400).fill('x'.repeat(120)).join('\n') });
  assert.equal(huge.width, CODE_CARD_WIDTH);
  assert.equal(huge.height, CODE_CARD_MAX_HEIGHT);
  assert.equal(huge.clipped, true);
  const wide = codeCardSize({ content: 'x'.repeat(200) });
  assert.equal(wide.width, CODE_CARD_WIDTH);
  assert.ok(wide.height < CODE_CARD_MAX_HEIGHT);
  assert.equal(wide.clipped, true);
  const expanded = codeCardSize({ content: Array(400).fill('x'.repeat(120)).join('\n') }, { expand: true });
  assert.ok(expanded.height > CODE_CARD_MAX_HEIGHT);
  assert.equal(expanded.expand, true);
  assert.equal(expanded.clipped, true);
  const expandedWrap = codeCardSize({ content: Array(400).fill('x'.repeat(120)).join('\n') }, { expand: true, wrap: true });
  assert.ok(expandedWrap.height > CODE_CARD_MAX_HEIGHT);
  assert.equal(expandedWrap.clipped, false);
  const wrapped = codeCardSize({ content: 'x'.repeat(200) }, { wrap: true });
  assert.equal(wrapped.clipped, false);
  assert.equal(wrapped.wrap, true);
  const manyWide = codeCardSize({ content: Array(8).fill('x'.repeat(200)).join('\n') });
  const manyWrapped = codeCardSize({ content: Array(8).fill('x'.repeat(200)).join('\n') }, { wrap: true });
  assert.ok(manyWrapped.height > manyWide.height);
  const wrapCols = codeCardWrapColumns();
  assert.ok(wrapCols >= 20);
  assert.equal(codeCardWrappedLineCount({ lines: 1, lineChars: [200] }, { wrap: true }), Math.ceil(200 / wrapCols));
  assert.equal(codeCardVisualLineIndex({ content: 'short\n' + 'x'.repeat(200) }, 2, { wrap: true }), 2);
  const wrappedTwo = { content: 'short\n' + 'x'.repeat(200) };
  assert.equal(codeCardVisualLineEndIndex(wrappedTwo, 1, { wrap: true }), 1);
  assert.equal(
    codeCardVisualLineEndIndex(wrappedTwo, 2, { wrap: true }),
    1 + Math.ceil(200 / wrapCols)
  );
  assert.equal(codeCardVisualLineEndIndex(wrappedTwo, 2, {}), 2);
});

test('opened code paths append without reshuffling the set', () => {
  assert.deepEqual(J(openCodeCardPaths(['a.js'], 'b.js')), ['a.js', 'b.js']);
  assert.deepEqual(J(openCodeCardPaths(['a.js', 'b.js'], 'a.js')), ['a.js', 'b.js']);
  const capped = Array.from({ length: CODE_CARD_MAX }, (_, i) => 'f' + i + '.js');
  assert.deepEqual(J(openCodeCardPaths(capped, 'extra.js')), capped);
  const rejected = resolveOpenCodeCard(capped, 'extra.js');
  assert.equal(rejected.opened, false);
  assert.equal(rejected.inserted, false);
  assert.deepEqual(J(rejected.paths), capped);
  const already = resolveOpenCodeCard(['a.js', 'b.js'], 'a.js');
  assert.equal(already.opened, true);
  assert.equal(already.inserted, false);
  const added = resolveOpenCodeCard(['a.js'], 'b.js');
  assert.equal(added.opened, true);
  assert.equal(added.inserted, true);
  assert.deepEqual(J(added.paths), ['a.js', 'b.js']);
  const evicted = openCodeCardPaths(capped, 'extra.js', null, true);
  assert.equal(evicted.length, CODE_CARD_MAX);
  assert.equal(evicted[0], 'f1.js');
  assert.equal(evicted[evicted.length - 1], 'extra.js');
  const replaced = resolveOpenCodeCard(capped, 'extra.js', null, true);
  assert.equal(replaced.opened, true);
  assert.equal(replaced.inserted, true);
  assert.deepEqual(J(replaced.paths), evicted);
});

test('opened code files ignore the current selection', () => {
  const data = {
    files: [
      { path: 'a.js', folder: 'src' },
      { path: 'b.js', folder: 'src' },
      { path: 'c.js', folder: 'lib' }
    ]
  };
  const opened = filesForOpenedCodePaths(['a.js', 'c.js'], data, null);
  assert.deepEqual(J(opened).map((f) => f.path), ['a.js', 'c.js']);
  const still = filesForOpenedCodePaths(['a.js', 'c.js'], data, null);
  assert.deepEqual(J(still).map((f) => f.path), ['a.js', 'c.js']);
});

test('appending a code card keeps existing cards in place', () => {
  const a = { path: 'src/a.js', folder: 'src' };
  const b = { path: 'src/b.js', folder: 'src' };
  const c = { path: 'lib/c.js', folder: 'lib' };
  const size = { width: 440, height: 200 };
  const opts = { originX: 80, originY: 72, gapX: 88, gapY: 36 };
  let placed = appendCodeCardPlacement({}, a, size, opts);
  const first = J(placed['src/a.js']);
  placed = appendCodeCardPlacement(placed, b, size, opts);
  assert.deepEqual(J(placed['src/a.js']), first);
  assert.equal(placed['src/b.js'].left, first.left);
  assert.ok(placed['src/b.js'].top >= first.top + first.height);
  const beforeLib = J(placed['src/a.js']);
  const beforeB = J(placed['src/b.js']);
  placed = appendCodeCardPlacement(placed, c, size, opts);
  assert.deepEqual(J(placed['src/a.js']), beforeLib);
  assert.deepEqual(J(placed['src/b.js']), beforeB);
  assert.ok(placed['lib/c.js'].left >= beforeLib.left + beforeLib.width);
  assert.equal(placed['lib/c.js'].top, opts.originY);
  const grown = appendCodeCardPlacement(placed, a, { width: 440, height: 400 }, opts);
  assert.equal(grown['src/a.js'].left, first.left);
  assert.equal(grown['src/a.js'].top, first.top);
  assert.ok(grown['src/b.js'].top >= grown['src/a.js'].top + grown['src/a.js'].height);
  assert.ok(grown['src/b.js'].top > beforeB.top);
  const pinned = appendCodeCardPlacement(placed, a, { width: 440, height: 400 }, Object.assign({ pinnedPaths: { 'src/b.js': true } }, opts));
  assert.equal(pinned['src/b.js'].top, beforeB.top);
});

test('hidden-but-open cards keep their placements across folder filters', () => {
  const placements = {
    'src/a.js': { left: 12, top: 40, x: 232, y: 140, width: 440, height: 200, folder: 'src' },
    'lib/b.js': { left: 540, top: 40, x: 760, y: 140, width: 440, height: 200, folder: 'lib' }
  };
  const keep = codeCardPlacementKeepSet(['src/a.js', 'lib/b.js'], [{ path: 'lib/b.js' }]);
  assert.equal(keep['src/a.js'], true);
  assert.equal(keep['lib/b.js'], true);
  const departed = pruneCodeCardPlacements(placements, keep);
  assert.equal(departed['src/a.js'], undefined);
  assert.deepEqual(J(placements['src/a.js']).top, 40);
  assert.deepEqual(J(placements['lib/b.js']).left, 540);
  const closed = pruneCodeCardPlacements(placements, codeCardPlacementKeepSet(['lib/b.js'], [{ path: 'lib/b.js' }]));
  assert.equal(closed['src/a.js'], true);
  assert.equal(placements['src/a.js'], undefined);
  assert.ok(placements['lib/b.js']);
});

test('hydration height growth reflows unpinned cards in the same folder', () => {
  const a = { path: 'src/a.js', folder: 'src' };
  const b = { path: 'src/b.js', folder: 'src' };
  const opts = { originY: 72, gapY: 36 };
  let placed = appendCodeCardPlacement({}, a, { width: 440, height: 160 }, opts);
  placed = appendCodeCardPlacement(placed, b, { width: 440, height: 160 }, opts);
  const beforeB = placed['src/b.js'].top;
  placed = reflowUnpinnedCodeCards(
    appendCodeCardPlacement(placed, a, { width: 440, height: 400 }, opts),
    null,
    opts
  );
  assert.equal(placed['src/a.js'].top, 72);
  assert.equal(placed['src/b.js'].top, 72 + 400 + 36);
  assert.ok(placed['src/b.js'].top > beforeB);
});

test('source reads skip paths that are already in flight', () => {
  assert.deepEqual(J(nextCodeSourceReads(['a.js', 'b.js', 'a.js'], { 'a.js': true })), ['b.js']);
  assert.deepEqual(J(nextCodeSourceReads(['a.js'], { 'a.js': true })), []);
});

test('failed source reads leave a retryable state instead of loading forever', () => {
  const file = { path: 'src/a.js', name: 'a.js' };
  assert.equal(fileSourceDisplayState(file, true), 'loading');
  const failed = recordCodeSourceFailure(null, 'src/a.js');
  assert.equal(fileSourceDisplayState(file, true, failed), 'failed');
  assert.equal(fileSourceDisplayState(file, false, failed), 'unavailable');
  assert.deepEqual(J(nextCodeSourceReads(['src/a.js', 'src/b.js'], {}, failed)), ['src/b.js']);
  const cleared = clearCodeSourceFailure(failed, 'src/a.js');
  assert.equal(fileSourceDisplayState(file, true, cleared), 'loading');
  assert.deepEqual(J(nextCodeSourceReads(['src/a.js'], {}, cleared)), ['src/a.js']);
});

test('filtered-out cards do not consume the open-card cap', () => {
  const files = Array.from({ length: CODE_CARD_MAX }, (_, i) => ({
    path: 'src/f' + i + '.js',
    folder: 'src',
    name: 'f' + i + '.js'
  }));
  files.push({ path: 'lib/new.js', folder: 'lib', name: 'new.js' });
  files.push({ path: 'src/extra.js', folder: 'src', name: 'extra.js' });
  const data = { files };
  const capped = files.slice(0, CODE_CARD_MAX).map((file) => file.path);
  const hidden = hiddenOpenedCodePaths(capped, data, 'lib');
  assert.equal(Object.keys(hidden).length, CODE_CARD_MAX);
  const opened = resolveOpenCodeCard(capped, 'lib/new.js', null, false, hidden);
  assert.equal(opened.opened, true);
  assert.equal(opened.inserted, true);
  assert.equal(opened.paths.length, CODE_CARD_MAX);
  assert.equal(opened.paths[opened.paths.length - 1], 'lib/new.js');
  assert.equal(opened.paths.indexOf('src/f0.js'), -1);
  const visibleHidden = hiddenOpenedCodePaths(capped, data, 'src');
  assert.equal(Object.keys(visibleHidden).length, 0);
  const refused = resolveOpenCodeCard(capped, 'src/extra.js', null, false, visibleHidden);
  assert.equal(refused.opened, false);
  assert.deepEqual(J(refused.paths), capped);
});

test('out-of-filter Code nav at the card cap replaces so the target opens', () => {
  const files = Array.from({ length: CODE_CARD_MAX }, (_, i) => ({
    path: 'src/f' + i + '.js',
    folder: 'src',
    name: 'f' + i + '.js'
  }));
  files.push({ path: 'lib/new.js', folder: 'lib', name: 'new.js' });
  const data = { files };
  const capped = files.slice(0, CODE_CARD_MAX).map((file) => file.path);
  const nextFilter = folderFilterAfterCodeNav('lib/new.js', data, 'src');
  assert.equal(nextFilter, null);
  const keptHidden = hiddenOpenedCodePaths(capped, data, 'src');
  const refused = resolveOpenCodeCard(capped, 'lib/new.js', null, false, keptHidden);
  assert.equal(refused.opened, false);
  const hidden = hiddenOpenedCodePaths(capped, data, nextFilter);
  const opened = resolveOpenCodeCard(capped, 'lib/new.js', null, true, hidden);
  assert.equal(opened.opened, true);
  assert.equal(opened.inserted, true);
  assert.equal(opened.paths[opened.paths.length - 1], 'lib/new.js');
  assert.equal(
    filesForOpenedCodePaths(opened.paths, data, nextFilter).some((file) => file.path === 'lib/new.js'),
    true
  );
});

test('wheel pan deltas stay screen-pixel based across zoom', () => {
  assert.deepEqual(J(codeViewWheelPanDelta(40, 80, 1)), { x: -40, y: -80 });
  assert.deepEqual(J(codeViewWheelPanDelta(40, 80, 2)), { x: -20, y: -40 });
  assert.deepEqual(J(codeViewWheelPanDelta(40, 80, 0.5)), { x: -80, y: -160 });
  assert.equal(codeViewWheelAction({}), 'pan');
});

test('line-level code edges use bezier anchors, not card centers', () => {
  const file = {
    path: 'src/a.js',
    content: 'export function shared(){}\n',
    functions: [{ name: 'shared', line: 1, isExported: true }]
  };
  assert.equal(codeCardSymbolLine(file, 'shared'), 1);
  const d = codeEdgeBezier(0, 10, 200, 40);
  assert.equal(d, 'M0,10C90,10 110,40 200,40');
  const reverse = codeEdgeBezier(200, 10, 0, 40);
  assert.equal(reverse, 'M200,10C110,10 90,40 0,40');
  const src = { id: 'src/a.js', x: 220, y: 200 };
  const tgt = { id: 'src/b.js', x: 800, y: 240 };
  const sizes = {
    'src/a.js': { width: 440, height: 200 },
    'src/b.js': { width: 440, height: 200 }
  };
  const files = {
    'src/a.js': file,
    'src/b.js': { path: 'src/b.js', content: 'import { shared } from "./a.js";\n', functions: [] }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  const path = codeCardLinkPath({ source: src, target: tgt, fn: 'shared' }, sizes, files, cards);
  assert.match(path, /^M/);
  assert.ok(!path.includes(String(src.x) + ',' + String(src.y)));
  const leftover = { id: 'src/c.js', x: 1100, y: 260 };
  const fromCard = codeCardLinkPath({ source: src, target: leftover, fn: 'shared' }, sizes, files, new Set(['src/a.js']));
  assert.match(fromCard, /^M440,/);
  assert.match(fromCard, / 1100,260$/);
  assert.ok(!fromCard.includes('220,200'));
  const toCard = codeCardLinkPath({ source: leftover, target: tgt, fn: 'shared' }, sizes, files, new Set(['src/b.js']));
  assert.match(toCard, /^M1100,260C/);
  assert.ok(!toCard.includes('800,240'));
  assert.equal(codeCardLinkPath({ source: src, target: leftover, fn: 'shared' }, sizes, files, new Set()), null);
  assert.equal(codeViewWheelAction({ ctrlKey: true }), 'zoom');
  assert.equal(codeViewWheelAction({}), 'pan');
});

test('same-folder stacked cards route links through top and bottom edges', () => {
  const upper = { id: 'src/a.js', x: 300, y: 200 };
  const lower = { id: 'src/b.js', x: 300, y: 500 };
  const sizes = {
    'src/a.js': { width: 440, height: 200 },
    'src/b.js': { width: 440, height: 200 }
  };
  const files = {
    'src/a.js': { path: 'src/a.js', content: 'export function shared(){}\n', functions: [{ name: 'shared', line: 1 }] },
    'src/b.js': { path: 'src/b.js', content: 'import { shared } from "./a.js";\n', functions: [] }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  assert.equal(codeLinkPrefersVertical(upper, lower), true);
  assert.equal(codeLinkPrefersVertical({ x: 220, y: 200 }, { x: 800, y: 240 }), false);
  const stacked = codeEdgeBezier(300, 300, 300, 400);
  assert.equal(stacked, 'M300,300C300,380 300,320 300,400');
  const path = codeCardLinkPath({ source: upper, target: lower, fn: 'shared' }, sizes, files, cards);
  assert.equal(path, 'M300,300C300,380 300,320 300,400');
  const reverse = codeCardLinkPath({ source: lower, target: upper, fn: 'shared' }, sizes, files, cards);
  assert.equal(reverse, 'M300,400C300,320 300,380 300,300');
  assert.ok(!path.includes('520,'));
  assert.ok(!reverse.includes('80,'));
});

test('opened code cards auto-align by directory', () => {
  const files = [
    { path: 'src/a.js', folder: 'src' },
    { path: 'src/b.js', folder: 'src' },
    { path: 'lib/c.js', folder: 'lib' }
  ];
  const sizes = {
    'src/a.js': { width: 320, height: 200 },
    'src/b.js': { width: 320, height: 200 },
    'lib/c.js': { width: 320, height: 200 }
  };
  const layout = layoutCodeCardsByFolder(files, sizes, { originX: 0, originY: 0, gapX: 40, groupGapX: 80 });
  assert.ok(layout['src/a.js']);
  assert.ok(layout['src/b.js']);
  assert.ok(layout['lib/c.js']);
  assert.equal(layout['src/a.js'].folder, 'src');
  assert.equal(layout['lib/c.js'].folder, 'lib');
  assert.ok(Math.abs(layout['src/a.js'].x - layout['src/b.js'].x) >= 320 || Math.abs(layout['src/a.js'].y - layout['src/b.js'].y) >= 200);
  assert.ok(layout['lib/c.js'].x !== layout['src/a.js'].x);
  const bounds = codeFolderCardBounds([
    { id: 'src/a.js', x: layout['src/a.js'].x, y: layout['src/a.js'].y },
    { id: 'src/b.js', x: layout['src/b.js'].x, y: layout['src/b.js'].y }
  ], sizes, 10);
  assert.ok(bounds.width >= 320);
  assert.ok(bounds.height >= 200);
  const before = codeFolderCardBounds([{ id: 'src/a.js', x: 220, y: 100 }], sizes, 10);
  const after = codeFolderCardBounds([{ id: 'src/a.js', x: 800, y: 400 }], sizes, 10);
  assert.ok(after.x > before.x);
  assert.ok(after.y > before.y);
  const stale = codeFolderCardBounds([{ id: 'src/a.js', x: 220, y: 100, fx: 800, fy: 400 }], sizes, 10);
  assert.ok(Math.abs(stale.x - after.x) < 1);
  assert.ok(Math.abs(stale.y - after.y) < 1);
  const xy = liveGraphNodeXY({ x: 10, y: 20, fx: 90, fy: 40 });
  assert.equal(xy.x, 90);
  assert.equal(xy.y, 40);
  const layer = {
    querySelectorAll: () => [{
      getAttribute: () => 'src/a.js',
      style: { left: '580px', top: '240px', width: '320px', height: '200px' }
    }]
  };
  const boxes = readCodeCardWorldBoxes(layer);
  assert.equal(boxes['src/a.js'].x, 580);
  const fromBox = codeFolderCardBounds([{ id: 'src/a.js', x: 0, y: 0 }], sizes, 10, boxes);
  assert.ok(fromBox.x > 500);
  const nearUnion = codeFolderHullBounds(
    [{ id: 'src/a.js', x: 800, y: 400 }],
    [{ id: 'src/near.js', x: 820, y: 390 }],
    sizes,
    10
  );
  assert.ok(nearUnion.width > 320);
  const farUnion = codeFolderHullBounds(
    [{ id: 'src/a.js', x: 800, y: 400 }],
    [{ id: 'src/old.js', x: 220, y: 100 }],
    sizes,
    10
  );
  assert.ok(farUnion.x > 400);
  const dragged = codeFolderHullBounds([{ id: 'src/a.js', x: 1400, y: 900 }], [], sizes, 10);
  assert.ok(dragged.x > farUnion.x);
  assert.ok(dragged.y > farUnion.y);
  const hullsBefore = codeFolderHullsByFolder({
    src: { cards: [{ id: 'src/a.js', x: 800, y: 400 }], leftover: [] },
    lib: { cards: [{ id: 'lib/c.js', x: 200, y: 100 }], leftover: [] }
  }, sizes, 10);
  const hullsAfter = codeFolderHullsByFolder({
    src: { cards: [{ id: 'src/a.js', x: 1400, y: 900 }], leftover: [] },
    lib: { cards: [{ id: 'lib/c.js', x: 200, y: 100 }], leftover: [] }
  }, sizes, 10);
  assert.ok(hullsAfter.src.x > hullsBefore.src.x);
  assert.equal(hullsAfter.lib.x, hullsBefore.lib.x);
  assert.equal(hullsAfter.lib.y, hullsBefore.lib.y);
});

test('Code folder centers space hulls like Graph and park leftover nodes', () => {
  const centers = graphFolderCenters(['src', 'lib', 'test', 'docs'], 800, 600, { minCellW: 660, minCellH: 360 });
  assert.ok(centers.src);
  assert.ok(centers.lib);
  assert.ok(Math.abs(centers.src.x - centers.lib.x) >= 200 || Math.abs(centers.src.y - centers.lib.y) >= 200);
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 10, y: 10 },
    { id: 'lib/b.js', folder: 'lib', x: 10, y: 10 }
  ];
  parkLeftoverCodeNodes(nodes, new Set(), centers);
  assert.equal(nodes[0].x, centers.src.x);
  assert.equal(nodes[1].x, centers.lib.x);
  const pinned = { id: 'src/c.js', folder: 'src', x: 12, y: 14, fx: 12, fy: 14 };
  parkLeftoverCodeNodes([pinned], new Set(), centers);
  assert.equal(pinned.x, 12);
});

test('leftover Code nodes in one folder spread instead of stacking', () => {
  const grid = leftoverCodeNodeGrid(4, 56);
  assert.equal(grid.length, 4);
  assert.equal(grid[0].x, grid[1].x - 56);
  const seen = new Set(grid.map((p) => p.x + ',' + p.y));
  assert.equal(seen.size, 4);
  const centers = { src: { x: 400, y: 300 } };
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 10, y: 10 },
    { id: 'src/b.js', folder: 'src', x: 10, y: 10 },
    { id: 'src/c.js', folder: 'src', x: 10, y: 10 }
  ];
  parkLeftoverCodeNodes(nodes, new Set(), centers);
  const spots = new Set(nodes.map((n) => n.x + ',' + n.y));
  assert.equal(spots.size, 3);
  assert.ok(nodes.every((n) => Math.abs(n.x - 400) < 80 && Math.abs(n.y - 300) < 80));
  assert.equal(nodes[0].fx, nodes[0].x);
});

test('same-folder leftover siblings translate together', () => {
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 100, y: 80, fx: 100, fy: 80 },
    { id: 'src/b.js', folder: 'src', x: 160, y: 80, fx: 160, fy: 80 },
    { id: 'lib/c.js', folder: 'lib', x: 400, y: 80, fx: 400, fy: 80 },
    { id: 'src/card.js', folder: 'src', x: 200, y: 200, fx: 200, fy: 200 }
  ];
  const cards = new Set(['src/card.js']);
  const siblings = translateCodeViewSiblings(nodes, nodes[0], 40, -10, cards);
  assert.equal(siblings.length, 1);
  assert.equal(siblings[0].id, 'src/b.js');
  assert.equal(nodes[1].x, 200);
  assert.equal(nodes[1].y, 70);
  assert.equal(nodes[2].x, 400);
  assert.equal(nodes[3].x, 200);
});

test('last-dragged Code card wins the stack order', () => {
  assert.deepEqual(J(raiseCodeCardStack(['a.js', 'b.js'], 'a.js')), ['b.js', 'a.js']);
  assert.equal(codeCardZIndex(['b.js', 'a.js'], 'a.js'), 3);
  assert.equal(codeCardZIndex(['b.js', 'a.js'], 'b.js'), 2);
  assert.equal(codeCardZIndex(['b.js', 'a.js'], 'missing.js'), 1);
  const a = { getAttribute: () => 'a.js', style: {} };
  const b = { getAttribute: () => 'b.js', style: {} };
  const layer = { querySelectorAll: () => [a, b] };
  assert.equal(applyCodeCardStackOrder(layer, ['b.js', 'a.js']), 2);
  assert.equal(a.style.zIndex, '3');
  assert.equal(b.style.zIndex, '2');
});

test('dropped Code cards bump off other cards and leftover hulls move aside', () => {
  const sizes = {
    'src/a.js': { width: 200, height: 120 },
    'src/b.js': { width: 200, height: 120 }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  const stacked = [
    { id: 'src/a.js', folder: 'src', x: 100, y: 80, fx: 100, fy: 80 },
    { id: 'src/b.js', folder: 'src', x: 110, y: 85, fx: 110, fy: 85 }
  ];
  bumpOverlappingCodeCards(stacked, 'src/b.js', cards, sizes, 20);
  const aBox = nodeWorldBox(stacked[0], sizes['src/a.js']);
  const bBox = nodeWorldBox(stacked[1], sizes['src/b.js']);
  assert.equal(boxesOverlap(aBox, bBox, 20), false);

  const buried = [
    { id: 'src/card.js', folder: 'src', x: 200, y: 200, fx: 200, fy: 200 },
    { id: 'src/left.js', folder: 'src', x: 200, y: 200, fx: 200, fy: 200 },
    { id: 'src/also.js', folder: 'src', x: 220, y: 200, fx: 220, fy: 200 }
  ];
  const cardPaths = new Set(['src/card.js']);
  const cardSizes = { 'src/card.js': { width: 200, height: 140 } };
  settleCodeViewAfterDrag(buried, cardPaths, cardSizes, 'src/card.js');
  const cardBox = cardWorldBox(buried[0], cardSizes);
  buried.slice(1).forEach((node) => {
    const leftover = { x: node.x - 16, y: node.y - 16, width: 32, height: 32 };
    assert.equal(boxesOverlap(cardBox, leftover, 20), false);
  });
  assert.ok(Math.abs(buried[1].x - buried[2].x) >= 20 || Math.abs(buried[1].y - buried[2].y) >= 20);

  const tall = [
    { id: 'src/big.js', folder: 'src', x: 200, y: 400, fx: 200, fy: 400 },
    { id: 'src/under.js', folder: 'src', x: 200, y: 900, fx: 200, fy: 900 }
  ];
  const tallSizes = { 'src/big.js': { width: 200, height: 1200 } };
  const tallCards = new Set(['src/big.js']);
  settleCodeViewAfterDrag(tall, tallCards, tallSizes, 'src/big.js');
  const tallBox = cardWorldBox(tall[0], tallSizes);
  const under = { x: tall[1].x - 16, y: tall[1].y - 16, width: 32, height: 32 };
  assert.equal(boxesOverlap(tallBox, under, 20), false);
  assert.ok(leftoverHullObstacles(tall, tallCards).length >= 1);
});

test('cardWorldBox keeps snapshot size but follows a live node after bump', () => {
  const node = { id: 'src/b.js', x: 321, y: 50, fx: 321, fy: 50 };
  const sizes = { 'src/b.js': { width: 180, height: 90 } };
  const stale = { 'src/b.js': { x: 120, y: 0, width: 200, height: 100 } };
  const live = cardWorldBox(node, sizes, stale);
  assert.deepEqual(J(live), { x: 221, y: 0, width: 200, height: 100 });
  const same = cardWorldBox(node, sizes, {
    'src/b.js': { x: 221, y: 0, width: 200, height: 100 }
  });
  assert.deepEqual(J(same), { x: 221, y: 0, width: 200, height: 100 });
});

test('settleCodeViewAfterDrag uses bumped card coords when boxesByPath is stale', () => {
  const sizes = {
    'src/a.js': { width: 200, height: 100 },
    'src/b.js': { width: 200, height: 100 }
  };
  const cards = new Set(['src/a.js', 'src/b.js']);
  const cardA = { id: 'src/a.js', folder: 'src', x: 100, y: 50, fx: 100, fy: 50 };
  const cardB = { id: 'src/b.js', folder: 'src', x: 220, y: 50, fx: 220, fy: 50 };
  const leftover = { id: 'lib/c.js', folder: 'lib', x: 450, y: 50, fx: 450, fy: 50 };
  const staleBoxes = {
    'src/a.js': { x: 0, y: 0, width: 200, height: 100 },
    'src/b.js': { x: 120, y: 0, width: 200, height: 100 }
  };
  const leftoverStartBox = { x: leftover.x - 22, y: leftover.y - 22, width: 44, height: 44 };
  assert.equal(boxesOverlap(staleBoxes['src/b.js'], leftoverStartBox, 40), false);
  const beforeB = { x: cardB.x, y: cardB.y };
  settleCodeViewAfterDrag([cardA, cardB, leftover], cards, sizes, 'src/b.js', {
    boxesByPath: staleBoxes,
    cardGap: 20,
    hullPad: 40,
    nodePad: 48
  });
  assert.notDeepEqual({ x: cardB.x, y: cardB.y }, beforeB);
  const bumpedBox = nodeWorldBox(cardB, sizes['src/b.js']);
  const leftoverBox = { x: leftover.x - 22, y: leftover.y - 22, width: 44, height: 44 };
  assert.equal(boxesOverlap(bumpedBox, leftoverBox, 0), false);
});

test('leftoverSpatialCellKey buckets leftover centers into coarse cells', () => {
  assert.equal(leftoverSpatialCellKey(10, 10, 40), '0\t0');
  assert.equal(leftoverSpatialCellKey(39.9, 0, 40), '0\t0');
  assert.equal(leftoverSpatialCellKey(40, 0, 40), '1\t0');
  assert.equal(leftoverSpatialCellKey(-1, -1, 40), '-1\t-1');
});

test('leftoverSeparationBuckets groups leftover nodes by spatial cell', () => {
  const leftovers = [
    { id: 'a', x: 5, y: 5 },
    { id: 'b', x: 8, y: 6 },
    { id: 'c', x: 80, y: 5 }
  ];
  const buckets = leftoverSeparationBuckets(leftovers, 40);
  assert.deepEqual(J(buckets['0\t0']), [0, 1]);
  assert.deepEqual(J(buckets['2\t0']), [2]);
});

test('leftoverSeparationNeighbors pushes only overlapping leftover pairs', () => {
  const a = { id: 'src/a.js', x: 100, y: 80, fx: 100, fy: 80 };
  const b = { id: 'src/b.js', x: 102, y: 80, fx: 102, fy: 80 };
  const far = { id: 'lib/far.js', x: 800, y: 80, fx: 800, fy: 80 };
  assert.equal(leftoverSeparationNeighbors(a, b, 36), true);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 36);
  assert.equal(leftoverSeparationNeighbors(a, far, 36), false);
  assert.equal(far.x, 800);
});

test('separateLeftoverCodeNodes still separates nearby leftovers after spatial bucketing', () => {
  const a = { id: 'src/a.js', folder: 'src', x: 100, y: 80, fx: 100, fy: 80 };
  const b = { id: 'src/b.js', folder: 'src', x: 102, y: 80, fx: 102, fy: 80 };
  const far = { id: 'lib/far.js', folder: 'lib', x: 800, y: 80, fx: 800, fy: 80 };
  separateLeftoverCodeNodes([a, b, far], new Set(), 36);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 36);
  assert.equal(far.x, 800);
  assert.equal(far.y, 80);
});

test('separateLeftoverCodeNodes leaves a sparse leftover field in place', () => {
  const leftovers = [];
  for (let col = 0; col < 8; col += 1) {
    leftovers.push({ id: `src/n${col}.js`, folder: 'src', x: col * 200, y: 40, fx: col * 200, fy: 40 });
  }
  const before = leftovers.map((node) => ({ x: node.x, y: node.y }));
  separateLeftoverCodeNodes(leftovers, new Set(), 36);
  leftovers.forEach((node, index) => {
    assert.equal(node.x, before[index].x);
    assert.equal(node.y, before[index].y);
  });
});

test('expensive Code layout waits until drag release', () => {
  assert.equal(codeViewDragRefresh('move'), false);
  assert.equal(codeViewDragRefresh('release'), true);
  assert.equal(codeViewDragRefresh('start'), false);
  const card = {
    getAttribute: () => 'src/a.js',
    style: { left: '0px', top: '0px' }
  };
  const layer = { querySelectorAll: () => [card] };
  assert.equal(applyCodeCardDragFrame(layer, 'src/a.js', { x: 400, y: 300 }, { width: 200, height: 100 }), true);
  assert.equal(card.style.left, '300px');
  assert.equal(card.style.top, '250px');
});

test('Code cards can be resized from the right or bottom edge', () => {
  const base = codeCardSize({ content: 'const x = 1;\n' });
  const grown = applyCodeCardUserSize(base, { width: 620, height: 280 });
  assert.equal(grown.width, 620);
  assert.equal(grown.height, 280);
  const file = { path: 'src/app.js', content: 'a\nb\nc\n' };
  const rows = codeCardDiffRows(file, 'a\nb\nc\n' + 'x\n'.repeat(20));
  const expand = codeCardSizeForDiff(file, { expand: true, wrap: true }, rows);
  const short = applyCodeCardUserSize(expand, { width: expand.width, height: 180 });
  assert.ok(expand.height > 180);
  assert.equal(short.height, 180);
  assert.equal(short.clipped, true);
  assert.equal(expand.clipped, false);
  const resizeCard = { style: {}, classList: { names: new Set(), add(name) { resizeCard.classList.names.add(name); }, remove(name) { resizeCard.classList.names.delete(name); } } };
  assert.equal(applyCodeCardResizeFrame(resizeCard, short), true);
  assert.equal(resizeCard.style.height, '180px');
  assert.ok(resizeCard.classList.names.has('clipped'));
  applyCodeCardResizeFrame(resizeCard, expand);
  assert.equal(resizeCard.classList.names.has('clipped'), false);
  const clamped = clampCodeCardResize(80, 40, {});
  assert.equal(clamped.width, CODE_CARD_MIN_WIDTH);
  assert.equal(clamped.height, CODE_CARD_MIN_HEIGHT);
  const delta = codeCardResizeDelta(140, 160, 100, 100, 440, 200, 1, 'se');
  assert.equal(delta.width, 480);
  assert.equal(delta.height, 260);
  const east = codeCardResizeDelta(140, 160, 100, 100, 440, 200, 1, 'e');
  assert.equal(east.width, 480);
  assert.equal(east.height, 200);
});

test('Code camera fits only when it has not been armed yet', () => {
  assert.equal(shouldFitCodeCamera(false, 'code'), true);
  assert.equal(shouldFitCodeCamera(true, 'code'), false);
  assert.equal(shouldFitCodeCamera(false, 'graph'), false);
  assert.equal(clampCodeViewFitScale(0.05), CODE_VIEW_MIN_FIT_SCALE);
  assert.equal(clampCodeViewFitScale(8), CODE_VIEW_MAX_FIT_SCALE);
  assert.equal(clampCodeViewFitScale(0.7), 0.7);
});

test('hydrating file contents does not change the graph structure key', () => {
  const before = {
    files: [{ path: 'a.js' }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  const after = {
    files: [{ path: 'a.js', content: 'export function a(){}' }, { path: 'b.js', content: 'import { a } from "./a.js"' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  assert.equal(graphStructureKey(before, null), graphStructureKey(after, null));
  assert.notEqual(graphStructureKey(before, null), graphStructureKey(before, 'src'));
  const swapped = {
    files: [{ path: 'a.js' }, { path: 'b.js' }],
    connections: [{ source: 'b.js', target: 'a.js' }]
  };
  const heavier = {
    files: [{ path: 'a.js' }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js', count: 4 }]
  };
  assert.notEqual(graphStructureKey(before, null), graphStructureKey(swapped, null));
  assert.notEqual(graphStructureKey(before, null), graphStructureKey(heavier, null));
  assert.equal(
    codeViewSceneKey(before, null, 'code'),
    codeViewSceneKey(after, null, 'code')
  );
  assert.notEqual(
    codeViewSceneKey(before, null, 'code'),
    codeViewSceneKey(swapped, null, 'code')
  );
  assert.notEqual(
    codeViewSceneKey(before, null, 'code', { sourceType: 'github', sourceKey: 'owner/alpha' }),
    codeViewSceneKey(before, null, 'code', { sourceType: 'github', sourceKey: 'owner/beta' })
  );
  assert.notEqual(
    analysisHydrationId({ sourceType: 'github', sourceKey: 'owner/alpha' }, before, null),
    analysisHydrationId({ sourceType: 'github', sourceKey: 'owner/beta' }, before, null)
  );
  const source = { sourceType: 'github', sourceKey: 'owner/repo' };
  assert.equal(analysisHydrationId(source, before, null), analysisHydrationId(source, before, 'src'));
  assert.equal(analysisGraphKey(before), analysisGraphKey(after));
  assert.notEqual(
    codeViewSceneKey(before, null, 'code', source),
    codeViewSceneKey(before, 'src', 'code', source)
  );
  const moved = {
    files: [{ path: 'a.js', folder: 'src', layer: 'utils', churn: 0, functions: [] }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  const restyled = {
    files: [{ path: 'a.js', folder: 'lib', layer: 'ui', churn: 3, functions: [{ name: 'a' }] }, { path: 'b.js' }],
    connections: [{ source: 'a.js', target: 'b.js' }]
  };
  assert.notEqual(graphStructureKey(moved, null), graphStructureKey(restyled, null));
  assert.equal(
    fileGraphIdentity({ path: 'a.js', content: 'x', folder: 'src', layer: 'utils', functions: [] }),
    fileGraphIdentity({ path: 'a.js', content: 'y', folder: 'src', layer: 'utils', functions: [] })
  );
});

test('preserved graph nodes keep the user camera positions', () => {
  const nodes = [{ id: 'a.js', x: 0, y: 0 }, { id: 'b.js', x: 1, y: 1 }];
  preserveGraphNodeState(nodes, { 'a.js': { x: 40, y: 80, fx: 40, fy: 80 } });
  assert.equal(nodes[0].x, 40);
  assert.equal(nodes[0].fx, 40);
  assert.equal(nodes[1].x, 1);
});

test('code cards sit on the canvas transform, not a split pane', () => {
  assert.ok(codeCardCollisionRadius({ width: 320, height: 220 }) > 100);
  assert.equal(codeCanvasTransformStyle({ k: 0.5, x: 10, y: 20 }), 'translate(10px,20px) scale(0.5)');
  assert.deepEqual(J(codeCardAnchorStyle({ x: 400, y: 300 }, { width: 320, height: 220 })), {
    visibility: 'visible',
    left: '240px',
    top: '190px'
  });
  const title = { style: {} };
  const card = {
    getAttribute(name) { return name === 'data-code-card' ? 'a.js' : null; },
    style: {},
    classList: { add() {}, remove() {} },
    querySelector() { return title; }
  };
  const layer = {
    style: {},
    querySelectorAll() { return [card]; }
  };
  const sizes = { 'a.js': { width: 380, height: 280 } };
  const placed = applyCodeCardLayout(layer, { 'a.js': { x: 400, y: 300 } }, { k: 0.5, x: 12, y: 8 }, sizes);
  assert.equal(placed.placed, 1);
  assert.equal(placed.titleScale, 2);
  assert.equal(layer.style.transform, 'translate(12px,8px) scale(0.5)');
  assert.equal(card.style.left, '210px');
  assert.equal(title.style.transform, 'scale(2)');
});

test('recent delete requires a second confirm click', () => {
  assert.deepEqual(J(armRecentDelete(null, 'github:owner/repo')), { confirm: false, armedId: 'github:owner/repo' });
  assert.deepEqual(J(armRecentDelete('github:owner/repo', 'github:owner/repo')), { confirm: true, armedId: null });
  assert.deepEqual(J(armRecentDelete('github:owner/repo', 'zip:other')), { confirm: false, armedId: 'zip:other' });
});

test('cache keys and records stay stable', () => {
  assert.equal(analysisCacheKey('github', 'braedonsaunders/codeflow'), 'github:braedonsaunders/codeflow');
  const record = buildRecentAnalysisRecord({
    sourceType: 'github',
    sourceKey: 'owner/repo',
    title: 'owner/repo',
    data: { files: [{ path: 'a.js' }] }
  });
  assert.equal(record.id, 'github:owner/repo');
  assert.equal(record.fileCount, 1);
  assert.ok(record.savedAt > 0);
});

test('github zip URL is a user-chosen download, not a hidden clone', () => {
  assert.equal(
    githubZipDownloadUrl('braedonsaunders', 'codeflow'),
    'https://github.com/braedonsaunders/codeflow/archive/HEAD.zip'
  );
});

test('CLI path helper rejects traversal', () => {
  assert.equal(resolveSafeCliPath('/tmp/proj', '../etc/passwd'), null);
  assert.equal(resolveSafeCliPath('/tmp/proj', '/etc/passwd'), null);
  assert.equal(resolveSafeCliPath('/tmp/proj', 'src/app.js'), '/tmp/proj/src/app.js');
});

test('folder cache keys differ per selected directory', () => {
  const samePaths = ['src/app.js', 'src/math.js'];
  const a = localFolderCacheMeta({ title: 'project', paths: samePaths, selectionId: 'sel-a' });
  const b = localFolderCacheMeta({ title: 'project', paths: samePaths, selectionId: 'sel-b' });
  const again = localFolderCacheMeta({ title: 'project', paths: samePaths, selectionId: 'sel-a' });
  assert.equal(a.title, 'project');
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.equal(a.sourceKey, again.sourceKey);
  assert.equal(analysisCacheKey('folder', a.sourceKey), 'folder:' + a.sourceKey);
});

test('CLI re-analyze only matches the active watch root', () => {
  const record = { sourceType: 'cli', sourceKey: '/tmp/alpha' };
  assert.equal(cliRecordMatchesStatus(record, { ok: true, root: '/tmp/alpha' }), true);
  assert.equal(cliRecordMatchesStatus(record, { ok: true, root: '/tmp/beta' }), false);
  assert.equal(cliRecordMatchesStatus(record, null), false);
});

test('retained ZIP only matches its own recent record', () => {
  const recordA = { sourceType: 'zip', sourceKey: 'main.zip|100|10|1|src/app.js' };
  const recordB = { sourceType: 'zip', sourceKey: 'main.zip|200|20|1|src/app.js' };
  assert.equal(retainedZipMatchesRecord(recordA, { identity: 'main.zip|100|10' }), true);
  assert.equal(retainedZipMatchesRecord(recordB, { identity: 'main.zip|100|10' }), false);
  assert.equal(retainedZipMatchesRecord(recordA, { sourceKey: recordA.sourceKey }), true);
});

test('GitHub cache keys include the exclude pattern set', () => {
  const none = githubCacheSourceKey('owner', 'repo', []);
  const tests = githubCacheSourceKey('owner', 'repo', [{ raw: 'tests/**' }]);
  const vendor = githubCacheSourceKey('owner', 'repo', ['vendor/**']);
  assert.equal(none, 'owner/repo');
  assert.notEqual(none, tests);
  assert.notEqual(tests, vendor);
  assert.equal(cachedAnalysisMatchesExcludes({ sourceKey: tests, data: { excludePatterns: ['tests/**'] } }, [{ raw: 'tests/**' }]), true);
  assert.equal(cachedAnalysisMatchesExcludes({ sourceKey: tests, data: { excludePatterns: ['tests/**'] } }, [{ raw: 'vendor/**' }]), false);
  assert.equal(analysisCacheKey('github', tests), 'github:' + tests);
});

test('loaded GitHub identity uses applied exclusions, not pending edits', () => {
  const loaded = { files: [{ path: 'src/a.js', name: 'a.js' }], connections: [], excludePatterns: ['tests/**'] };
  const pending = ['vendor/**'];
  const fromLoaded = githubSourceKeyForLoadedAnalysis('owner', 'repo', loaded, pending);
  const fromPending = githubSourceKeyForLoadedAnalysis('owner', 'repo', null, pending);
  const appliedKey = githubCacheSourceKey('owner', 'repo', ['tests/**']);
  const pendingKey = githubCacheSourceKey('owner', 'repo', pending);
  assert.equal(fromLoaded, appliedKey);
  assert.notEqual(fromLoaded, pendingKey);
  assert.equal(fromPending, pendingKey);
  assert.equal(
    githubSourceKeyForLoadedAnalysis('owner', 'repo', { excludePatterns: [] }, pending),
    githubCacheSourceKey('owner', 'repo', [])
  );
  const graph = analysisGraphKey(loaded);
  const before = loadedAnalysisSourceIdentity({
    githubOwner: 'owner',
    githubRepo: 'repo',
    githubKey: fromLoaded
  });
  const afterEdit = loadedAnalysisSourceIdentity({
    githubOwner: 'owner',
    githubRepo: 'repo',
    githubKey: githubSourceKeyForLoadedAnalysis('owner', 'repo', loaded, ['docs/**'])
  });
  assert.equal(
    analysisHydrationIdFromParts(before, graph),
    analysisHydrationIdFromParts(afterEdit, graph)
  );
});

test('CLI cache keys use the watched root instead of a shared fallback', () => {
  const a = cliWatchCacheMeta({ ok: true, root: '/tmp/alpha', name: 'alpha' });
  const b = cliWatchCacheMeta({ ok: true, root: '/tmp/beta', name: 'beta' });
  const missing = cliWatchCacheMeta(null);
  assert.equal(a.sourceKey, '/tmp/alpha');
  assert.equal(a.title, 'alpha');
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.equal(missing.sourceKey, 'cli');
  assert.equal(analysisCacheKey('cli', a.sourceKey), 'cli:/tmp/alpha');
});

test('ZIP cache keys include archive metadata, not only the filename', () => {
  const a = zipArchiveCacheMeta({ name: 'main.zip', size: 100, lastModified: 10, paths: ['repo-a/src/app.js'] });
  const b = zipArchiveCacheMeta({ name: 'main.zip', size: 200, lastModified: 20, paths: ['repo-b/src/app.js'] });
  const sameNameDifferentPaths = zipArchiveCacheMeta({ name: 'main.zip', size: 100, lastModified: 10, paths: ['other/src/app.js'] });
  assert.equal(a.title, 'main.zip');
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.notEqual(a.sourceKey, sameNameDifferentPaths.sourceKey);
  assert.equal(analysisCacheKey('zip', a.sourceKey), 'zip:' + a.sourceKey);
});

test('retained folder handle only matches its own recent record', () => {
  const recordA = { sourceType: 'folder', sourceKey: 'alpha|1|src/app.js' };
  const recordB = { sourceType: 'folder', sourceKey: 'beta|1|src/app.js' };
  assert.equal(retainedFolderMatchesRecord(recordA, { sourceKey: recordA.sourceKey }), true);
  assert.equal(retainedFolderMatchesRecord(recordB, { sourceKey: recordA.sourceKey }), false);
  assert.equal(retainedFolderMatchesRecord(null, { sourceKey: recordA.sourceKey }), true);
});

test('compactAnalysisForCache drops raw source and keeps graph metadata', () => {
  const compact = compactAnalysisForCache({
    files: [{
      path: 'src/a.js',
      name: 'a.js',
      language: 'javascript',
      lines: 3,
      size: 40,
      content: 'function hello(){ return 1; }\n',
      functions: [{ name: 'hello', line: 1, code: 'function hello(){ return 1; }' }],
      deadFunctions: [{ name: 'unused', line: 2, code: 'function unused(){}' }],
      securityIssues: [{ type: 'eval', line: 1, code: 'eval(x)' }],
      connections: [{ from: 'hello', to: 'other' }]
    }],
    functions: [{ name: 'hello', file: 'src/a.js', line: 1, code: 'function hello(){ return 1; }' }],
    deadFunctions: [{ name: 'unused', file: 'src/a.js', line: 2, code: 'function unused(){}' }],
    connections: [{ source: 'src/a.js', target: 'src/b.js', fn: 'hello' }],
    issues: [{ title: 'Unused Functions', items: [{ name: 'unused', file: 'src/a.js', line: 2, code: 'function unused(){}' }] }],
    securityIssues: [{ title: 'eval', file: 'src/a.js', code: 'eval(x)' }],
    fnStats: { hello: { name: 'hello', file: 'src/a.js', code: 'function hello(){ return 1; }' } }
  });
  assert.equal(Object.prototype.hasOwnProperty.call(compact.files[0], 'content'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.files[0].functions[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.functions[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.deadFunctions[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.issues[0].items[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.securityIssues[0], 'code'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compact.fnStats.hello, 'code'), false);
  assert.equal(compact.files[0].path, 'src/a.js');
  assert.equal(compact.files[0].functions[0].name, 'hello');
  assert.equal(compact.files[0].functions[0].line, 1);
  assert.equal(compact.files[0].size, 40);
  assert.deepEqual(J(compact.connections), [{ source: 'src/a.js', target: 'src/b.js', fn: 'hello' }]);
  assert.equal(compact.issues[0].title, 'Unused Functions');
});

test('hydrated sources stay in memory and are not treated as cached source', () => {
  const cached = { files: [{ path: 'src/a.js', name: 'a.js', functions: [{ name: 'hello', line: 1 }] }] };
  assert.equal(analysisFileNeedsSource(cached.files[0]), true);
  const merged = mergeHydratedFileSources(cached, [{ path: 'src/a.js', content: 'export function hello(){ return 1; }\n' }]);
  assert.equal(merged.files[0].content.includes('hello'), true);
  assert.equal(fileSourceDisplayState(cached.files[0], true), 'loading');
  assert.equal(fileSourceDisplayState(merged.files[0], true), 'ready');
  assert.equal(fileSourceDisplayState({ path: 'big.js', analysisSkipped: 'oversized' }, false), 'skipped');
  assert.equal(fileSourceDisplayState({ path: 'src/a.js' }, false), 'unavailable');
  assert.equal(fileSourceDisplayState(cached.files[0], true, { 'src/a.js': true }), 'failed');
});

test('empty source files count as loaded after hydration', () => {
  const cached = { files: [{ path: 'src/empty.js', name: 'empty.js' }] };
  assert.equal(fileHasLoadedSource(cached.files[0]), false);
  assert.equal(fileSourceDisplayState(cached.files[0], true), 'loading');
  const merged = mergeHydratedFileSources(cached, [{ path: 'src/empty.js', content: '' }]);
  assert.equal(merged.files[0].content, '');
  assert.equal(fileHasLoadedSource(merged.files[0]), true);
  assert.equal(analysisFileNeedsSource(merged.files[0]), false);
  assert.equal(fileSourceDisplayState(merged.files[0], true), 'ready');
});

test('obsolete hydration results do not replace a new analysis file', () => {
  const repoA = { sourceType: 'github', sourceKey: 'owner/alpha' };
  const repoB = { sourceType: 'github', sourceKey: 'owner/beta' };
  const data = { files: [{ path: 'src/index.js', name: 'index.js' }], connections: [] };
  const idA = analysisHydrationId(repoA, data, null);
  const idB = analysisHydrationId(repoB, data, null);
  assert.notEqual(idA, idB);
  assert.equal(hydratedSourceIsCurrent({ path: 'src/index.js', content: 'A', hydrationId: idA }, idB), false);
  const rejected = mergeHydratedFileSources(data, [{ path: 'src/index.js', content: 'from-alpha', hydrationId: idA }], idB);
  assert.equal(Object.prototype.hasOwnProperty.call(rejected.files[0], 'content'), false);
  const accepted = mergeHydratedFileSources(data, [{ path: 'src/index.js', content: 'from-beta', hydrationId: idB }], idB);
  assert.equal(accepted.files[0].content, 'from-beta');
});

test('obsolete source failures do not mark a new analysis path as failed', () => {
  const repoA = { sourceType: 'github', sourceKey: 'owner/alpha' };
  const repoB = { sourceType: 'github', sourceKey: 'owner/beta' };
  const data = { files: [{ path: 'src/index.js', name: 'index.js' }], connections: [] };
  const idA = analysisHydrationId(repoA, data);
  const idB = analysisHydrationId(repoB, data);
  assert.equal(hydrationRequestIsCurrent(idA, idB), false);
  assert.equal(hydrationRequestIsCurrent(idB, idB), true);
  const stale = recordCodeSourceFailureIfCurrent(null, 'src/index.js', idA, idB);
  assert.equal(Object.keys(stale).length, 0);
  const current = recordCodeSourceFailureIfCurrent(null, 'src/index.js', idB, idB);
  assert.equal(current['src/index.js'], true);
  const kept = clearCodeSourceFailureIfCurrent(current, 'src/index.js', idA, idB);
  assert.equal(kept['src/index.js'], true);
  const cleared = clearCodeSourceFailureIfCurrent(current, 'src/index.js', idB, idB);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared, 'src/index.js'), false);
});

test('symbol pills track scroll and hide when clipped away', () => {
  const visible = codeCardPillViewTop(80, 0, 400, 42);
  assert.equal(visible, 80);
  assert.equal(codeCardPillViewTop(80, 20, 400, 42), 60);
  assert.equal(codeCardPillViewTop(2000, 0, 1840, 42), null);
  assert.equal(codeCardPillViewTop(2000, 1600, 1840, 42), 400);
  assert.equal(codeCardPillViewTop(30, 0, 400, 42), null);
});

test('selection reads the live body scrollTop of a previously scrolled card', () => {
  const layer = {
    querySelectorAll(sel) {
      if (sel !== '[data-code-card]') return [];
      return [
        {
          getAttribute(name) { return name === 'data-code-card' ? 'src/other.js' : null; },
          querySelector() { return { scrollTop: 999 }; }
        },
        {
          getAttribute(name) { return name === 'data-code-card' ? 'src/app.js' : null; },
          querySelector(sel) { return sel === '.code-card-body' ? { scrollTop: 240 } : null; }
        }
      ];
    }
  };
  assert.equal(readCodeCardBodyScroll(layer, 'src/app.js'), 240);
  assert.equal(readCodeCardBodyScroll(layer, 'src/missing.js'), 0);
  assert.equal(readCodeCardBodyScroll(null, 'src/app.js'), 0);
  assert.equal(readCodeCardBodyScroll(layer, ''), 0);
});

test('hydration IDs follow the loaded analysis, not a live CLI session', () => {
  const data = { files: [{ path: 'src/index.js', name: 'index.js' }], connections: [] };
  const graph = analysisGraphKey(data);
  const watchingGithub = {
    localSourceKind: null,
    cliOk: true,
    cliRoot: '/watch',
    githubOwner: 'owner',
    githubRepo: 'alpha',
    githubKey: 'owner/alpha'
  };
  const alpha = loadedAnalysisSourceIdentity(watchingGithub);
  const beta = loadedAnalysisSourceIdentity(Object.assign({}, watchingGithub, {
    githubRepo: 'beta',
    githubKey: 'owner/beta'
  }));
  assert.equal(alpha.sourceType, 'github');
  assert.equal(alpha.sourceKey, 'owner/alpha');
  assert.equal(beta.sourceKey, 'owner/beta');
  assert.notEqual(
    analysisHydrationIdFromParts(alpha, graph),
    analysisHydrationIdFromParts(beta, graph)
  );
  const cli = loadedAnalysisSourceIdentity({
    localSourceKind: 'cli',
    cliOk: true,
    cliRoot: '/watch',
    githubOwner: 'owner',
    githubRepo: 'alpha',
    githubKey: 'owner/alpha'
  });
  assert.equal(cli.sourceType, 'cli');
  assert.equal(cli.sourceKey, '/watch');
});

test('symbol list wheel stays native instead of panning the canvas', () => {
  const list = { closest(sel) { return sel === '.code-sym-list' ? this : null; } };
  const chip = { closest(sel) { return sel === '.code-sym-list' ? list : null; } };
  const body = { closest(sel) { return sel === '.code-card.clipped .code-card-body' ? this : null; } };
  const canvas = { closest() { return null; } };
  assert.equal(isCodeCanvasNativeScrollTarget(list), true);
  assert.equal(isCodeCanvasNativeScrollTarget(chip), true);
  assert.equal(isCodeCanvasNativeScrollTarget(body), true);
  assert.equal(isCodeCanvasNativeScrollTarget(canvas), false);
  assert.equal(isCodeCanvasNativeScrollTarget(null), false);
});

test('modifier-wheel over a clipped card still zooms the canvas', () => {
  const body = { closest(sel) { return sel === '.code-card.clipped .code-card-body' ? this : null; } };
  const list = { closest(sel) { return sel === '.code-sym-list' ? this : null; } };
  const canvas = { closest() { return null; } };
  assert.equal(codeViewWheelUsesNativeScroll({}, body), true);
  assert.equal(codeViewWheelUsesNativeScroll({ ctrlKey: true }, body), false);
  assert.equal(codeViewWheelUsesNativeScroll({ metaKey: true }, body), false);
  assert.equal(codeViewWheelUsesNativeScroll({}, list), true);
  assert.equal(codeViewWheelUsesNativeScroll({ ctrlKey: true }, list), false);
  assert.equal(codeViewWheelUsesNativeScroll({ ctrlKey: true }, canvas), false);
  assert.equal(codeViewWheelUsesNativeScroll({}, canvas), false);
  assert.equal(codeViewWheelAction({ ctrlKey: true }), 'zoom');
  assert.equal(codeViewWheelAction({ metaKey: true }), 'zoom');
});

test('far-zoom clipped cards let unmodified wheel pan the canvas', () => {
  const farBody = {
    closest(sel) {
      if (sel === '.code-card.clipped .code-card-body') return this;
      if (sel === '.code-card.code-far') return this;
      return null;
    }
  };
  const nearBody = { closest(sel) { return sel === '.code-card.clipped .code-card-body' ? this : null; } };
  assert.equal(isCodeCanvasNativeScrollTarget(farBody), false);
  assert.equal(codeViewWheelUsesNativeScroll({}, farBody), false);
  assert.equal(codeViewWheelUsesNativeScroll({}, nearBody), true);
  assert.equal(codeViewWheelAction({}), 'pan');
});

test('folder frames count as canvas background for deselect', () => {
  const svg = { id: 'svg' };
  const hull = {
    getAttribute(name) { return name === 'data-code-bg' ? '1' : null; },
    closest(sel) { return sel === '[data-code-bg="1"]' ? this : null; }
  };
  const hullChild = {
    getAttribute() { return null; },
    closest(sel) { return sel === '[data-code-bg="1"]' ? hull : null; }
  };
  const node = {
    getAttribute() { return null; },
    closest() { return null; }
  };
  assert.equal(isCodeCanvasDeselectTarget(svg, svg), true);
  assert.equal(isCodeCanvasDeselectTarget(hull, svg), true);
  assert.equal(isCodeCanvasDeselectTarget(hullChild, svg), true);
  assert.equal(isCodeCanvasDeselectTarget(node, svg), false);
  assert.equal(isCodeCanvasDeselectTarget(null, svg), false);
  assert.equal(isCodeCanvasDeselectTarget(svg, null), false);
});

test('empty code cards always render from an array of lines', () => {
  assert.deepEqual(J(asCodeLines('')), ['']);
  assert.deepEqual(J(asCodeLines(null)), ['']);
  assert.deepEqual(J(asCodeLines([])), ['']);
  assert.deepEqual(J(asCodeLines(['const x = 1;'])), ['const x = 1;']);
});

test('CLI watch paths stay unique and only flush analyzed files', () => {
  assert.equal(normalizeCliWatchPath('\\src\\app.js'), 'src/app.js');
  assert.deepEqual(J(noteCliWatchPath([], 'src/app.js')), ['src/app.js']);
  assert.deepEqual(J(noteCliWatchPath(['src/app.js'], 'src/app.js')), ['src/app.js']);
  assert.deepEqual(J(noteCliWatchPath(['src/app.js'], 'src/math.js')), ['src/app.js', 'src/math.js']);
  const files = [{ path: 'src/app.js', content: 'export const n = 1;\n' }, { path: 'src/math.js', content: '' }];
  assert.deepEqual(J(cliWatchDiffPaths(files, ['src/app.js', 'README.md', 'src/app.js'])), ['src/app.js']);
  const skipped = [{ path: 'src/app.js', content: '', analysisSkipped: 'oversized' }, { path: 'src/math.js', content: 'export const n = 1;\n' }];
  assert.deepEqual(J(cliWatchDiffPaths(skipped, ['src/app.js', 'src/math.js'])), ['src/math.js']);
  assert.equal(fileHasAnalyzedSourceForDiff(skipped[0]), false);
  assert.equal(fileHasAnalyzedSourceForDiff({ path: 'src/gone.js', content: '', analysisSkipped: 'fetch-failed' }), false);
  assert.equal(fileHasAnalyzedSourceForDiff(files[0]), true);
  const live = mergeCliLiveContents(null, [{ path: 'src/app.js', content: 'export const n = 1;\n' }]);
  assert.equal(live['src/app.js'], 'export const n = 1;\n');
  const cleared = mergeCliLiveContents(live, [{ path: 'src/app.js', content: null }]);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared, 'src/app.js'), false);
});

test('line diffs mark added and removed rows for Code cards', () => {
  const before = 'import { add } from "./math.js";\n\nexport function boot() {\n  return add(1, 2);\n}\n';
  const after = 'import { add, double } from "./math.js";\n\nexport function boot() {\n  return double(add(1, 2));\n}\n';
  const rows = J(diffCodeLines(before, after));
  const added = rows.filter((row) => row.type === 'add').map((row) => row.text);
  const removed = rows.filter((row) => row.type === 'del').map((row) => row.text);
  assert.ok(removed.some((line) => line.includes('from "./math.js"')));
  assert.ok(added.some((line) => line.includes('double')));
  assert.ok(removed.some((line) => line.includes('return add(1, 2);')));
  assert.ok(added.some((line) => line.includes('return double(add(1, 2));')));
  assert.ok(rows.some((row) => row.type === 'same' && row.text.includes('export function boot()')));
  const file = { path: 'src/app.js', content: before };
  const painted = J(codeCardDiffRows(file, after));
  assert.ok(codeCardHasDiff(painted));
  assert.equal(codeCardDiffClass({ type: 'add' }), ' diff-add');
  assert.equal(codeCardDiffClass({ type: 'del' }), ' diff-del');
  assert.equal(codeCardDiffClass({ type: 'same' }), '');
  assert.equal(codeCardDiffLineNo({ type: 'add', newLine: 4 }), 4);
  assert.equal(codeCardDiffLineNo({ type: 'del', oldLine: 2 }), 2);
  assert.equal(codeCardDiffRows(file, before), null);
  assert.equal(codeCardDiffRows({ path: 'src/app.js' }, after), null);
  assert.equal(codeCardDiffRows(file, null), null);
  const identical = J(diffCodeLines(before, before));
  assert.ok(identical.every((row) => row.type === 'same'));
  assert.equal(codeCardHasDiff(identical), false);
  const deleted = J(codeCardDiffRows({ path: 'src/app.js', content: 'keep\nme' }, ''));
  assert.ok(deleted.every((row) => row.type === 'del'));
  assert.deepEqual(deleted.map((row) => row.text), ['keep', 'me']);
});

test('diff-aware Code cards clip or grow so the hunk stays reachable', () => {
  const file = { path: 'src/app.js', content: 'a\nb\nc\n' };
  const rows = codeCardDiffRows(file, 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n');
  assert.ok(codeCardHasDiff(rows));
  const scroll = codeCardSizeForDiff(file, { expand: false, wrap: true }, rows);
  const base = codeCardSize(file, { expand: false, wrap: true });
  assert.equal(scroll.height, base.height);
  assert.equal(scroll.clipped, true);
  const expand = codeCardSizeForDiff(file, { expand: true, wrap: true }, rows);
  const painted = codeCardSize(fileForCodeCardDiff(file, rows), { expand: true, wrap: true });
  assert.equal(expand.height, painted.height);
  assert.ok(expand.height > base.height);
  const card = {
    path: file.path,
    classes: new Set(),
    getAttribute(name) { return name === 'data-code-card' ? file.path : null; },
    style: { width: base.width + 'px', height: base.height + 'px' },
    classList: {
      add(name) { card.classes.add(name); },
      remove(name) { card.classes.delete(name); }
    },
    querySelector() { return { style: {} }; }
  };
  applyCodeCardLayout(
    { style: {}, querySelectorAll() { return [card]; } },
    { [file.path]: { x: 40, y: 40 } },
    { k: 1, x: 0, y: 0 },
    { [file.path]: expand }
  );
  assert.equal(card.style.height, expand.height + 'px');
  assert.ok(Number.parseFloat(card.style.height) > base.height);
});

test('symbol pills follow the painted diff row, not the stale analysis line', () => {
  const before = 'function top(){}\n\nfunction bottom(){}\n';
  const after = 'function extra(){}\nfunction top(){}\n\nfunction bottom(){}\n';
  const rows = diffCodeLines(before, after);
  assert.equal(codeCardDiffLineIndex(rows, 1), 2);
  assert.equal(codeCardDiffLineIndex(null, 3), 3);
});

test('color blocks follow the painted diff row, not the stale analysis line', () => {
  const file = {
    name: 'app.js',
    path: 'src/app.js',
    content: 'function top(){}\n\nfunction bottom(){}\n',
    functions: [
      { name: 'top', line: 1, isExported: false },
      { name: 'bottom', line: 3, isExported: false }
    ]
  };
  const rows = diffCodeLines(file.content, 'function extra(){}\nfunction top(){}\n\nfunction bottom(){}\n');
  const base = codeColorBlockSections(file, [], {});
  const painted = codeColorBlockSections(file, [], {}, rows);
  const topBase = base.find((s) => s.name === 'top');
  const topPainted = painted.find((s) => s.name === 'top');
  assert.equal(topBase.startLine, 1);
  assert.equal(topPainted.startLine, 2);
  assert.ok(topPainted.top > topBase.top);
});

test('cleared CLI watch generations do not reuse an in-flight token', () => {
  assert.equal(bumpCliWatchDiffEpoch(1), 2);
  const gens = { 'src/app.js': 1 };
  assert.equal(cliWatchDiffRequestIsCurrent(1, 1, gens, 'src/app.js', 1), true);
  assert.equal(cliWatchDiffRequestIsCurrent(2, 1, gens, 'src/app.js', 1), false);
  assert.equal(cliWatchDiffRequestIsCurrent(2, 2, { 'src/app.js': 1 }, 'src/app.js', 1), true);
  assert.equal(cliWatchDiffRequestIsCurrent(2, 2, { 'src/app.js': 2 }, 'src/app.js', 1), false);
});

test('CLI analysis keeps watch paths received while files were being read', () => {
  const read = { 'src/app.js': true, 'src/math.js': true };
  assert.deepEqual(J(retainCliWatchPathsAfterAnalysis(['src/app.js', '/src/math.js', 'src/app.js', ''], read)), ['src/app.js', 'src/math.js']);
  assert.deepEqual(J(retainCliWatchPathsAfterAnalysis(['src/app.js', 'src/unread.js'], { 'src/app.js': true })), ['src/app.js']);
  assert.deepEqual(J(retainCliWatchPathsAfterAnalysis(['src/unread.js'], { 'src/app.js': true })), []);
  assert.deepEqual(J(retainCliWatchPathsAfterAnalysis(null)), []);
  assert.deepEqual(J(noteCliWatchDuringEvent([], 'src/app.js', 2)), [{ path: 'src/app.js', rev: 2 }]);
  assert.deepEqual(J(noteCliWatchDuringEvent([{ path: 'src/app.js', rev: 1 }], 'src/app.js', 3)), [{ path: 'src/app.js', rev: 3 }]);
  assert.equal(cliWatchEventIsAfterSnapshot(2, 1), true);
  assert.equal(cliWatchEventIsAfterSnapshot(1, 1), false);
  assert.equal(cliWatchEventIsAfterSnapshot(null, 1), true);
  assert.deepEqual(J(retainCliWatchPathsAfterAnalysis([{ path: 'src/app.js', rev: 1 }], read, { 'src/app.js': 1 })), []);
  assert.deepEqual(J(retainCliWatchPathsAfterAnalysis([{ path: 'src/app.js', rev: 2 }], read, { 'src/app.js': 1 })), ['src/app.js']);
  assert.equal(cliWatchSnapRevFromResponse({ headers: { get(name) { return name === 'x-codeflow-rev' ? '4' : null; } } }), 4);
  assert.deepEqual(J(noteCliWatchPathIfRead([], 'src/app.js', read)), ['src/app.js']);
  assert.deepEqual(J(noteCliWatchPathIfRead([], 'src/later.js', read)), []);
  assert.deepEqual(J(noteCliWatchPathIfRead(['src/app.js'], 'src/later.js', { 'src/app.js': true })), ['src/app.js']);
  assert.deepEqual(J(noteCliWatchPathIfRead([], 'src/app.js', {})), []);
  assert.deepEqual(J(noteCliWatchPathIfRead([], 'src/app.js', null)), []);
  assert.deepEqual(J(forgetCliWatchPath(['src/app.js', 'src/math.js'], 'src/app.js')), ['src/math.js']);
  assert.deepEqual(J(forgetCliWatchPath(['src/app.js'], 'src/math.js')), ['src/app.js']);
  assert.deepEqual(J(forgetCliWatchPath(['src/app.js'], '')), ['src/app.js']);
  const analyzed = [{ path: 'src/app.js', content: 'export const n = 1;\n' }, { path: 'src/math.js', content: 'export const n = 2;\n' }];
  assert.equal(analyzedFileForCliWatchPath(analyzed, '/src/app.js').content, 'export const n = 1;\n');
  assert.equal(cliWatchLiveMatchesBaseline(analyzed[0], 'export const n = 1;\n'), true);
  assert.equal(cliWatchLiveMatchesBaseline(analyzed[0], 'export const n = 2;\n'), false);
  assert.equal(cliWatchLiveMatchesBaseline(analyzed[0], ''), false);
  assert.equal(cliWatchLiveMatchesBaseline({ path: 'src/app.js', content: 'export const n = 1;\n', analysisSkipped: 'fetch-failed' }, 'export const n = 1;\n'), false);
  const emptyFile = { path: 'src/empty.js', content: '' };
  assert.equal(cliWatchLiveClearsDirty(emptyFile, '', 'ok'), true);
  assert.equal(cliWatchLiveClearsDirty(emptyFile, '', 'missing'), false);
  assert.equal(cliWatchLiveClearsDirty(analyzed[0], 'export const n = 1;\n', 'ok'), true);
  assert.equal(cliWatchLiveClearsDirty(analyzed[0], 'export const n = 1;\n', 'missing'), false);
  assert.deepEqual(J(cliWatchLiveFromResponse(200, 'ok\n', true)), { kind: 'ok', content: 'ok\n' });
  assert.deepEqual(J(cliWatchLiveFromResponse(404, 'nope', false)), { kind: 'missing', content: '' });
  assert.deepEqual(J(cliWatchLiveFromResponse(500, 'err', false)), { kind: 'error' });
  assert.equal(shouldApplyCliWatchLive({ kind: 'ok', content: '' }), true);
  assert.equal(shouldApplyCliWatchLive({ kind: 'missing', content: '' }), true);
  assert.equal(shouldApplyCliWatchLive({ kind: 'error' }), false);
});

test('CLI live watch reads reject oversized files before painting', () => {
  const limit = CLI_WATCH_MAX_BYTES;
  assert.equal(limit, 2 * 1024 * 1024);
  assert.equal(cliWatchLiveRejectsOversized(limit), false);
  assert.equal(cliWatchLiveRejectsOversized(limit + 1), true);
  assert.equal(cliWatchLiveRejectsOversized(String(limit + 1)), true);
  assert.equal(cliWatchLiveRejectsOversized(NaN), false);
  assert.deepEqual(J(cliWatchLiveFromResponse(200, 'ok', true, limit + 1)), { kind: 'error' });
  assert.deepEqual(J(cliWatchLiveFromResponse(200, 'x'.repeat(limit + 1), true)), { kind: 'error' });
  assert.equal(shouldApplyCliWatchLive(cliWatchLiveFromResponse(200, 'ok', true, limit + 1)), false);
});

test('CLI watch recovery skips already flushed and in-flight paths', () => {
  const dirty = ['src/app.js', 'src/math.js', 'src/new.js'];
  const live = { 'src/app.js': 'export const n = 1;\n' };
  assert.deepEqual(J(pendingCliWatchDiffPaths(dirty, live, ['src/math.js'])), ['src/new.js']);
  assert.deepEqual(J(pendingCliWatchDiffPaths(dirty, live, [])), ['src/math.js', 'src/new.js']);
  assert.deepEqual(J(pendingCliWatchDiffPaths(dirty, live, dirty)), []);
  assert.deepEqual(J(pendingCliWatchDiffPaths([], live, [])), []);
  const started = J(startedCliWatchDiffPaths(['src/math.js'], { 'src/app.js': 1, 'src/util.js': 2 }));
  assert.deepEqual(started, ['src/math.js', 'src/app.js', 'src/util.js']);
  assert.deepEqual(J(pendingCliWatchDiffPaths(dirty, {}, started)), ['src/new.js']);
});

test('CLI watch diffs only apply to the matching CLI analysis', () => {
  const status = { ok: true, root: '/tmp/alpha', name: 'alpha' };
  assert.equal(cliWatchAppliesToAnalysis('cli', status, { sourceType: 'cli', sourceKey: '/tmp/alpha' }), true);
  assert.equal(cliWatchAppliesToAnalysis('cli', status, { sourceType: 'cli', sourceKey: '/tmp/beta' }), false);
  assert.equal(cliWatchAppliesToAnalysis('folder', status, { sourceType: 'folder' }), false);
  assert.equal(cliWatchAppliesToAnalysis('zip', status, { sourceType: 'zip' }), false);
  assert.equal(cliWatchAppliesToAnalysis(null, status, { sourceType: 'github' }), false);
  assert.equal(cliWatchAppliesToAnalysis('cli', { ok: false }, { sourceType: 'cli', sourceKey: '/tmp/alpha' }), false);
});

test('HTML attribute sanitizer encodes quotes before they reach data-sym', () => {
  assert.equal(escapeHtmlAttr('say "hi"'), 'say &quot;hi&quot;');
  assert.match(escapeHtmlAttr('a"onclick="alert(1)'), /&quot;/);
  assert.doesNotMatch(escapeHtmlAttr('a"onclick="alert(1)'), /data-sym="[^"]*"/);
  const out = annotateHtmlWithSymbols('shared', [{ name: 'shared', kind: 'fn"onclick="alert(1)' }], null);
  assert.match(out, /class="sym-mark var"/);
  assert.doesNotMatch(out, /onclick=/);
});



test('thickness control is offered on every view that draws links', () => {
  ['graph', 'code', 'graph3d', 'dendro', 'sankey', 'disjoint', 'bundle'].forEach((viz) => {
    assert.equal(vizUsesLineThickness(viz), true, viz);
  });
  ['treemap', 'matrix', 'architecture', 'none', ''].forEach((viz) => {
    assert.equal(vizUsesLineThickness(viz), false, viz);
  });
  assert.equal(vizHasGraphToolbar('graph'), true);
  assert.equal(vizHasGraphToolbar('dendro'), false);
  assert.equal(vizHasGraphToolbar('bundle'), false);
});

test('canvas mini-map is wired for Graph and Code only', () => {
  assert.equal(vizHasCanvasMinimap('graph'), true);
  assert.equal(vizHasCanvasMinimap('code'), true);
  ['graph3d', 'treemap', 'matrix', 'dendro', 'sankey', 'disjoint', 'bundle', 'architecture', ''].forEach((viz) => {
    assert.equal(vizHasCanvasMinimap(viz), false, viz);
  });























});

test('mini-map world bounds include nodes and code cards', () => {
  const nodes = [
    { id: 'src/a.js', folder: 'src', x: 0, y: 0 },
    { id: 'src/b.js', folder: 'src', x: 200, y: 40 }
  ];
  const world = collectMinimapWorldBounds(nodes, null, null, 0);
  assert.ok(world);
  assert.equal(world.minX, -16);
  assert.equal(world.maxX, 216);
  const cards = new Set(['src/a.js']);
  const sizes = { 'src/a.js': { width: 400, height: 200 } };
  const cardWorld = collectMinimapWorldBounds(nodes, sizes, cards, 0);
  assert.ok(cardWorld.minX <= -200);
  assert.ok(cardWorld.maxX >= 216);
  const content = collectMinimapContent(nodes, sizes, cards, (n) => n.id === 'src/a.js' ? '#4d9fff' : '#22c55e', 0);
  assert.equal(content.marks.some((m) => m.kind === 'card'), true);
  assert.equal(content.marks.some((m) => m.kind === 'node'), true);
  assert.equal(content.hulls.length, 1);
  assert.equal(content.hulls[0].folder, 'src');
  const stale = minimapCardInputs('graph', sizes, cards);
  assert.equal(stale.sizesByPath, null);
  assert.equal(stale.cardPaths, null);
  const graphWorld = collectMinimapWorldBounds(nodes, stale.sizesByPath, stale.cardPaths, 0);
  assert.equal(graphWorld.minX, -16);
  assert.equal(graphWorld.maxX, 216);
  const graphContent = collectMinimapContent(nodes, stale.sizesByPath, stale.cardPaths, (n) => n.id === 'src/a.js' ? '#4d9fff' : '#22c55e', 0);
  assert.equal(graphContent.marks.some((m) => m.kind === 'card'), false);
  const live = minimapCardInputs('code', sizes, cards);
  assert.equal(live.sizesByPath, sizes);
  assert.equal(live.cardPaths, cards);

  const many = [];
  for (let i = 0; i < 24; i += 1) {
    many.push({ id: `f${i}/n.js`, folder: `f${i}`, x: i * 80, y: i * 10 });
  }
  const manyWorld = collectMinimapWorldBounds(many, null, null, 0);
  const manyContent = collectMinimapContent(many, null, null, () => '#4d9fff', 0);
  assert.equal(manyContent.hulls.length, 24);
  assert.equal(manyContent.world.minX, manyWorld.minX);
  assert.equal(manyContent.world.maxX, manyWorld.maxX);
  assert.equal(manyContent.world.minY, manyWorld.minY);
  assert.equal(manyContent.world.maxY, manyWorld.maxY);
});

test('mini-map click centers the current camera on that world point', () => {
  const transform = { k: 2, x: 100, y: 50 };
  const view = viewportWorldRect(transform, 800, 600);
  assert.equal(view.x, -50);
  assert.equal(view.y, -25);
  assert.equal(view.width, 400);
  assert.equal(view.height, 300);
  const world = { minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 };
  const fit = minimapFitRect(world, 200, 150, 0);
  assert.ok(fit);
  assert.equal(fit.scale, 0.5);
  const mid = worldToMinimap(200, 150, world, fit);
  assert.equal(mid.x, 100);
  assert.equal(mid.y, 75);
  const back = minimapToWorld(mid.x, mid.y, world, fit);
  assert.equal(back.x, 200);
  assert.equal(back.y, 150);
  const centered = zoomTransformToCenterWorld(150, 125, 2, 800, 600);
  assert.equal(centered.k, 2);
  assert.equal(centered.x, 100);
  assert.equal(centered.y, 50);
  const jumped = zoomTransformFromMinimapPoint(100, 75, world, fit, transform, 800, 600);
  assert.equal(jumped.k, 2);
  assert.equal(jumped.x, 400 - 200 * 2);
  assert.equal(jumped.y, 300 - 150 * 2);
  const ptr = J(minimapPointerXY(120, 80, { left: 20, top: 30 }));
  assert.deepEqual(ptr, { x: 100, y: 50 });
  assert.equal(colorWithAlpha('#00ff9d', 0.1), 'rgba(0,255,157,0.1)');

  const wide = { minX: 0, minY: 0, maxX: 400, maxY: 100, width: 400, height: 100 };
  const letterbox = minimapFitRect(wide, 200, 150, 0);
  assert.ok(letterbox);
  assert.equal(letterbox.scale, 0.5);
  assert.equal(letterbox.ox, 0);
  assert.equal(letterbox.oy, 50);
  const unclampedY = (0 - letterbox.oy) / letterbox.scale + wide.minY;
  assert.ok(unclampedY < wide.minY);
  const clampedTop = clampMinimapPoint(100, 0, wide, letterbox);
  assert.deepEqual(J(clampedTop), { x: 100, y: 50 });
  const edge = minimapToWorld(100, 0, wide, letterbox);
  assert.equal(edge.x, 200);
  assert.equal(edge.y, 0);
  const bottom = minimapToWorld(100, 149, wide, letterbox);
  assert.equal(bottom.x, 200);
  assert.equal(bottom.y, 100);
  const left = minimapToWorld(-20, 75, wide, letterbox);
  assert.equal(left.x, 0);
  assert.equal(left.y, 50);
  const right = minimapToWorld(300, 75, wide, letterbox);
  assert.equal(right.x, 400);
  assert.equal(right.y, 50);
  const jumpedEdge = zoomTransformFromMinimapPoint(100, 0, wide, letterbox, transform, 800, 600);
  assert.equal(jumpedEdge.k, 2);
  assert.equal(jumpedEdge.x, 400 - 200 * 2);
  assert.equal(jumpedEdge.y, 300 - 0 * 2);
});

test('mini-map keyboard pans the viewport by a fraction of the view', () => {
  const transform = { k: 2, x: 100, y: 50 };
  const before = viewportWorldRect(transform, 800, 600);
  assert.equal(before.x, -50);
  assert.equal(before.y, -25);
  assert.equal(before.width, 400);
  assert.equal(before.height, 300);

  const right = panTransformByViewportFraction(transform, 0.25, 0, 800, 600);
  assert.equal(right.k, 2);
  const afterRight = viewportWorldRect(right, 800, 600);
  assert.equal(afterRight.x, before.x + before.width * 0.25);
  assert.equal(afterRight.y, before.y);
  assert.equal(afterRight.width, before.width);

  const left = panTransformByViewportFraction(transform, -0.25, 0, 800, 600);
  assert.equal(left.k, 2);
  assert.equal(viewportWorldRect(left, 800, 600).x, before.x - before.width * 0.25);

  const down = panTransformByViewportFraction(transform, 0, 0.25, 800, 600);
  assert.equal(down.k, 2);
  assert.equal(viewportWorldRect(down, 800, 600).y, before.y + before.height * 0.25);

  const up = panTransformByViewportFraction(transform, 0, -0.25, 800, 600);
  assert.equal(up.k, 2);
  assert.equal(viewportWorldRect(up, 800, 600).y, before.y - before.height * 0.25);

  const far = panTransformByViewportFraction(transform, 0.5, 0, 800, 600);
  assert.equal(far.k, 2);
  assert.equal(viewportWorldRect(far, 800, 600).x, before.x + before.width * 0.5);

  const nudged = zoomTransformNudgeWorld(transform, before.width * 0.25, 0);
  assert.equal(nudged.k, 2);
  assert.deepEqual(J(nudged), J(right));

  const world = { minX: 0, minY: 0, maxX: 400, maxY: 300, width: 400, height: 300 };
  const home = panTransformToWorldMidpoint(transform, world, 800, 600);
  const centered = zoomTransformToCenterWorld(200, 150, 2, 800, 600);
  assert.equal(home.k, 2);
  assert.deepEqual(J(home), J(centered));
  const missing = panTransformToWorldMidpoint(transform, null, 800, 600);
  assert.deepEqual(J(missing), J(snapshotZoomTransform(transform)));
});

function memoryStorage(seed) {
  const data = Object.assign({}, seed || {});
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    _data: data
  };
}

test('line thickness defaults match current graph edges and stay in range', () => {
  assert.equal(LINE_THICKNESS_DEFAULT, 1);
  assert.equal(LINE_THICKNESS_MIN, 1);
  assert.equal(LINE_THICKNESS_MAX, 6);
  assert.equal(clampLineThickness(undefined), 1);
  assert.equal(clampLineThickness('nope'), 1);
  assert.equal(clampLineThickness(0), 1);
  assert.equal(clampLineThickness(9), 6);
  assert.equal(clampLineThickness(3.6), 4);
  const thin = graphLinkStrokeWidth(1, 1);
  const thick = graphLinkStrokeWidth(1, 4);
  assert.equal(thin, Math.max(1, Math.min(2, Math.sqrt(1) * 0.3)));
  assert.equal(thick, thin * 4);
  assert.equal(scaleStrokeWidth(1.5, 1), 1.5);
  assert.equal(scaleStrokeWidth(1.5, 2), 3);
  const idle = graph3dLinkWidth({ count: 1, source: 'a.js', target: 'b.js' }, null, 1);
  const selected = graph3dLinkWidth({ count: 1, source: 'a.js', target: 'b.js' }, 'a.js', 1);
  assert.ok(selected > idle);
});

test('selected Code-view links animate; inactive stay quiet; reduced-motion is static', () => {
  const outLink = { count: 1, source: 'src/app.js', target: 'src/math.js' };
  const inLink = { count: 2, source: { id: 'src/boot.js' }, target: { id: 'src/app.js' } };
  const other = { count: 1, source: 'src/a.js', target: 'src/b.js' };
  const opts = { theme: 'dark', thickness: 2, reducedMotion: false };

  const outgoing = forceLinkVisual(outLink, 'src/app.js', opts);
  const incoming = forceLinkVisual(inLink, 'src/app.js', opts);
  const quiet = forceLinkVisual(other, 'src/app.js', opts);
  const baseline = forceLinkVisual(outLink, null, opts);
  const reduced = forceLinkVisual(outLink, 'src/app.js', Object.assign({}, opts, { reducedMotion: true }));

  assert.equal(forceLinkRole(outLink, 'src/app.js'), 'out');
  assert.equal(forceLinkRole(inLink, 'src/app.js'), 'in');
  assert.equal(forceLinkRole(other, 'src/app.js'), '');
  assert.equal(outgoing.active, true);
  assert.equal(outgoing.role, 'out');
  assert.equal(outgoing.stroke, 'var(--orange)');
  assert.equal(outgoing.particle, true);
  assert.equal(outgoing.particleDash, '8 20');
  assert.equal(outgoing.particleStroke, '#fff');
  assert.notEqual(outgoing.particleStroke, outgoing.stroke);
  assert.equal(incoming.active, true);
  assert.equal(incoming.role, 'in');
  assert.equal(incoming.stroke, 'var(--purple)');
  assert.equal(incoming.particle, true);
  assert.equal(incoming.particleStroke, '#fff');
  assert.equal(quiet.active, false);
  assert.equal(quiet.role, 'quiet');
  assert.equal(quiet.particle, false);
  assert.ok(quiet.opacity < baseline.opacity);
  assert.equal(baseline.active, false);
  assert.equal(baseline.role, 'idle');
  assert.equal(baseline.particle, false);
  assert.equal(baseline.opacity, 0.4);
  assert.equal(reduced.active, true);
  assert.equal(reduced.stroke, 'var(--orange)');
  assert.equal(reduced.particle, false, 'reduced-motion keeps a static highlight');
  assert.equal(reduced.particleDash, '');
  assert.equal(forceLinkParticlesNeedTickUpdate(null, { reducedMotion: false }), false);
  assert.equal(forceLinkParticlesNeedTickUpdate('src/app.js', { reducedMotion: true }), false);
  assert.equal(forceLinkParticlesNeedTickUpdate('src/app.js', { reducedMotion: false }), true);

  const thin = forceLinkVisual(outLink, 'src/app.js', { thickness: 1, reducedMotion: false });
  const thick = forceLinkVisual(outLink, 'src/app.js', { thickness: 6, reducedMotion: false });
  assert.equal(thick.width, thin.width * 6);
  assert.equal(prefersReducedMotion({ matches: true }), true);
  assert.equal(prefersReducedMotion({ matches: false }), false);
  assert.equal(prefersReducedMotion(function (query) {
    return { matches: query.indexOf('reduce') >= 0 };
  }), true);
});

test('reduced-motion changes reapply Code particles; Graph keeps static accent', () => {
  assert.equal(vizUsesForceLinkParticles('code'), true);
  assert.equal(vizUsesForceLinkParticles('graph'), false);
  assert.equal(vizUsesForceLinkParticles('graph3d'), false);

  const outLink = { count: 1, source: 'src/app.js', target: 'src/math.js' };
  const codeOpts = { theme: 'dark', thickness: 2, reducedMotion: false, vizType: 'code' };
  const graphOpts = { theme: 'dark', thickness: 2, reducedMotion: false, vizType: 'graph' };
  const codeOn = forceLinkVisual(outLink, 'src/app.js', codeOpts);
  const graphOn = forceLinkVisual(outLink, 'src/app.js', graphOpts);
  const codeReduced = forceLinkVisual(outLink, 'src/app.js', Object.assign({}, codeOpts, { reducedMotion: true }));
  assert.equal(codeOn.particle, true);
  assert.equal(graphOn.particle, false);
  assert.equal(graphOn.active, true);
  assert.equal(codeReduced.particle, false);
  assert.equal(forceLinkParticlesNeedTickUpdate('src/app.js', { reducedMotion: false, vizType: 'code' }), true);
  assert.equal(forceLinkParticlesNeedTickUpdate('src/app.js', { reducedMotion: false, vizType: 'graph' }), false);
  assert.equal(forceLinkParticlesNeedTickUpdate('src/app.js', { reducedMotion: true, vizType: 'code' }), false);

  const listeners = [];
  const mq = {
    matches: true,
    addEventListener(type, fn) {
      if (type === 'change') listeners.push(fn);
    },
    removeEventListener(type, fn) {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    }
  };
  const seen = [];
  const unsub = subscribePrefersReducedMotion(function (matches) {
    seen.push(matches);
  }, function () { return mq; });
  assert.equal(typeof unsub, 'function');
  assert.equal(listeners.length, 1);
  mq.matches = false;
  listeners.slice().forEach((fn) => fn());
  assert.deepEqual(seen, [false]);
  unsub();
  assert.equal(listeners.length, 0);

  const legacy = {
    matches: false,
    addListener(fn) { this._fn = fn; },
    removeListener(fn) { if (this._fn === fn) this._fn = null; }
  };
  let legacyHits = 0;
  const stopLegacy = subscribePrefersReducedMotion(function () { legacyHits += 1; }, function () { return legacy; });
  legacy.matches = true;
  legacy._fn();
  assert.equal(legacyHits, 1);
  stopLegacy();
  assert.equal(legacy._fn, null);

  const noop = subscribePrefersReducedMotion(function () {}, function () { return null; });
  assert.equal(typeof noop, 'function');
  noop();








});

test('UI prefs persist line thickness in localStorage', () => {
  const storage = memoryStorage();
  assert.equal(readUiPrefs(storage).lineThickness, 1);
  assert.equal(readUiPrefs(null).lineThickness, 1);
  const written = writeUiPrefs(storage, { lineThickness: 5 });
  assert.equal(written.lineThickness, 5);
  assert.equal(readUiPrefs(storage).lineThickness, 5);
  assert.equal(writeUiPrefs(storage, { lineThickness: 99 }).lineThickness, 6);
  storage.setItem(UI_PREFS_STORAGE_KEY, '{not-json');
  assert.equal(readUiPrefs(storage).lineThickness, 1);
  const other = memoryStorage({ [UI_PREFS_STORAGE_KEY]: JSON.stringify({ lineThickness: 2, extra: true }) });
  const merged = writeUiPrefs(other, { lineThickness: 3 });
  assert.equal(merged.lineThickness, 3);
  globalThis.window = { localStorage: storage };
  try {
    assert.equal(persistUiPrefs({ lineThickness: 4 }).lineThickness, 4);
    assert.equal(readUiPrefs().lineThickness, 4);
  } finally {
    delete globalThis.window;
  }
});

function throwingLocalStorageWindow() {
  return {
    get localStorage() {
      const err = new Error('Access is denied for this document.');
      err.name = 'SecurityError';
      throw err;
    }
  };
}

test('UI prefs keep the default when localStorage access throws', () => {
  globalThis.window = throwingLocalStorageWindow();
  try {
    assert.equal(resolveUiPrefsStorage(undefined), null);
    assert.doesNotThrow(() => readUiPrefs());
    assert.equal(readUiPrefs().lineThickness, LINE_THICKNESS_DEFAULT);
    const rendered = readUiPrefs().lineThickness;
    assert.equal(rendered, 1);
    assert.doesNotThrow(() => persistUiPrefs({ lineThickness: 5 }));
    const inSession = persistUiPrefs({ lineThickness: 5 });
    assert.equal(inSession.lineThickness, 5);
    assert.equal(readUiPrefs().lineThickness, 1);
  } finally {
    delete globalThis.window;
  }
});

test('explicit source navigation opens a thirteenth card without dropping the investigation',()=>{
 const paths=Array.from({length:13},(_,i)=>`lib/source${i}.ex`);
 const state={...createInvestigationState(),openedPaths:paths.slice(0,12),scope:'lib'};
 const next=reduceInvestigation(state,{type:'open',path:paths[12]},{files:paths.map(path=>({path,folder:'lib'}))});
 assert.deepEqual(next.openedPaths,paths);
 assert.equal(state.openedPaths.length,12,'previous investigation is immutable');
 assert.equal(next.view,'code');
 assert.equal(next.scope,'lib');
});

test('cache compaction follows source references through trees, patterns and Elixir declarations',()=>{
 const sentinel='def keep_source_only_in_memory, do: :ok';
 const file={path:'lib/example.ex',name:'example.ex',folder:'lib',content:sentinel,functions:[{name:'Example.run/0',code:sentinel}],elixir:{status:'ready',functions:[{name:'Example.run/0',code:sentinel}],modules:[{name:'Example'}]}};
 const original={files:[file],tree:{files:[file]},patterns:[{name:'pattern',files:[file]}]};
 const cached=compactAnalysisForCache(original);
 assert.equal(JSON.stringify(cached).includes(sentinel),false);
 assert.equal(original.files[0].elixir.functions[0].code,sentinel,'cache projection never mutates live source');
 assert.equal(cached.files[0].elixir.status,'ready');
 assert.equal(cached.patterns[0].files[0].path,file.path);
});
