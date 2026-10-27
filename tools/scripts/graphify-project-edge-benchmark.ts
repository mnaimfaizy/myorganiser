import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_EDGE_RELATIONS = new Set([
  'dynamic_import',
  'imports',
  'imports_from',
  're_exports',
]);

interface GraphifyNode {
  id: string;
  label?: string;
  source_file?: string;
}

interface GraphifyLink {
  source: string;
  target: string;
  relation: string;
}

interface GraphifyGraph {
  directed?: boolean;
  built_at_commit?: string;
  nodes?: GraphifyNode[];
  links?: GraphifyLink[];
  edges?: GraphifyLink[];
}

interface NxDependency {
  source: string;
  target: string;
  type: string;
}

interface NxGraph {
  nodes?: Record<string, { data?: { root?: string } }>;
  dependencies?: Record<string, NxDependency[]>;
}

/** The installed `nx graph --print` output: a bare graph, or one wrapped in `{ graph }`. */
type NxOutput = NxGraph & { graph?: NxGraph };

export type ProjectEdge = [string, string];

export interface Project {
  name: string;
  root: string;
}

export interface ProjectEdgeComparison {
  graphifyEdges: number;
  nxEdges: number;
  intersection: number;
  falsePositives: ProjectEdge[];
  falseNegatives: ProjectEdge[];
  precision: number;
  recall: number;
  f1: number;
}

export interface GraphIntegrityReport {
  directed: boolean;
  builtAtCommit: string | null;
  currentCommit: string | null;
  freshAtHead: boolean | null;
  nodes: number;
  edges: number;
  missingEndpointEdges: number;
  ambiguousLabels: number;
}

export interface BenchmarkReport {
  integrity: GraphIntegrityReport;
  projects: number;
  metrics: ProjectEdgeComparison;
}

function normalizePath(filePath: string): string {
  return String(filePath).replaceAll('\\', '/').replace(/\/$/, '');
}

function edgeKey([source, target]: ProjectEdge): string {
  return `${source}\0${target}`;
}

function sortEdges(edges: Iterable<ProjectEdge>): ProjectEdge[] {
  return [...edges].sort(
    ([leftSource, leftTarget], [rightSource, rightTarget]) =>
      leftSource.localeCompare(rightSource) ||
      leftTarget.localeCompare(rightTarget),
  );
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}

export function ownerForSourceFile(
  sourceFile: string,
  projects: Project[],
): string | null {
  const normalizedSource = normalizePath(sourceFile);
  const candidates = projects
    .map(({ name, root }) => ({ name, root: normalizePath(root) }))
    .filter(
      ({ root }) =>
        normalizedSource === root || normalizedSource.startsWith(`${root}/`),
    )
    .sort((left, right) => right.root.length - left.root.length);

  return candidates[0]?.name ?? null;
}

export function projectEdgesFromGraphify(
  graph: GraphifyGraph,
  projects: Project[],
): ProjectEdge[] {
  const nodesById = new Map<string, GraphifyNode>(
    (graph.nodes ?? []).map((node) => [node.id, node]),
  );
  const edges = new Map<string, ProjectEdge>();

  for (const link of graph.links ?? graph.edges ?? []) {
    if (!PROJECT_EDGE_RELATIONS.has(link.relation)) {
      continue;
    }

    const sourceFile = nodesById.get(link.source)?.source_file;
    const targetFile = nodesById.get(link.target)?.source_file;
    if (!sourceFile || !targetFile) {
      continue;
    }

    const sourceProject = ownerForSourceFile(sourceFile, projects);
    const targetProject = ownerForSourceFile(targetFile, projects);
    if (!sourceProject || !targetProject || sourceProject === targetProject) {
      continue;
    }

    const edge: ProjectEdge = [sourceProject, targetProject];
    edges.set(edgeKey(edge), edge);
  }

  return sortEdges(edges.values());
}

export function compareProjectEdges(
  graphifyEdges: ProjectEdge[],
  nxEdges: ProjectEdge[],
): ProjectEdgeComparison {
  const graphifyByKey = new Map<string, ProjectEdge>(
    graphifyEdges.map((edge) => [edgeKey(edge), edge]),
  );
  const nxByKey = new Map<string, ProjectEdge>(
    nxEdges.map((edge) => [edgeKey(edge), edge]),
  );
  const intersection = [...graphifyByKey.keys()].filter((key) =>
    nxByKey.has(key),
  ).length;
  const precision = graphifyByKey.size ? intersection / graphifyByKey.size : 0;
  const recall = nxByKey.size ? intersection / nxByKey.size : 0;

  return {
    graphifyEdges: graphifyByKey.size,
    nxEdges: nxByKey.size,
    intersection,
    falsePositives: sortEdges(
      [...graphifyByKey]
        .filter(([key]) => !nxByKey.has(key))
        .map(([, edge]) => edge),
    ),
    falseNegatives: sortEdges(
      [...nxByKey]
        .filter(([key]) => !graphifyByKey.has(key))
        .map(([, edge]) => edge),
    ),
    precision: roundMetric(precision),
    recall: roundMetric(recall),
    f1: roundMetric(
      precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    ),
  };
}

export function projectsFromNxGraph(nxOutput: NxOutput): Project[] {
  const graph = nxOutput.graph ?? nxOutput;

  return Object.entries(graph.nodes ?? {})
    .map(([name, node]): { name: string; root: string | undefined } => ({
      name,
      root: node.data?.root,
    }))
    .filter(
      (entry): entry is Project =>
        typeof entry.root === 'string' && entry.root.length > 0,
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function staticProjectEdgesFromNxGraph(
  nxOutput: NxOutput,
): ProjectEdge[] {
  const graph = nxOutput.graph ?? nxOutput;
  const edges: ProjectEdge[] = [];

  for (const [source, dependencies] of Object.entries(
    graph.dependencies ?? {},
  )) {
    for (const dependency of dependencies) {
      if (dependency.type === 'static') {
        edges.push([source, dependency.target]);
      }
    }
  }

  return sortEdges(edges);
}

export function collectGraphIntegrity(
  graph: GraphifyGraph,
  currentCommit: string | null = null,
): GraphIntegrityReport {
  const nodeIds = new Set((graph.nodes ?? []).map(({ id }) => id));
  const labelsBySource = new Map<string, Set<string>>();
  let missingEndpointEdges = 0;

  for (const link of graph.links ?? graph.edges ?? []) {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) {
      missingEndpointEdges += 1;
    }
  }

  for (const node of graph.nodes ?? []) {
    if (!node.label || !node.source_file) {
      continue;
    }
    const key = String(node.label).toLowerCase();
    if (!labelsBySource.has(key)) {
      labelsBySource.set(key, new Set());
    }
    labelsBySource.get(key)?.add(node.source_file);
  }

  return {
    directed: graph.directed === true,
    builtAtCommit: graph.built_at_commit ?? null,
    currentCommit,
    freshAtHead:
      currentCommit === null || graph.built_at_commit === undefined
        ? null
        : graph.built_at_commit === currentCommit,
    nodes: nodeIds.size,
    edges: (graph.links ?? graph.edges ?? []).length,
    missingEndpointEdges,
    ambiguousLabels: [...labelsBySource.values()].filter(
      (sourceFiles) => sourceFiles.size > 1,
    ).length,
  };
}

export function createBenchmarkReport(
  graphifyGraph: GraphifyGraph,
  nxOutput: NxOutput,
  currentCommit: string | null = null,
): BenchmarkReport {
  const projects = projectsFromNxGraph(nxOutput);
  const graphifyEdges = projectEdgesFromGraphify(graphifyGraph, projects);
  const nxEdges = staticProjectEdgesFromNxGraph(nxOutput);

  return {
    integrity: collectGraphIntegrity(graphifyGraph, currentCommit),
    projects: projects.length,
    metrics: compareProjectEdges(graphifyEdges, nxEdges),
  };
}

interface CliOptions {
  graphPath: string;
  minimumF1: number;
  minimumRecall: number;
  help?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    graphPath: 'graphify-out/graph.json',
    minimumF1: 0.95,
    minimumRecall: 0.95,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--graph') {
      options.graphPath = argv[index + 1];
      index += 1;
    } else if (argument === '--min-f1') {
      options.minimumF1 = Number(argv[index + 1]);
      index += 1;
    } else if (argument === '--min-recall') {
      options.minimumRecall = Number(argv[index + 1]);
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage: yarn graphify:project-edges [options]

Options:
  --graph <path>       Graphify JSON path (default: graphify-out/graph.json)
  --min-f1 <number>    Minimum accepted F1 score (default: 0.95)
  --min-recall <value> Minimum accepted recall (default: 0.95)
  -h, --help           Show this help`);
}

function runCli(argv: string[]): void {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const graphifyGraph = JSON.parse(
    readFileSync(resolve(options.graphPath), 'utf8'),
  ) as GraphifyGraph;
  const nxOutput = JSON.parse(
    execFileSync('corepack', ['yarn', 'nx', 'graph', '--print'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  ) as NxOutput;
  const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
  const report = createBenchmarkReport(graphifyGraph, nxOutput, currentCommit);
  const passed =
    report.metrics.f1 >= options.minimumF1 &&
    report.metrics.recall >= options.minimumRecall;

  const warnings: string[] = [];
  if (report.integrity.freshAtHead === false) {
    warnings.push(
      `Graph was built at ${report.integrity.builtAtCommit}, current HEAD is ${currentCommit}.`,
    );
  }

  console.log(JSON.stringify({ passed, warnings, ...report }, null, 2));
  if (!passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2));
}
