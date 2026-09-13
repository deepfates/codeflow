import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
const connection = createMessageConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));
const opened = new Map();
connection.onRequest('initialize', () => ({ capabilities: {} }));
connection.onNotification('workspace/didChangeConfiguration', () => connection.sendNotification('telemetry/event', { name: 'build', properties: { 'elixir_ls.build_result': 'mix_compile_ok' } }));
connection.onNotification('textDocument/didOpen', ({ textDocument }) => {
  opened.set(textDocument.uri, textDocument);
  connection.sendNotification('textDocument/publishDiagnostics', { uri: textDocument.uri, diagnostics: [{ message: 'unused variable x', severity: 2, range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } } }] });
});
connection.onNotification('textDocument/didChange', ({ textDocument, contentChanges }) => opened.set(textDocument.uri, { ...textDocument, text: contentChanges[0].text }));
connection.onRequest('textDocument/documentSymbol', ({ textDocument }) => {
  const doc = opened.get(textDocument.uri);
  if (!doc) throw new Error('not opened');
  return [{ name: 'Fixture', kind: 2, detail: doc.text, children: [{ name: 'run/1', kind: 12 }] }];
});
connection.onRequest('workspace/symbol', ({ query }) => query === 'timeout' ? new Promise(() => {}) : []);
connection.onRequest('textDocument/definition', ({ textDocument, position }) => ({ uri: textDocument.uri, range: { start: position, end: position } }));
connection.onRequest('textDocument/references', ({ textDocument, position }) => [{ uri: textDocument.uri, range: { start: position, end: position } }, { uri: 'file:///outside/dependency.ex', range: { start: position, end: position } }]);
connection.onRequest('shutdown', () => null);
connection.onNotification('exit', () => process.exit(0));
connection.listen();
