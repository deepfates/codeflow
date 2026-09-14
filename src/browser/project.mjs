export function parseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();
  if (url.length > 200 || url.includes('{') || url.includes('"')) return null;
  var m = url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/);
  if (m) return {
    owner: m[1],
    repo: m[2].replace(/\.git$/, '')
  };
  var simple = url.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (simple) return {
    owner: simple[1],
    repo: simple[2]
  };
  return null;
}
import { createProjectLoading } from '../project/loading.mjs';
import { createLocalTools } from '../project/local-tools.mjs';
import { createProjectSource } from '../project/access.mjs';
import { subscribeCliAnalysis } from '../project/cli-analysis.mjs';
import { newLocalSelectionId, localFolderCacheMeta, cliWatchCacheMeta, zipArchiveCacheMeta, retainedFolderMatchesRecord, cliRecordMatchesStatus, zipFileIdentity, retainedZipMatchesRecord, githubCacheSourceKey, githubSourceKeyForLoadedAnalysis, cachedAnalysisMatchesExcludes, analysisCacheKey, analysisGraphKey, analysisHydrationIdFromParts, loadedAnalysisSourceIdentity } from '../project/identity.mjs';
import { nextCodeSourceReads, clearCodeSourceFailure, recordCodeSourceFailureIfCurrent, clearCodeSourceFailureIfCurrent, filesNeedingSource, mergeHydratedFileSources } from '../project/source.mjs';
import { CLI_WATCH_DIFF_MS, normalizeCliWatchPath, noteCliWatchPath, noteCliWatchDuringEvent, cliWatchSnapRevFromResponse, forgetCliWatchPath, analyzedFileForCliWatchPath, cliWatchLiveClearsDirty, mergeCliLiveContents, cliWatchDiffPaths, startedCliWatchDiffPaths, bumpCliWatchDiffEpoch, cliWatchDiffRequestIsCurrent, retainCliWatchPathsAfterAnalysis, cliWatchLiveRejectsOversized, cliWatchLiveFromResponse, shouldApplyCliWatchLive, pendingCliWatchDiffPaths, cliWatchAppliesToAnalysis } from '../project/changes.mjs';
import { buildRecentAnalysisRecord, compactAnalysisForCache, listRecentAnalyses, getRecentAnalysis, deleteRecentAnalysis, saveRecentAnalysis } from '../investigation/recent-analyses.mjs';
import { buildBeamAnalysisData, enrichAnalysisFindings } from '../analysis/evidence.mjs';
import { filterAnalyzableLocalFiles } from '../project/exclusions.mjs';
import { collectDirectory, collectSelectedFiles, collectArchive, readCollectedFiles } from '../project/collection.mjs';
import { isCode } from '../analysis/file-types.mjs';
import { yieldToBrowser } from './scheduling.mjs';
export function buildAppUrl(repo, autoRun) {
  var url = new URL(window.location.href);
  url.search = '';
  if (repo) url.searchParams.set('repo', repo);
  if (autoRun && repo) url.searchParams.set('run', '1');
  return url.toString();
}
const ANALYSIS_LIMITS = {
  repoSoft: 300,
  localSoft: 500
};
// Owns one active acquisition and its source connection. The caller owns picker
// controls and investigation state; onReset runs only for explicit load actions,
// never for source hydration, watch diffs, or refreshed analysis-tool evidence.
export function createProjectHook({
  React,
  runAnalysisData,
  GitHub,
  JSZip
}) {
  const {
    useState,
    useRef,
    useMemo,
    useEffect
  } = React;
  return function useProject({
    repoUrl,
    auth,
    excludePatterns: activeExcludePatterns,
    confirm: requestConfirm,
    notify: showNotification,
    onReset,
    onRepositoryURL
  }) {
    const {
      authMethod,
      token,
      appId,
      privateKey
    } = auth;
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);
    const [repoInfo, setRepoInfo] = useState(null);
    const [localDirHandle, setLocalDirHandle] = useState(null);
    const [localSourceKind, setLocalSourceKind] = useState(null);
    const [recentAnalyses, setRecentAnalyses] = useState([]);
    const [cachedFromId, setCachedFromId] = useState(null);
    const [cliStatus, setCliStatus] = useState(null);
    const [beamAnalysis, setBeamAnalysis] = useState(null);
    const [cliDirty, setCliDirty] = useState([]);
    const [cliLiveByPath, setCliLiveByPath] = useState(Object.create(null));
    const [codeSourceFailed, setCodeSourceFailed] = useState(Object.create(null));
    const analysisHydrationIdRef = useRef('');
    const dataRef = useRef(null);
    const enqueueCliWatchDiffRef = useRef(null);
    const cliDiffTimerRef = useRef(null);
    const cliDiffPendingRef = useRef([]);
    const cliDiffGenRef = useRef(Object.create(null));
    const cliDiffEpochRef = useRef(1);
    const cliAnalyzingRef = useRef(false);
    const cliWatchDuringRef = useRef([]);
    const cliWatchReadRef = useRef(Object.create(null));
    const cliWatchSnapRevRef = useRef(Object.create(null));
    const zipArchiveRef = useRef(null);
    const zipFileRef = useRef(null);
    const localFilesRef = useRef(null);
    const localFolderKeyRef = useRef(null);
    const localFolderSelectionRef = useRef(null);
    const zipKeyRef = useRef(null);
    const persistTimerRef = useRef(null);
    const codeSourceInFlightRef = useRef(Object.create(null));
    const projectLoading = useMemo(createProjectLoading, []);
    dataRef.current = data;
    var analysisGraphIdentity = useMemo(function () {
      return analysisGraphKey(data);
    }, [data]);
    var loadedSourceIdentity = useMemo(function () {
      var parsed = parseUrl(repoUrl);
      var githubOwner = repoInfo && repoInfo.owner && repoInfo.owner !== 'local' ? repoInfo.owner : parsed && parsed.owner;
      var githubRepo = repoInfo && repoInfo.owner && repoInfo.owner !== 'local' ? repoInfo.repo : parsed && parsed.repo;
      return loadedAnalysisSourceIdentity({
        localSourceKind: localSourceKind,
        folderKey: repoInfo && (repoInfo.folderKey || repoInfo.name),
        zipKey: repoInfo && (repoInfo.zipKey || repoInfo.name),
        cliRoot: repoInfo && repoInfo.cliRoot || cliStatus && cliStatus.root,
        cliOk: !!(cliStatus && cliStatus.ok),
        githubOwner: githubOwner,
        githubRepo: githubRepo,
        githubKey: githubOwner && githubRepo ? githubSourceKeyForLoadedAnalysis(githubOwner, githubRepo, data, activeExcludePatterns) : null
      });
    }, [localSourceKind, repoInfo, repoUrl, data, cliStatus]);
    var currentHydrationId = useMemo(function () {
      return analysisHydrationIdFromParts(loadedSourceIdentity, analysisGraphIdentity);
    }, [loadedSourceIdentity, analysisGraphIdentity]);
    analysisHydrationIdRef.current = currentHydrationId;
    var localTools = useMemo(function () {
      return createLocalTools({
        identity: loadedSourceIdentity,
        status: cliStatus
      });
    }, [loadedSourceIdentity && loadedSourceIdentity.sourceType, loadedSourceIdentity && loadedSourceIdentity.sourceKey, cliStatus && cliStatus.root, cliStatus && cliStatus.ok]);
    useEffect(() => {
      setBeamAnalysis(null);
      return () => localTools?.dispose();
    }, [localTools]);
    useEffect(function () {
      if (loading || !data || !data.beam || !localTools) return;
      return subscribeCliAnalysis({
        onUpdate: function (update) {
          if (update.analysis) setBeamAnalysis(update.analysis);
          if (update.diagnostics) setData(function (prev) {
            return prev ? enrichAnalysisFindings(prev, update.diagnostics) : prev;
          });
          if (update.graph) setData(function (prev) {
            return prev && prev.beam ? buildBeamAnalysisData({
              data: prev,
              snapshot: update.graph
            }) : prev;
          });
        }
      });
    }, [loading, localTools, !!(data && data.beam)]);
    useEffect(function () {
      if (!cliWatchAppliesToAnalysis(localSourceKind, cliStatus, currentAnalysisSource())) return;
      if (!data || !data.files || !cliDirty.length) return;
      var started = startedCliWatchDiffPaths(cliDiffPendingRef.current, cliDiffGenRef.current);
      var missing = pendingCliWatchDiffPaths(cliDirty, cliLiveByPath, started);
      if (!missing.length) return;
      flushCliWatchDiffs(missing);
    }, [currentHydrationId, cliDirty, localSourceKind, cliStatus, cliLiveByPath]);
    function currentAnalysisSource() {
      if (localSourceKind === 'folder') return {
        sourceType: 'folder',
        sourceKey: repoInfo && (repoInfo.folderKey || repoInfo.name) || 'local-folder',
        title: repoInfo && repoInfo.name || 'Local Folder',
        repoUrl: '',
        localSourceKind: 'folder'
      };
      if (localSourceKind === 'zip') return {
        sourceType: 'zip',
        sourceKey: repoInfo && (repoInfo.zipKey || repoInfo.name) || 'zip',
        title: repoInfo && repoInfo.name || 'ZIP Archive',
        repoUrl: '',
        localSourceKind: 'zip'
      };
      if (localSourceKind === 'cli') return {
        sourceType: 'cli',
        sourceKey: repoInfo && repoInfo.cliRoot || cliStatus && cliStatus.root || 'cli',
        title: cliStatus && cliStatus.name || repoInfo && repoInfo.name || 'Local watch',
        repoUrl: '',
        localSourceKind: 'cli'
      };
      if (repoInfo && repoInfo.owner && repoInfo.repo && repoInfo.owner !== 'local') return {
        sourceType: 'github',
        sourceKey: githubSourceKeyForLoadedAnalysis(repoInfo.owner, repoInfo.repo, data, activeExcludePatterns),
        title: repoInfo.owner + '/' + repoInfo.repo,
        repoUrl: repoInfo.owner + '/' + repoInfo.repo,
        localSourceKind: null
      };
      var parsed = parseUrl(repoUrl);
      if (parsed) return {
        sourceType: 'github',
        sourceKey: githubSourceKeyForLoadedAnalysis(parsed.owner, parsed.repo, data, activeExcludePatterns),
        title: parsed.owner + '/' + parsed.repo,
        repoUrl: parsed.owner + '/' + parsed.repo,
        localSourceKind: null
      };
      if (cliStatus && cliStatus.ok) return {
        sourceType: 'cli',
        sourceKey: cliStatus.root || 'cli',
        title: cliStatus.name || 'Local watch',
        repoUrl: '',
        localSourceKind: 'cli'
      };
      return null;
    }
    function refreshRecentList() {
      listRecentAnalyses().then(function (rows) {
        setRecentAnalyses((rows || []).map(function (row) {
          return {
            id: row.id,
            title: row.title,
            sourceType: row.sourceType,
            sourceKey: row.sourceKey,
            repoUrl: row.repoUrl,
            fileCount: row.fileCount,
            savedAt: row.savedAt
          };
        }));
      }).catch(function () {});
    }
    function persistCurrentAnalysis(dataObj, meta) {
      if (!dataObj) return;
      var source = meta || currentAnalysisSource();
      if (!source) return;
      var record = buildRecentAnalysisRecord({
        sourceType: source.sourceType,
        sourceKey: source.sourceKey,
        title: source.title,
        repoUrl: source.repoUrl,
        data: compactAnalysisForCache(dataObj),
        repoInfo: source.repoInfo || repoInfo,
        localSourceKind: source.localSourceKind
      });
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(function () {
        saveRecentAnalysis(record).then(function (ok) {
          if (ok) refreshRecentList();
        });
      }, 80);
    }
    function applyCachedAnalysis(record) {
      if (!record || !record.data) return;
      projectLoading.begin();
      onReset({
        cached: true
      });
      setLoading(false);
      setError(null);
      cliAnalyzingRef.current = false;
      setData(compactAnalysisForCache(record.data));
      setCachedFromId(record.id);
      setCliDirty([]);
      clearCliLiveDiffs();
      if (record.repoInfo) setRepoInfo(record.repoInfo);
      if (record.repoUrl) onRepositoryURL(record.repoUrl);
      var folderMatches = record.sourceType === 'folder' && retainedFolderMatchesRecord(record, {
        sourceKey: localFolderKeyRef.current
      });
      var zipMatches = record.sourceType === 'zip' && retainedZipMatchesRecord(record, {
        sourceKey: zipKeyRef.current,
        identity: zipFileIdentity(zipFileRef.current)
      });
      if (!folderMatches) {
        setLocalDirHandle(null);
        localFolderKeyRef.current = null;
        localFolderSelectionRef.current = null;
        localFilesRef.current = null;
      }
      if (!zipMatches) {
        zipArchiveRef.current = null;
        zipFileRef.current = null;
        zipKeyRef.current = null;
      }
      if (record.sourceType === 'github' || record.sourceType === 'cli') {
        setLocalSourceKind(record.sourceType === 'cli' ? 'cli' : null);
        setLocalDirHandle(null);
      } else {
        setLocalSourceKind(record.localSourceKind || record.sourceType);
      }
      showNotification('Loaded cached analysis. Re-analyze to refresh.', 'success');
    }
    function loadRecentAnalysis(id) {
      const selectionSignal = projectLoading.begin();
      return getRecentAnalysis(id).then(function (record) {
        if (selectionSignal.aborted) return null;
        if (!record) {
          showNotification('That analysis is no longer cached.', 'warning');
          refreshRecentList();
          return null;
        }
        applyCachedAnalysis(record);
        return record;
      }).catch(function () {
        if (selectionSignal.aborted) return null;
        showNotification('Could not open cached analysis.', 'error');
        return null;
      });
    }
    function reanalyzeRecent(id) {
      const selectionSignal = projectLoading.begin();
      return getRecentAnalysis(id).then(function (record) {
        if (selectionSignal.aborted) return null;
        if (!record) {
          showNotification('That analysis is no longer cached.', 'warning');
          refreshRecentList();
          return;
        }
        refreshAnalysis(record);
      }).catch(function () {
        if (selectionSignal.aborted) return null;
        showNotification('Could not open cached analysis.', 'error');
      });
    }
    function removeRecentAnalysis(id) {
      deleteRecentAnalysis(id).then(function () {
        if (cachedFromId === id) setCachedFromId(null);
        refreshRecentList();
      }).catch(function () {});
    }
    function clearCliLiveDiffs() {
      cliDiffEpochRef.current = bumpCliWatchDiffEpoch(cliDiffEpochRef.current);
      cliDiffPendingRef.current = [];
      cliDiffGenRef.current = Object.create(null);
      if (cliDiffTimerRef.current) {
        clearTimeout(cliDiffTimerRef.current);
        cliDiffTimerRef.current = null;
      }
      setCliLiveByPath(Object.create(null));
    }
    function flushCliWatchDiffs(paths) {
      if (!cliWatchAppliesToAnalysis(localSourceKind, cliStatus, currentAnalysisSource())) return;
      var wanted = cliWatchDiffPaths(dataRef.current && dataRef.current.files, paths);
      if (!wanted.length) return;
      wanted.forEach(function (path) {
        var epoch = cliDiffEpochRef.current;
        var gen = (cliDiffGenRef.current[path] || 0) + 1;
        cliDiffGenRef.current[path] = gen;
        readCliWatchLiveSource(path).then(function (result) {
          if (!cliWatchDiffRequestIsCurrent(cliDiffEpochRef.current, epoch, cliDiffGenRef.current, path, gen)) return;
          if (!shouldApplyCliWatchLive(result)) return;
          var live = result.kind === 'missing' ? '' : result.content;
          var file = analyzedFileForCliWatchPath(dataRef.current && dataRef.current.files, path);
          if (cliWatchLiveClearsDirty(file, live, result.kind)) {
            setCliLiveByPath(function (prev) {
              return mergeCliLiveContents(prev, [{
                path: path,
                content: null
              }]);
            });
            setCliDirty(function (prev) {
              return forgetCliWatchPath(prev, path);
            });
            return;
          }
          setCliLiveByPath(function (prev) {
            return mergeCliLiveContents(prev, [{
              path: path,
              content: live
            }]);
          });
        });
      });
    }
    function enqueueCliWatchDiff(path, rev) {
      var next = normalizeCliWatchPath(path);
      if (!next) return;
      if (cliAnalyzingRef.current) cliWatchDuringRef.current = noteCliWatchDuringEvent(cliWatchDuringRef.current, next, rev);
      if (!cliWatchAppliesToAnalysis(localSourceKind, cliStatus, currentAnalysisSource())) return;
      setCliDirty(function (prev) {
        return noteCliWatchPath(prev, next);
      });
      cliDiffPendingRef.current = noteCliWatchPath(cliDiffPendingRef.current, next);
      if (cliDiffTimerRef.current) clearTimeout(cliDiffTimerRef.current);
      cliDiffTimerRef.current = setTimeout(function () {
        var pending = cliDiffPendingRef.current;
        cliDiffPendingRef.current = [];
        cliDiffTimerRef.current = null;
        flushCliWatchDiffs(pending);
      }, CLI_WATCH_DIFF_MS);
    }
    function probeCodeflowCli() {
      const probeSignal = projectLoading.begin();
      let src;
      fetch('/__codeflow/status', {
        signal: probeSignal
      }).then(function (res) {
        return res.ok ? res.json() : null;
      }).then(function (status) {
        if (probeSignal.aborted || !status || !status.ok) return;
        setCliStatus(status);
        if (!window.location.search || window.location.search.indexOf('repo=') < 0) {
          analyzeFromCli(false, status);
        }
        if (window.EventSource) {
          src = new EventSource('/__codeflow/events');
          src.onmessage = function (ev) {
            try {
              var payload = JSON.parse(ev.data || '{}');
              if (payload.path && enqueueCliWatchDiffRef.current) enqueueCliWatchDiffRef.current(payload.path, payload.rev);
            } catch (e) {}
          };
        }
      }).catch(function () {});
      return function () {
        src?.close();
      };
    }
    async function analyzeFromCli(force, statusHint, wantedRoot) {
      const selectionSignal = projectLoading.begin();
      var status = statusHint || cliStatus;
      if (!status || !status.ok) {
        try {
          var statusRes = await fetch('/__codeflow/status', {
            signal: selectionSignal
          });
          if (statusRes.ok) {
            var nextStatus = await statusRes.json();
            if (nextStatus && nextStatus.ok) status = nextStatus;
          }
        } catch (e) {}
        if ((!status || !status.ok) && !force) return;
      }
      if (selectionSignal.aborted) return;
      if (wantedRoot && !cliRecordMatchesStatus({
        sourceKey: wantedRoot
      }, status)) {
        showNotification('Restart the CLI in that folder to re-analyze it.', 'warning');
        return false;
      }
      if (status && status.ok) setCliStatus(status);
      var cliMeta = cliWatchCacheMeta(status);
      cliWatchDuringRef.current = [];
      cliWatchReadRef.current = Object.create(null);
      cliWatchSnapRevRef.current = Object.create(null);
      resetAnalysisState();
      cliAnalyzingRef.current = true;
      const loadSignal = projectLoading.signal;
      setLocalDirHandle(null);
      localFolderKeyRef.current = null;
      localFolderSelectionRef.current = null;
      setLocalSourceKind('cli');
      zipArchiveRef.current = null;
      zipFileRef.current = null;
      zipKeyRef.current = null;
      setLoading(true);
      setProgress('Reading local folder from CLI...');
      try {
        var listRes = await fetch('/__codeflow/files', {
          signal: loadSignal
        });
        if (!listRes.ok) throw new Error('CLI file list failed');
        var list = await listRes.json();
        var files = filterAnalyzableLocalFiles(list && list.files ? list.files : [], activeExcludePatterns);
        if (!files.length) throw new Error(activeExcludePatterns.length ? 'No code files found in the watched folder after applying exclude patterns' : 'No code files found in the watched folder');
        const analyzed = await readCollectedFiles(files.map(file => ({
          ...file,
          read: async () => {
            const response = await fetch('/__codeflow/file?path=' + encodeURIComponent(file.path), {
              signal: loadSignal
            });
            if (!response.ok) throw new Error('CLI source request failed');
            loadSignal.throwIfAborted();
            const path = normalizeCliWatchPath(file.path);
            cliWatchReadRef.current[path] = true;
            const revision = cliWatchSnapRevFromResponse(response);
            if (revision != null) cliWatchSnapRevRef.current[path] = revision;
            return response.text();
          }
        })), {
          signal: loadSignal,
          progress: message => {
            if (!loadSignal.aborted) setProgress(message);
          },
          yieldFn: yieldToBrowser
        });
        var snapshot = null;
        if (status.beam) {
          var beamRes = await fetch('/__codeflow/beam', {
            signal: loadSignal
          });
          if (!beamRes.ok) throw new Error('Compiler snapshot request failed');
          snapshot = await beamRes.json();
        }
        var dataObj = await runAnalysisData({
          signal: loadSignal,
          files: analyzed,
          excludePatterns: activeExcludePatterns.map(function (x) {
            return x.raw;
          }),
          progress: function (message) {
            if (!loadSignal.aborted) setProgress(message);
          },
          yieldFn: yieldToBrowser
        });
        if (loadSignal.aborted) return;
        if (status.beam) dataObj = buildBeamAnalysisData({
          data: dataObj,
          snapshot: snapshot
        });
        var cliInfo = {
          owner: 'local',
          repo: 'cli',
          name: cliMeta.title,
          cliRoot: cliMeta.sourceKey
        };
        var keep = retainCliWatchPathsAfterAnalysis(cliWatchDuringRef.current, cliWatchReadRef.current, cliWatchSnapRevRef.current);
        cliAnalyzingRef.current = false;
        cliWatchDuringRef.current = [];
        cliWatchReadRef.current = Object.create(null);
        cliWatchSnapRevRef.current = Object.create(null);
        if (loadSignal.aborted) return;
        setData(dataObj);
        setRepoInfo(cliInfo);
        setCachedFromId(null);
        setCliDirty(keep);
        clearCliLiveDiffs();
        persistCurrentAnalysis(dataObj, {
          sourceType: 'cli',
          sourceKey: cliMeta.sourceKey,
          title: cliMeta.title,
          repoUrl: '',
          repoInfo: cliInfo,
          localSourceKind: 'cli'
        });
        setLoading(false);
        return true;
      } catch (err) {
        if (loadSignal.aborted) return;
        cliAnalyzingRef.current = false;
        cliWatchDuringRef.current = [];
        cliWatchReadRef.current = Object.create(null);
        cliWatchSnapRevRef.current = Object.create(null);
        setError('CLI analysis failed: ' + (err.message || err));
        setLoading(false);
      }
    }
    function resetAnalysisState() {
      projectLoading.begin();
      onReset({
        cached: false
      });
      cliAnalyzingRef.current = false;
      setError(null);
      setData(null);
      setCachedFromId(null);
      setCliDirty([]);
      clearCliLiveDiffs();
    }
    function analyze(forceRefresh, explicitUrl) {
      var p = parseUrl(explicitUrl || repoUrl);
      if (!p) {
        setError('Invalid URL. Use format: owner/repo');
        return;
      }
      if (explicitUrl) onRepositoryURL(explicitUrl);
      var shouldForce = forceRefresh === true;
      var githubKey = githubCacheSourceKey(p.owner, p.repo, activeExcludePatterns);
      var cacheId = analysisCacheKey('github', githubKey);
      if (!shouldForce) {
        const cacheSignal = projectLoading.begin();
        getRecentAnalysis(cacheId).then(function (record) {
          if (cacheSignal.aborted) return;
          if (record && record.data && cachedAnalysisMatchesExcludes(record, activeExcludePatterns)) {
            applyCachedAnalysis(record);
            return;
          }
          analyze(true, p.owner + '/' + p.repo);
        }).catch(function () {
          if (!cacheSignal.aborted) analyze(true, p.owner + '/' + p.repo);
        });
        return;
      }
      var currentExcludePatterns = activeExcludePatterns;

      // Validate authentication inputs
      if (authMethod === 'pat' && !token) {
        setError('Please enter a Personal Access Token');
        return;
      }
      if (authMethod === 'github_app') {
        if (!appId) {
          setError('Please enter the GitHub App ID');
          return;
        }
        if (!privateKey) {
          setError('Please set the GitHub App private key');
          return;
        }
      }
      resetAnalysisState();
      const loadSignal = projectLoading.signal;
      setLocalDirHandle(null);
      setLocalSourceKind(null);
      zipArchiveRef.current = null;
      zipFileRef.current = null;
      setLoading(true);
      setProgress('Initializing...');

      // Configure GitHub authentication based on method
      GitHub.token = null;
      GitHub.appId = null;
      GitHub.privateKey = null;
      GitHub.installationToken = null;
      if (authMethod === 'pat') {
        GitHub.token = token;
      } else if (authMethod === 'github_app') {
        GitHub.appId = appId;
        GitHub.privateKey = privateKey;
      }
      setRepoInfo(p);

      // Authentication promise - resolve immediately for no auth/PAT, authenticate for GitHub App
      var authPromise;
      if (authMethod === 'github_app') {
        setProgress('Authenticating with GitHub App...');
        authPromise = GitHub.authenticateApp(p.owner, p.repo, loadSignal).catch(function (err) {
          throw new Error('GitHub App authentication failed: ' + err.message);
        });
      } else {
        authPromise = Promise.resolve();
      }
      authPromise.then(function () {
        loadSignal.throwIfAborted();
        setProgress('Checking rate limit...');
        return GitHub.getRateLimit(loadSignal);
      }).then(function (rl) {
        loadSignal.throwIfAborted();
        var hasAuth = !!GitHub.token || authMethod === 'github_app';
        var estimatedRequests = 50; // Conservative estimate for a small-medium repo

        // Warn if rate limit is very low and no authentication
        if (!hasAuth && rl.remaining < estimatedRequests) {
          var resetTime = new Date(rl.reset * 1000).toLocaleTimeString();
          return requestConfirm({
            tone: 'warning',
            icon: 'warning',
            title: 'GitHub API rate limit is low',
            message: 'Remaining requests: ' + rl.remaining + '/' + rl.limit + '\n' + 'Resets at: ' + resetTime + '\n\n' + 'The folder picker is faster when the API is rate-limited. Open Folder and analyze locally, or download a ZIP and use Open ZIP.\n\n' + 'Without authentication, you only get 60 requests per hour.\n' + 'Adding a token or GitHub App raises that to 5,000 requests per hour.\n\n' + 'Token (PAT): GitHub Settings -> Developer Settings -> Personal access tokens\n' + 'GitHub App: use App ID + Private Key for organization access\n\n' + 'Continue anyway with the remaining requests?',
            confirmLabel: 'Continue anyway'
          }).then(function (proceed) {
            loadSignal.throwIfAborted();
            if (!proceed) {
              setLoading(false);
              return Promise.reject('cancelled');
            }
            setProgress('Scanning repository...');
            return GitHub.scan(p.owner, p.repo, function (message) {
              if (!loadSignal.aborted) setProgress(message);
            }, currentExcludePatterns, loadSignal);
          });
        }
        setProgress('Scanning repository...');
        return GitHub.scan(p.owner, p.repo, function (message) {
          if (!loadSignal.aborted) setProgress(message);
        }, currentExcludePatterns, loadSignal);
      }).then(function (files) {
        loadSignal.throwIfAborted();
        if (!files) return; // Cancelled
        if (!files.length) throw new Error(currentExcludePatterns.length ? 'No code files found after applying exclude patterns' : 'No code files found');
        var SOFT_LIMIT = ANALYSIS_LIMITS.repoSoft;
        async function beginRepoAnalysis() {
          const analyzed = await readCollectedFiles(files.map(file => ({
            ...file,
            read: async () => {
              const [content, commits] = await Promise.all([GitHub.getFile(p.owner, p.repo, file.path, loadSignal), isCode(file.name) ? GitHub.getCommits(p.owner, p.repo, file.path, 10, loadSignal) : Promise.resolve([])]);
              if (typeof content !== 'string') throw new Error('GitHub source request failed');
              return {
                content,
                churn: Array.isArray(commits) ? commits.length : 0
              };
            }
          })), {
            signal: loadSignal,
            progress: message => {
              if (!loadSignal.aborted) setProgress(message);
            },
            yieldFn: yieldToBrowser
          });
          async function finishAnalysis() {
            if (loadSignal.aborted) return;
            try {
              var dataObj = await runAnalysisData({
                signal: loadSignal,
                files: analyzed,
                excludePatterns: currentExcludePatterns.map(function (x) {
                  return x.raw;
                }),
                progress: function (message) {
                  if (!loadSignal.aborted) setProgress(message);
                },
                yieldFn: yieldToBrowser
              });
              var failedCount = analyzed.filter(function (af) {
                return af.analysisSkipped === 'fetch-failed';
              }).length;
              if (failedCount > 0) {
                showNotification(failedCount + ' of ' + analyzed.length + ' files could not be fetched (GitHub rate limit?). Results are PARTIAL — add a token or use Open ZIP for full analysis.', 'warning');
              }
              if (loadSignal.aborted) return;
              setData(dataObj);
              setCachedFromId(null);
              persistCurrentAnalysis(dataObj, {
                sourceType: 'github',
                sourceKey: githubKey,
                title: p.owner + '/' + p.repo,
                repoUrl: p.owner + '/' + p.repo,
                repoInfo: p,
                localSourceKind: null
              });
              window.history.replaceState({}, '', buildAppUrl(p.owner + '/' + p.repo, false));
              setLoading(false);
            } catch (err) {
              if (loadSignal.aborted) return;
              setError('Analysis failed: ' + (err.message || err) + '. Try a smaller repository.');
              setLoading(false);
            }
          }
          await finishAnalysis();
        }
        if (files.length > SOFT_LIMIT) {
          return requestConfirm({
            tone: 'warning',
            icon: 'warning',
            title: 'Analyze a large repository?',
            message: 'This repository has ' + files.length + ' files.\n\n' + 'Analyzing larger repositories can take longer and may hit GitHub API rate limits.\n\n' + 'The folder picker is faster when the API is rate-limited. You can also download a ZIP and use Open ZIP.\n\n' + 'Tip: add a token or GitHub App for higher limits.',
            confirmLabel: 'Analyze repository'
          }).then(function (proceed) {
            loadSignal.throwIfAborted();
            if (!proceed) {
              setLoading(false);
              return Promise.reject('cancelled');
            }
            return beginRepoAnalysis();
          });
        }
        return beginRepoAnalysis();
      }).catch(function (e) {
        if (!loadSignal.aborted && e !== 'cancelled') {
          setError(e.message || e);
          setLoading(false);
        }
      });
    }
    function refreshAnalysis(record) {
      var source = record && record.sourceType ? record : null;
      var kind = source ? source.sourceType : localSourceKind || (parseUrl(repoUrl) ? 'github' : null);
      var githubUrl = source ? source.repoUrl || source.sourceKey : repoUrl;
      setCachedFromId(null);
      if (kind === 'cli' || !source && cliStatus && cliStatus.ok && localSourceKind === 'cli') {
        var wantedRoot = source && source.sourceType === 'cli' ? source.sourceKey : '';
        if (wantedRoot && cliStatus && cliStatus.ok && !cliRecordMatchesStatus(source, cliStatus)) {
          applyCachedAnalysis(source);
          showNotification('Restart the CLI in that folder to re-analyze it.', 'warning');
          return;
        }
        Promise.resolve(analyzeFromCli(true, cliStatus, wantedRoot || null)).then(function (ok) {
          if (ok === false && source) applyCachedAnalysis(source);
        });
        return;
      }
      if (kind === 'folder') {
        var retained = {
          sourceKey: localFolderKeyRef.current
        };
        var handleMatches = !source || retainedFolderMatchesRecord(source, retained);
        if (localDirHandle && handleMatches) {
          resetAnalysisState();
          setLoading(true);
          setProgress('Reading local folder...');
          readLocalFolder(localDirHandle, activeExcludePatterns);
          return;
        }
        if (localFilesRef.current && handleMatches) {
          resetAnalysisState();
          setLoading(true);
          setProgress('Reading local folder...');
          readLocalFolderFromFiles(localFilesRef.current, activeExcludePatterns);
          return;
        }
        if (source) applyCachedAnalysis(source);
        showNotification('Open Folder again to re-analyze this local tree.', 'warning');
        return;
      }
      if (kind === 'zip') {
        var zipMatches = !source || retainedZipMatchesRecord(source, {
          sourceKey: zipKeyRef.current,
          identity: zipFileIdentity(zipFileRef.current)
        });
        if (!zipFileRef.current || !zipMatches) {
          if (source) applyCachedAnalysis(source);
          showNotification('Open ZIP again to re-analyze this archive.', 'warning');
          return;
        }
        resetAnalysisState();
        setLocalDirHandle(null);
        setLocalSourceKind('zip');
        zipArchiveRef.current = null;
        setLoading(true);
        setProgress('Reading ZIP archive...');
        readZipArchive(zipFileRef.current, activeExcludePatterns);
        return;
      }
      if (kind === 'github' || parseUrl(githubUrl)) {
        analyze(true, githubUrl);
        return;
      }
      analyze(true);
    }
    function readLocalFolder(dirHandle, patterns) {
      return loadLocalCollection({
        kind: 'folder',
        patterns,
        title: dirHandle.name,
        collect: options => collectDirectory(dirHandle, options)
      });
    }
    function readLocalFolderFromFiles(fileObjs, patterns) {
      return loadLocalCollection({
        kind: 'folder',
        patterns,
        collect: options => collectSelectedFiles(fileObjs, options)
      });
    }
    function readZipArchive(zipFile, patterns) {
      return loadLocalCollection({
        kind: 'zip',
        patterns,
        zipFile,
        collect: async options => {
          if (!JSZip) throw new Error('ZIP support failed to load');
          const zip = await JSZip.loadAsync(zipFile);
          options.signal.throwIfAborted();
          return {
            ...(await collectArchive(zip, options)),
            zip
          };
        }
      });
    }
    async function loadLocalCollection({
      kind,
      patterns = activeExcludePatterns,
      title,
      zipFile,
      collect
    }) {
      const signal = projectLoading.signal;
      const progress = message => {
        if (!signal.aborted) setProgress(message);
      };
      const archive = kind === 'zip';
      const label = archive ? 'ZIP archive' : 'selected folder';
      try {
        progress(archive ? 'Reading ZIP archive...' : 'Scanning local folder...');
        const collection = await collect({
          patterns,
          signal,
          progress
        });
        signal.throwIfAborted();
        if (!collection.files.length) throw new Error('No code files found in the ' + label + (patterns.length ? ' after applying exclude patterns' : ''));
        if (collection.files.length > ANALYSIS_LIMITS.localSoft) {
          const proceed = await requestConfirm({
            tone: 'warning',
            icon: archive ? 'archive' : 'folder',
            title: 'Analyze ' + collection.files.length + ' files?',
            message: 'CodeFlow will analyze every eligible file. Large ' + (archive ? 'archives' : 'folders') + ' can take minutes and use significant browser memory.',
            confirmLabel: 'Analyze all files'
          });
          signal.throwIfAborted();
          if (!proceed) {
            if (archive) {
              setLocalSourceKind(null);
              zipFileRef.current = null;
            }
            setLoading(false);
            return;
          }
        }
        const files = await readCollectedFiles(collection.files, {
          signal,
          progress,
          yieldFn: yieldToBrowser
        });
        const dataObj = await runAnalysisData({
          signal,
          files,
          excludePatterns: patterns.map(x => x.raw),
          progress,
          yieldFn: yieldToBrowser
        });
        signal.throwIfAborted();
        let meta, info;
        if (archive) {
          meta = zipArchiveCacheMeta({
            name: zipFile.name,
            size: zipFile.size,
            lastModified: zipFile.lastModified,
            paths: files.map(f => f.path)
          });
          info = {
            owner: 'local',
            repo: 'zip',
            name: meta.title,
            zipKey: meta.sourceKey
          };
          zipArchiveRef.current = {
            zip: collection.zip,
            entriesByPath: collection.entriesByPath,
            name: zipFile.name
          };
          zipFileRef.current = zipFile;
          zipKeyRef.current = meta.sourceKey;
          setLocalDirHandle(null);
          setLocalSourceKind('zip');
        } else {
          if (!localFolderSelectionRef.current) localFolderSelectionRef.current = newLocalSelectionId();
          meta = localFolderCacheMeta({
            title,
            rootPrefix: collection.rootPrefix,
            paths: files.map(f => f.path),
            selectionId: localFolderSelectionRef.current
          });
          info = {
            owner: 'local',
            repo: 'folder',
            name: meta.title,
            folderKey: meta.sourceKey,
            folderSelectionId: meta.selectionId
          };
          localFolderKeyRef.current = meta.sourceKey;
        }
        setData(dataObj);
        setRepoInfo(info);
        setCachedFromId(null);
        persistCurrentAnalysis(dataObj, {
          sourceType: kind,
          sourceKey: meta.sourceKey,
          title: meta.title,
          repoUrl: '',
          repoInfo: info,
          localSourceKind: kind
        });
        setLoading(false);
      } catch (error) {
        if (signal.aborted) return;
        if (archive) {
          setLocalSourceKind(null);
          zipArchiveRef.current = null;
        }
        setError('Failed to analyze ' + label + ': ' + (error.message || error));
        setLoading(false);
      }
    }
    function readCliWatchLiveSource(path) {
      if (!path) return Promise.resolve({
        kind: 'error'
      });
      return fetch('/__codeflow/file?path=' + encodeURIComponent(path)).then(function (res) {
        var length = Number(res.headers && res.headers.get ? res.headers.get('content-length') : NaN);
        if (cliWatchLiveRejectsOversized(length)) {
          if (res.body && typeof res.body.cancel === 'function') res.body.cancel();
          return {
            kind: 'error'
          };
        }
        if (res.ok) return res.text().then(function (text) {
          return cliWatchLiveFromResponse(res.status, text, true, length);
        });
        return cliWatchLiveFromResponse(res.status, '', false);
      }).catch(function () {
        return {
          kind: 'error'
        };
      });
    }
    async function readLiveFileSource(path) {
      if (!projectSource) return null;
      const hydrationId = currentHydrationId;
      try {
        const result = await projectSource.read(path, {
          signal: sourceReads.signal
        });
        if (result.status !== 'ready') return null;
        rememberHydratedSources([{
          path,
          content: result.content,
          hydrationId
        }]);
        return result.content;
      } catch (error) {
        if (error.name === 'AbortError') return null;
        throw error;
      }
    }
    function rememberHydratedSources(updates) {
      if (!updates || !updates.length) return;
      setData(function (prev) {
        return mergeHydratedFileSources(prev, updates, analysisHydrationIdRef.current);
      });
    }
    enqueueCliWatchDiffRef.current = enqueueCliWatchDiff;
    const projectSource = createProjectSource({
      identity: currentAnalysisSource(),
      cli: cliStatus,
      folder: {
        handle: localDirHandle,
        sourceKey: localFolderKeyRef.current
      },
      archive: {
        entriesByPath: zipArchiveRef.current && zipArchiveRef.current.entriesByPath,
        sourceKey: zipKeyRef.current,
        file: zipFileRef.current
      },
      github: repoInfo ? {
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        client: GitHub
      } : null
    });
    const sourceReads = useMemo(() => new AbortController(), [currentHydrationId]);
    useEffect(() => () => sourceReads.abort(), [sourceReads]);
    function ensureSources(paths) {
      var missing = filesNeedingSource((data?.files || []).filter(file => paths.includes(file.path)));
      if (!missing.length || !projectSource) return;
      var inflight = codeSourceInFlightRef.current;
      var hydrationId = analysisHydrationIdRef.current;
      nextCodeSourceReads(missing.map(function (file) {
        return file.path;
      }), inflight, codeSourceFailed).forEach(function (path) {
        inflight[path] = true;
        readLiveFileSource(path).then(function (content) {
          if (typeof content === 'string') {
            setCodeSourceFailed(function (prev) {
              return clearCodeSourceFailureIfCurrent(prev, path, hydrationId, analysisHydrationIdRef.current);
            });
            return;
          }
          setCodeSourceFailed(function (prev) {
            return recordCodeSourceFailureIfCurrent(prev, path, hydrationId, analysisHydrationIdRef.current);
          });
        }).then(function () {
          delete inflight[path];
        }, function () {
          delete inflight[path];
          setCodeSourceFailed(function (prev) {
            return recordCodeSourceFailureIfCurrent(prev, path, hydrationId, analysisHydrationIdRef.current);
          });
        });
      });
    }
    function retrySource(path) {
      delete codeSourceInFlightRef.current[path];
      setCodeSourceFailed(prev => clearCodeSourceFailure(prev, path));
    }
    useEffect(() => {
      codeSourceInFlightRef.current = Object.create(null);
      setCodeSourceFailed(Object.create(null));
    }, [loadedSourceIdentity?.sourceType, loadedSourceIdentity?.sourceKey]);
    useEffect(() => {
      refreshRecentList();
      const close = probeCodeflowCli();
      return () => {
        projectLoading.dispose();
        close();
        clearTimeout(persistTimerRef.current);
        clearTimeout(cliDiffTimerRef.current);
      };
    }, []);
    // Public commands own selection changes; renderer/modal state stays with their callers.
    function openFolder(handle, patterns = activeExcludePatterns) {
      resetAnalysisState();
      setRepoInfo(null);
      localFolderKeyRef.current = null;
      localFolderSelectionRef.current = newLocalSelectionId();
      setLocalDirHandle(handle);
      setLocalSourceKind('folder');
      zipArchiveRef.current = null;
      zipFileRef.current = null;
      setLoading(true);
      setProgress('Reading local folder...');
      return readLocalFolder(handle, patterns);
    }
    function openSelectedFiles(fileObjs, patterns = activeExcludePatterns) {
      localFilesRef.current = Array.from(fileObjs);
      resetAnalysisState();
      setRepoInfo(null);
      localFolderKeyRef.current = null;
      localFolderSelectionRef.current = newLocalSelectionId();
      setLocalDirHandle(null);
      setLocalSourceKind('folder');
      zipArchiveRef.current = null;
      zipFileRef.current = null;
      setLoading(true);
      setProgress('Reading local folder...');
      return readLocalFolderFromFiles(localFilesRef.current, patterns);
    }
    function openArchive(file) {
      resetAnalysisState();
      setRepoInfo(null);
      setLocalDirHandle(null);
      setLocalSourceKind('zip');
      zipArchiveRef.current = null;
      zipFileRef.current = file;
      zipKeyRef.current = null;
      setLoading(true);
      setProgress('Reading ZIP archive...');
      return readZipArchive(file, activeExcludePatterns);
    }
    function clear() {
      projectLoading.dispose();
      setLoading(false);
      setError(null);
      cliAnalyzingRef.current = false;
      setData(null);
      setRepoInfo(null);
      setLocalDirHandle(null);
      setLocalSourceKind(null);
      setCachedFromId(null);
      setCliDirty([]);
      clearCliLiveDiffs();
      localFolderKeyRef.current = null;
      localFolderSelectionRef.current = null;
      localFilesRef.current = null;
      zipKeyRef.current = null;
      zipArchiveRef.current = null;
      zipFileRef.current = null;
    }
    return {
      data,
      repoInfo,
      localSourceKind,
      source: currentAnalysisSource(),
      identity: loadedSourceIdentity,
      hydrationId: currentHydrationId,
      loading,
      progress,
      error,
      recentAnalyses,
      cachedFromId,
      cliStatus,
      cliDirty,
      cliLiveByPath,
      beamAnalysis,
      localTools,
      sourceAvailable: !!projectSource,
      codeSourceFailed,
      openGitHub: url => analyze(false, url),
      openFolder,
      openSelectedFiles,
      openArchive,
      openRecent: loadRecentAnalysis,
      refreshRecent: reanalyzeRecent,
      refresh: refreshAnalysis,
      removeRecent: removeRecentAnalysis,
      ensureSources,
      readSource: readLiveFileSource,
      retrySource,
      clear,
      dismissError: () => setError(null)
    };
  };
}
