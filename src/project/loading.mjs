// A new selection replaces the previous load, including its reads and worker.
export function createProjectLoading() {
    let active;
    return {
        begin() {
            active?.abort();
            active = new AbortController();
            return active.signal;
        },
        get signal() {return active?.signal;},
        dispose() {active?.abort();}
    };
}
