// One subscription owns its requests, revisions and timer. Reopening a project
// creates a new subscription so unchanged diagnostics reach the new code index.
export function subscribeCliAnalysis({onUpdate, fetch: request = globalThis.fetch, interval = 2500}) {
    const controller = new AbortController();
    let timer, graphRevision, diagnosticsRevision, lastAnalysis;

    async function read(path) {
        const response = await request(path, {signal: controller.signal});
        if (!response.ok) throw new Error(`Local project service returned ${response.status}`);
        return response.json();
    }

    function diagnosticsFor(analysis) {
        return [
            {id: 'elixir-ls', name: 'ElixirLS', status: analysis.language.state,
                reason: analysis.language.reason, findings: analysis.language.diagnostics},
            {id: 'credo', name: 'Credo', status: analysis.assessment.status,
                reason: analysis.assessment.reason, findings: analysis.assessment.findings}
        ];
    }

    async function poll() {
        try {
            const analysis = await read('/__codeflow/analysis');
            if (controller.signal.aborted) return;
            lastAnalysis = analysis;
            const diagnostics = diagnosticsFor(analysis);
            const revision = JSON.stringify(diagnostics);
            onUpdate({analysis, diagnostics: revision === diagnosticsRevision ? null : diagnostics});
            diagnosticsRevision = revision;
            if (analysis.graphRevision && analysis.graphRevision !== graphRevision) {
                try {
                    const graph = await read('/__codeflow/beam');
                    if (controller.signal.aborted) return;
                    onUpdate({graph, diagnostics: [{id: 'mix', name: 'Mix compiler graph',
                        status: graph.status, reason: (graph.warnings || []).join('\n') || null}]});
                    graphRevision = analysis.graphRevision;
                } catch (error) {
                    if (controller.signal.aborted) return;
                    // A failed graph refresh says nothing about the language server
                    // or linter. Retain the last graph and retry on the next poll.
                    onUpdate({diagnostics: [{id: 'mix', name: 'Mix compiler graph',
                        status: 'unavailable', reason: error.message}]});
                }
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            // Keep the last diagnostics while reporting that the tool connection is unavailable.
            const analysis = {
                language: {...lastAnalysis?.language, state: 'unavailable', reason: error.message},
                assessment: {...lastAnalysis?.assessment, status: 'unavailable', reason: error.message}
            };
            onUpdate({analysis, diagnostics: diagnosticsFor(analysis)});
            diagnosticsRevision = null;
        } finally {
            if (!controller.signal.aborted) timer = setTimeout(poll, interval);
        }
    }

    void poll();
    return () => {
        controller.abort();
        clearTimeout(timer);
    };
}
