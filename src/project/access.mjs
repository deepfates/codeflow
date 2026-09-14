import {cliRecordMatchesStatus, retainedFolderMatchesRecord, retainedZipMatchesRecord, zipFileIdentity} from './identity.mjs';

async function readFolder(root, path) {
    const parts = path.split('/');
    const name = parts.pop();
    let directory = root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    const handle = await directory.getFileHandle(name);
    return (await handle.getFile()).text();
}

// Bind source access to the loaded project's identity, not whichever local server
// or folder handle happens to remain available after switching projects.
export function createProjectSource({identity, cli, folder, archive, github, fetch: request = globalThis.fetch}) {
    if (!identity) return null;
    let read;
    switch (identity.sourceType) {
        case 'cli':
            if (!cliRecordMatchesStatus(identity, cli)) return null;
            read = async (path, signal) => {
                const response = await request('/__codeflow/file?path=' + encodeURIComponent(path), {signal});
                if (response.status === 404) return null;
                if (!response.ok) throw new Error(`Source request failed (${response.status})`);
                return response.text();
            };
            break;
        case 'folder':
            if (!folder?.handle || !retainedFolderMatchesRecord(identity, folder)) return null;
            read = path => readFolder(folder.handle, path);
            break;
        case 'zip':
            if (!archive?.entriesByPath || !retainedZipMatchesRecord(identity, {
                sourceKey: archive.sourceKey, identity: zipFileIdentity(archive.file)
            })) return null;
            read = path => archive.entriesByPath[path]?.async('string') ?? null;
            break;
        case 'github':
            if (!github?.owner || !github.repo || !github.client) return null;
            if (identity.sourceKey.split('|excl:')[0] !== github.owner + '/' + github.repo) return null;
            read = path => github.client.getFile(github.owner, github.repo, path);
            break;
        default:
            return null;
    }
    return {
        identity: {...identity},
        async read(path, {signal} = {}) {
            if (!path || path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.')) {
                return {status: 'unavailable', reason: 'Expected a project-relative file path'};
            }
            try {
                signal?.throwIfAborted();
                const content = await read(path, signal);
                signal?.throwIfAborted();
                if (typeof content === 'string') return {status: 'ready', content};
                return identity.sourceType === 'github'
                    ? {status: 'unavailable', reason: 'GitHub did not return file contents'}
                    : {status: 'missing'};
            } catch (error) {
                if (signal?.aborted) throw error;
                if (error.name === 'NotFoundError') return {status: 'missing'};
                return {status: 'unavailable', reason: error.message};
            }
        }
    };
}
