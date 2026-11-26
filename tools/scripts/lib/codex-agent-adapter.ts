import { parse } from 'smol-toml';
import type { ToolsGrant } from './agent-tool-grants.ts';

// Native roles inherit the caller's permissions. Only register these adapters
// in a parent whose tool surface the workflow bridge has checked.
export const CODEX_ROLE_DIRECTORY = '.codex/bridge-roles';
const GRANT_PREFIX = '# Required bridge tools: ';

export function codexAdapter(
  name: string,
  description: string,
  model: string,
  body: string,
  grant: ToolsGrant,
): string {
  const toolGuidance: Record<string, string> = {
    CodeExplorer:
      'Use read_source, find_filename and find_content for inspection. Graphify is unavailable in this session. State that in Scope.',
    Commit:
      'Use staged_status and staged_diff to inspect the index. These fixed tools supply the Git inspection in the approach below.',
    PrAuthor:
      'Use branch_summary, merge_base, branch_commits, branch_diff, read_source and read_issue for the branch and issue inspection in the approach below. read_source exposes captured changed files at HEAD. read_issue accepts a referenced issue number as a string.',
  };
  const renderedBody = toolGuidance[name]
    ? `${toolGuidance[name]}\n\n${body}`
    : body;
  const instructions = renderedBody
    .split('\n')
    .map((line) => JSON.stringify(line).slice(1, -1))
    .join('\n');
  return [
    '# Generated from the canonical role and model policy.',
    GRANT_PREFIX + JSON.stringify(grant.tools),
    'name = ' + JSON.stringify(name),
    'description = ' + JSON.stringify(description),
    'model = ' + JSON.stringify(model),
    'developer_instructions = """',
    instructions + '"""',
    '',
    '[features]',
    ...(grant.tools.includes('exec_command') ? [] : ['shell_tool = false']),
    'apps = false',
    'plugins = false',
    'memories = false',
    'request_permissions_tool = false',
    '',
  ].join('\n');
}

export function readCodexGrant(content: string): ToolsGrant {
  const role = parse(content);
  if (
    typeof role.name !== 'string' ||
    typeof role.developer_instructions !== 'string'
  ) {
    throw new Error('Invalid Codex role file');
  }
  const line = content.split('\n').find((s) => s.startsWith(GRANT_PREFIX));
  const tools: unknown = line && JSON.parse(line.slice(GRANT_PREFIX.length));
  if (!Array.isArray(tools) || tools.some((tool) => typeof tool !== 'string')) {
    throw new Error('Invalid generated Codex grant');
  }
  return { tools };
}
