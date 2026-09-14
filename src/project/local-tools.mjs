import {cliRecordMatchesStatus} from './identity.mjs';

// Language navigation and runtime inspection require the server for this checkout.
// A connection owns its in-flight requests; replacing it invalidates every result.
export function createLocalTools({identity, status, fetch: request = globalThis.fetch}) {
    if (identity?.sourceType !== 'cli' || !cliRecordMatchesStatus(identity, status)) return null;
    const requests = new Map();
    let disposed = false;
    async function read(channel, path) {
        if (disposed) throw new DOMException('Project connection closed', 'AbortError');
        requests.get(channel)?.abort();
        const controller = new AbortController();
        requests.set(channel, controller);
        try {
            const response = await request(path, {signal: controller.signal});
            const result = await response.json();
            controller.signal.throwIfAborted();
            if (!response.ok) throw new Error(result.error || `Local tool request failed (${response.status})`);
            return result;
        } finally {
            if (requests.get(channel) === controller) requests.delete(channel);
        }
    }
    return {
        language(method, path, position) {
            const query = new URLSearchParams({method, path});
            if (position) {query.set('line', position.line);query.set('character', position.character);}
            return read(method === 'symbols' ? 'outline' : 'navigation', '/__codeflow/language?' + query);
        },
        runtime(node) {return read('runtime', '/__codeflow/runtime?' + new URLSearchParams({node}));},
        dispose() {
            disposed = true;
            for (const controller of requests.values()) controller.abort();
            requests.clear();
        }
    };
}
