import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// The launcher supplies a guard-filtered snapshot for one worktree. Requests
// only address entries in this map and cannot cause filesystem access.
type ServiceContext = Record<string, string | Record<string, string>> & {
  files: Record<string, string>;
  issues: Record<string, string>;
};
interface Request {
  id?: string | number;
  method: string;
  params: {
    protocolVersion: string;
    name: string;
    arguments: Record<string, unknown>;
  };
}
interface Reply {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}
const entries: Array<[string, string]> = JSON.parse(
  readFileSync(process.argv[2], 'utf8'),
);
if (!Array.isArray(entries)) throw new Error('Invalid source snapshot');
const files = new Map(entries);
const role = process.argv[3] || 'CodeExplorer';
const context = process.argv[4]
  ? JSON.parse(readFileSync(process.argv[4], 'utf8'))
  : ({} as ServiceContext);
const sourceDefinitions = [
  ['read_source', 'path', 'Read a captured source file.'],
  [
    'find_filename',
    'query',
    'Find captured filenames containing literal text.',
  ],
  ['find_content', 'query', 'Find literal text in captured source files.'],
];
const definitions =
  role === 'Commit'
    ? [
        ['staged_status', null, 'Read staged file status.'],
        ['staged_diff', null, 'Read the staged diff.'],
      ]
    : role === 'PrAuthor'
      ? [
          [
            'branch_summary',
            null,
            'Read branch and base details and diff statistics.',
          ],
          ['merge_base', null, 'Read the computed merge base.'],
          ['branch_commits', null, 'Read branch commits.'],
          ['branch_diff', null, 'Read the branch diff.'],
          ['read_source', 'path', 'Read a changed file from HEAD.'],
          ['read_issue', 'number', 'Read an issue referenced by the branch.'],
        ]
      : role === 'CodeExplorer'
        ? sourceDefinitions
        : (() => {
            throw new Error('Unsupported role');
          })();
const tools = definitions.map(([name, field, description]) => ({
  name,
  description,
  annotations: { readOnlyHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object',
    properties: field
      ? {
          [field]: { type: 'string', minLength: 1, maxLength: 256 },
          ...(name === 'read_source'
            ? { offset: { type: 'integer', minimum: 0 } }
            : {}),
        }
      : {},
    required: field ? [field] : [],
    additionalProperties: false,
  },
}));

function execute(name: string, args: Record<string, unknown>) {
  const definition = definitions.find(([id]) => id === name);
  if (
    !definition ||
    !args ||
    Object.keys(args).some(
      (key) =>
        key !== definition[1] && !(name === 'read_source' && key === 'offset'),
    ) ||
    Object.keys(args).length < (definition[1] ? 1 : 0)
  ) {
    throw new Error('Unsupported request');
  }
  if (!definition[1]) {
    const result = context[name];
    if (typeof result !== 'string') throw new Error('Missing captured context');
    return result;
  }
  const value = args[definition[1]];
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('Invalid argument');
  }
  if (name === 'read_source') {
    const offset = args.offset ?? 0;
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw new Error('Invalid offset');
    let content;
    if (role === 'PrAuthor') {
      if (!Object.hasOwn(context.files, value))
        throw new Error('File is outside captured branch changes');
      content = context.files[value];
    } else {
      if (!files.has(value))
        throw new Error('Path outside approved source set');
      content = files.get(value);
    }
    if (offset > content.length) throw new Error('Offset exceeds file length');
    const next = offset + 8192;
    return JSON.stringify({
      content: content.slice(offset, next),
      nextOffset: next < content.length ? next : null,
    });
  }
  if (name === 'read_issue') {
    if (!/^\d+$/.test(value) || !Object.hasOwn(context.issues, value))
      throw new Error('Issue is outside branch references');
    return context.issues[value];
  }
  const hits = [];
  for (const [path, content] of files) {
    if (name === 'find_filename' && path.includes(value)) hits.push(path);
    if (name === 'find_content') {
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        if (line.includes(value)) {
          hits.push({ path, line: index + 1, text: line.slice(0, 200) });
        }
        if (hits.length === 20) break;
      }
    }
    if (hits.length === 20) break;
  }
  return JSON.stringify(hits);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.length > 65536) break;
  const request: Request = JSON.parse(line);
  if (request.id === undefined) continue;
  const reply: Reply = { jsonrpc: '2.0', id: request.id };
  switch (request.method) {
    case 'initialize':
      reply.result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'myorganiser-source', version: '1.0.0' },
      };
      break;
    case 'tools/list':
      reply.result = { tools };
      break;
    case 'tools/call':
      try {
        reply.result = {
          content: [
            {
              type: 'text',
              text: execute(request.params.name, request.params.arguments),
            },
          ],
        };
      } catch (error) {
        reply.result = {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Request failed',
            },
          ],
        };
      }
      break;
    case 'ping':
      reply.result = {};
      break;
    default:
      reply.error = { code: -32601, message: 'Unsupported method' };
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
}
