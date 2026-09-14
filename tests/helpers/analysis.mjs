import { createParser } from '../../src/analysis/parser.mjs';
import { createProjectAnalyzer } from '../../src/analysis/project.mjs';

// Tests of the documented regex fallback choose it explicitly. Grammar tests
// use the same Node entry point as the CLI/card consumer instead.
export function createRegexAnalyzer() {
  const Parser = createParser({ TreeSitter: undefined, acorn: undefined, Babel: undefined });
  return { Parser, ...createProjectAnalyzer(Parser) };
}
export { createNodeAnalyzer } from '../../src/node/analysis.mjs';
