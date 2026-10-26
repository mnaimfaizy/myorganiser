// Loads the Nx project graph for the workspace-level check scripts.
//
// Both `check-lint-coverage.mjs` and `check-typecheck.mjs` need the same thing:
// every project's name, root, and targets, in one read rather than one
// `nx show project` per project. `nx graph --file` gives that in a single call.
//
// The graph path is overridable so a checker can be exercised against a fixture
// without an Nx workspace. CI's Test job builds one file and passes it to
// lint coverage, typecheck, and documented Nx targets (issue #1061); omitting
// the path still generates a graph, which is how a local run and Review Tier
// work. When the path is omitted the temp directory is removed on every path,
// including a failed `nx graph` or a file that is not JSON.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Thrown when the graph cannot be produced or parsed. Callers exit 2. */
export class GraphUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphUnavailableError';
  }
}

export interface ProjectGraphNode {
  name: string;
  data: {
    root: string;
    tags?: string[];
    targets: Record<string, unknown>;
  };
}

export interface ProjectGraphDependency {
  source: string;
  target: string;
  type: string;
}

export interface ProjectGraph {
  nodes: Record<string, ProjectGraphNode>;
  dependencies: Record<string, ProjectGraphDependency[]>;
}

interface RawNxGraphFile {
  graph?: {
    nodes?: Record<string, ProjectGraphNode>;
    dependencies?: Record<string, ProjectGraphDependency[]>;
  };
  nodes?: Record<string, ProjectGraphNode>;
  dependencies?: Record<string, ProjectGraphDependency[]>;
}

/**
 * `dependencies` is what the Review Tier classifier walks to find the projects a
 * change reaches (ADR 0070 item 4); an older graph file without it yields `{}`.
 *
 * @param graphArg Path to an existing graph JSON, or undefined to generate one.
 */
export function loadProjectGraph(graphArg: string | undefined): ProjectGraph {
  let file = graphArg;
  let cleanup: () => void = () => undefined;

  if (file) {
    if (!existsSync(file)) {
      throw new GraphUnavailableError(`${file} not found`);
    }
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'nx-graph-'));
    cleanup = () => rmSync(dir, { recursive: true, force: true });
    file = join(dir, 'graph.json');
    const result = spawnSync('npx', ['nx', 'graph', '--file', file], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0 || !existsSync(file)) {
      cleanup();
      throw new GraphUnavailableError(
        `nx graph failed: ${result.stderr?.trim() || 'no output'}`,
      );
    }
  }

  let parsed: RawNxGraphFile;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as RawNxGraphFile;
  } catch (error) {
    cleanup();
    const message = error instanceof Error ? error.message : String(error);
    throw new GraphUnavailableError(`${file} is not valid JSON: ${message}`);
  }
  cleanup();

  const nodes = parsed.graph?.nodes ?? parsed.nodes;
  if (!nodes || Object.keys(nodes).length === 0) {
    throw new GraphUnavailableError(`${file} has no project nodes`);
  }

  const dependencies = parsed.graph?.dependencies ?? parsed.dependencies ?? {};
  return { nodes, dependencies };
}
