// Token-scope guard for .github/workflows (run by deploy/__tests__/workflowTokenGuard.test.ts).
// NODE_AUTH_TOKEN reads @figurecollecting packages from GitHub Packages. It may only be in the env
// of an allow-listed step, and that step runs exactly what its entry says: npm ci --ignore-scripts
// line by line, one pinned script, or one action at its pinned commit. Of the npm entries only the
// two coordinator ones (kind checkout) may run a repo script, npm --prefix e2e/stack run checkout;
// an install entry may not. The image builds run the repo's Dockerfile, which this guard does not
// read: the build action takes only the with: inputs in ACTION_WITH (context . and no file, builder
// or extra context). A token step's keys are allow-listed (no shell or working-directory), its env
// holds the token and nothing else, its job has no container, services or defaults, and the job and
// workflow env hold only the image names in SCOPE_ENV. Before the job's last token step only other
// token steps and the setup actions in SETUP_ACTION are listed, with only the with: inputs in
// SETUP_WITH and no env (setup-node exports NODE_AUTH_TOKEN job-wide when its own env holds it).
// Actions also run outside their place in the list, so in that job every remote action is in
// ACTION_PINS or LATER_PINS at its one commit, each checked with gh api to have no pre: stage (a
// pre: stage runs at job start, before every token step; a local action runs none, a docker://
// image has none), and no step follows a token step that runs an action (its post stage runs after
// every later step of the job, with the step's env and so the token). No run: step of that job
// names $GITHUB_ENV, $GITHUB_PATH, ::set-env or ::add-path (a text check: a run: step can reach
// them another way, and then reaches only what runs after it, which holds no token), and a token
// step's run: names no runner file. The pinned actions write their own: setup-node adds node to
// $GITHUB_PATH and with registry-url sets NPM_CONFIG_USERCONFIG, metadata-action sets
// DOCKER_METADATA_OUTPUT_* in $GITHUB_ENV, and the build action sets its outputs and state and, in
// its post stage, writes the job summary and uploads a build record. The token is never workflow-
// or job-wide, its value never in with: or run: text (secret-envs and --secret name it), never
// under a second env name. Every env is a plain mapping, so the guard can read its names. A secrets
// ref must name one secret (secrets.NAME or secrets['NAME']), and a token step's env refs one
// variable; anything else (toJSON(secrets), secrets.*, a computed index) and secrets: inherit hand
// over every secret; a reusable workflow's secrets: is a mapping of named secrets other than the
// token. Names match case-insensitively (secret names are). A step's remote action is named the way
// GitHub's runner names it: the path before the first @, split on / and \ with empty segments
// dropped, gives owner/repo; the ref after that @ is compared whole. The setup and build actions in
// ACTION_PINS run at their pinned commit in every workflow step that names them; every other remote
// action, aquasecurity's included (GHSA-69fq-xp46-6x23), names a full 40-hex commit, and which repo
// a commit outside the pins is on is left to review (a fork's commit resolves too). Not judged:
// local paths (./, .\), docker:// images, a uses with no @ (a $/ path, or a remote one GitHub
// rejects), job-level uses, and the uses inside an action, which are that action's own (the pinned
// trivy-action's setup-trivy runs actions/checkout v6.0.1, pinned by SHA).

export type Rule =
  | 'workflow-env'
  | 'job-env'
  | 'with'
  | 'github-env'
  | 'run-value'
  | 'non-install-step'
  | 'elsewhere'
  | 'run-grammar'
  | 'token-action'
  | 'env-alias'
  | 'all-secrets'
  | 'job-secrets'
  | 'env-expr'
  | 'setup-with'
  | 'trivy-unpinned'
  | 'action-pin'
  | 'action-sha'
  | 'action-with'
  | 'step-key'
  | 'step-env'
  | 'step-order'
  | 'job-key'
  | 'workflow-key'
  | 'scope-env'
  | 'all-env'
  | 'post-stage'
  | 'pre-stage';

export interface Violation {
  file: string;
  where: string;
  rule: Rule;
}

/** What an allow-listed step may do with the token in its env. */
export type TokenStep =
  | { kind: 'install' }
  | { kind: 'checkout' }
  | { kind: 'script'; lines: readonly string[] }
  | { kind: 'action'; uses: string };

export const stepId = (file: string, job: string, step: string): string => `${file} > ${job} > ${step}`;

const INSTALL: TokenStep = { kind: 'install' };
const CHECKOUT: TokenStep = { kind: 'checkout' };

/**
 * The setup and build actions, each at one commit, checked against its release tag with
 * `gh api repos/OWNER/NAME/commits/TAG`. A tag can move, and a SHA from a fork resolves too.
 */
export const ACTION_PINS: ReadonlyMap<string, string> = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'], // v7.0.1
  ['actions/setup-node', '949feb2413d6458794dcd2491c4babbbce0c15c1'], // v7.1.0
  ['docker/setup-buildx-action', 'f87e5991a6d7451dcb8d9637bfbc97413f497069'], // v4.4.1
  ['docker/metadata-action', 'dc802804100637a589fabce1cb79ff13a1411302'], // v6.2.0
  ['docker/login-action', 'dbcb813823bdd20940b903addbd779551569679f'], // v4.6.0
  ['docker/build-push-action', 'c3c9e263c25d99ce0380d002d59b67737d91b0dc'], // v7.4.0
]);
const pinned = (name: string): string => `${name}@${String(ACTION_PINS.get(name))}`;
/**
 * The other actions a job with a token step may run, each at one commit whose action.yml files,
 * nested uses included, have no pre: stage (checked with gh api, as are ACTION_PINS): a pre: stage
 * runs at job start, before every token step, wherever its step sits.
 */
export const LATER_PINS: ReadonlyMap<string, string> = new Map([
  ['actions/upload-artifact', 'cf430e030ddbb5b0abf93d22962f4752f3646cd9'], // v7.0.2
  ['aquasecurity/trivy-action', 'ed142fd0673e97e23eac54620cfb913e5ce36c25'], // v0.36.0
]);

/** The steps that may carry NODE_AUTH_TOKEN in their env: npm installs, the coordinator checkout and image builds. */
export const TOKEN_STEPS: ReadonlyMap<string, TokenStep> = new Map<string, TokenStep>([
  [stepId('build.yml', 'build', 'Install dependencies'), INSTALL],
  [stepId('security-scan.yml', 'npm-audit', 'Install dependencies'), INSTALL],
  [stepId('stack.yml', 'stack', 'Install app dependencies'), INSTALL],
  [stepId('stack.yml', 'stack', 'Install harness dependencies'), INSTALL],
  // The harness clones the pinned fc-coordinator and runs its npm ci (--ignore-scripts).
  [stepId('stack.yml', 'stack', 'Fetch and install the pinned coordinator'), CHECKOUT],
  [stepId('web-image.yml', 'image', 'Install app dependencies'), INSTALL],
  [stepId('web-image.yml', 'image', 'Install harness dependencies and the pinned coordinator'), CHECKOUT],
  // BuildKit secret for the Dockerfile's npm ci (--ignore-scripts).
  [
    stepId('web-image.yml', 'image', 'Build image N and N+1'),
    {
      kind: 'script',
      lines: [
        'set -euo pipefail',
        'sha="sha-${GITHUB_SHA::7}"',
        'for pair in "${FC_WEB_IMAGE}=${sha}" "${FC_WEB_IMAGE_NEXT}=${sha}-next"; do',
        'DOCKER_BUILDKIT=1 docker build \\',
        '--secret id=node_auth_token,env=NODE_AUTH_TOKEN \\',
        '--build-arg "VITE_BUILD_ID=${pair#*=}" \\',
        '-t "${pair%%=*}" .',
        'done',
      ],
    },
  ],
  [stepId('web-image.yml', 'publish', 'Build and push'), { kind: 'action', uses: pinned('docker/build-push-action') }],
]);

/** The only workflow- or job-wide env a job with a token step may set: image names, read by no tool. */
export const SCOPE_ENV: ReadonlySet<string> = new Set(['FC_WEB_IMAGE', 'FC_WEB_IMAGE_NEXT', 'FC_STACK_WEB_IMAGE']);
/** Keys a token step may use; shell, working-directory and the rest change how it runs. */
const STEP_KEYS = new Set(['name', 'id', 'if', 'run', 'env', 'uses', 'with', 'continue-on-error']);
/** Keys of a job with a token step, steps aside; container, services and defaults change how its steps run. */
const JOB_KEYS = new Set(['name', 'runs-on', 'if', 'needs', 'permissions', 'strategy', 'timeout-minutes', 'outputs', 'env']);
/** Top-level keys of a workflow with a token step, jobs aside; defaults would change how its steps run. */
const WORKFLOW_KEYS = new Set(['name', 'run-name', 'on', 'permissions', 'concurrency', 'env']);

const TOKEN = 'NODE_AUTH_TOKEN';
const NAMED = /node_auth_token/i;
// A dereference of the token's value, as opposed to naming the variable (env=NODE_AUTH_TOKEN).
const VALUE_REF = /(secrets|env)(\.|\[\s*')node_auth_token|\$\{?node_auth_token/i;
// A secrets or env ref that is not one name (secrets.NAME, secrets['NAME']) hands over them all.
const ALL_SECRETS = /\bsecrets\b(?!\.[a-z_]\w*\b(?!\.\*)|\[\s*'[\w-]+'\s*\])/i;
const ALL_ENV = /\benv\b(?!\.[a-z_]\w*\b(?!\.\*)|\[\s*'[\w-]+'\s*\])/i;
const EXPORT = /GITHUB_(ENV|OUTPUT|STATE|PATH)|::(set-output|save-state|set-env|add-path)/;
// Runner files that change the env or PATH of every later step.
const RUNNER_ENV = /GITHUB_(ENV|PATH)|::(set-env|add-path)/;
// The actions that may run before a token step: they check out and set up, nothing else.
const SETUP_ACTION = /^(actions\/(checkout|setup-node)|docker\/(setup-buildx|metadata|login)-action)@/i;
const literal = (v: string): boolean => !v.includes('${{');
/** The with: inputs each setup action may take before a token step, and the values each accepts. */
const SETUP_WITH: Readonly<Record<string, Readonly<Record<string, (v: string) => boolean>>>> = {
  'actions/checkout': {},
  'actions/setup-node': {
    'node-version': (v) => literal(v) || v === '${{ matrix.node-version }}',
    cache: literal,
    'cache-dependency-path': literal,
    'registry-url': (v) => v === 'https://npm.pkg.github.com',
  },
  'docker/setup-buildx-action': {},
  'docker/metadata-action': { images: literal, tags: literal },
  'docker/login-action': {
    registry: (v) => v === 'ghcr.io',
    username: (v) => v === '${{ github.actor }}',
    password: (v) => v === '${{ secrets.GITHUB_TOKEN }}',
  },
};
/** The with: inputs an allow-listed action may take with the token in its env; it builds the repo here. */
const ACTION_WITH: Readonly<Record<string, Readonly<Record<string, (v: string) => boolean>>>> = {
  'docker/build-push-action': {
    context: (v) => v === '.',
    push: literal,
    tags: () => true,
    labels: () => true,
    'build-args': (v) => v.trim() === 'VITE_BUILD_ID=${{ steps.meta.outputs.version }}',
    'secret-envs': (v) => v.trim() === 'node_auth_token=NODE_AUTH_TOKEN',
  },
};
const INSTALL_LINE = /^npm (--prefix [\w./-]+ )?ci --ignore-scripts$/;
const CHECKOUT_LINE = 'npm --prefix e2e/stack run checkout';
const FULL_SHA = /^[0-9a-f]{40}$/;
// GitHub runs these from this repo or as an image, never as a remote action; it matches them case-sensitively.
const LOCAL = /^(\.\/|\.\\|docker:\/\/)/;

type Rec = Record<string, unknown>;
const record = (v: unknown): Rec => (v !== null && typeof v === 'object' ? (v as Rec) : {});
/** A mapping or nothing: not one ${{ }} string, not a list. */
const plain = (v: unknown): boolean => typeof v === 'object' && !Array.isArray(v);
/** Every key and string under v, so a name is found whether it is a key or in a value. */
const text = (v: unknown): string =>
  typeof v === 'string' ? v : Object.entries(record(v)).map(([k, x]) => `${k}\n${text(x)}`).join('\n');
/** Every string under v, keys left out: a secrets: key or input is not a secrets ref. */
const values = (v: unknown): string => (typeof v === 'string' ? v : Object.values(record(v)).map(values).join('\n'));
const mentions = (v: unknown): boolean => NAMED.test(text(v));
/** with: is a mapping (or absent) whose every input is in inputs and takes a value it accepts. */
const inputsFit = (w: unknown, inputs: Readonly<Record<string, (v: string) => boolean>>): boolean =>
  plain(w) && Object.entries(record(w)).every(([k, x]) => Object.hasOwn(inputs, k) && inputs[k](text(x)));
/**
 * A remote action as GitHub's runner reads uses (actions/runner PipelineTemplateConverter): the path
 * before the first @ split on / and \ with empty segments dropped, owner/repo its first two segments
 * (lower-cased: names match case-insensitively), the ref everything after that @.
 */
function remoteAction(uses: unknown): { name: string; ref: string } | undefined {
  if (typeof uses !== 'string' || LOCAL.test(uses)) return undefined;
  const at = uses.indexOf('@');
  if (at < 0) return undefined;
  const segments = uses.slice(0, at).toLowerCase().split(/[/\\]/).filter((x) => x !== '');
  return { name: segments.slice(0, 2).join('/'), ref: uses.slice(at + 1) };
}
const lines = (run: unknown): string[] =>
  typeof run === 'string' ? run.split('\n').map((l) => l.trim()).filter((l) => l !== '') : [];

function runFits(run: unknown, shape: Exclude<TokenStep, { kind: 'action' }>): boolean {
  const got = lines(run);
  if (shape.kind === 'script') return got.join('\n') === shape.lines.join('\n');
  return got.length > 0 && got.every((l) => INSTALL_LINE.test(l) || (shape.kind === 'checkout' && l === CHECKOUT_LINE));
}

export function checkWorkflow(file: string, workflow: unknown, allowed: ReadonlyMap<string, TokenStep>): Violation[] {
  const out: Violation[] = [];
  const flag = (where: string, rule: Rule) => out.push({ file, where, rule });
  const scan = (where: string, value: unknown, rule: Rule) => {
    if (ALL_SECRETS.test(values(value))) flag(where, 'all-secrets');
    if (mentions(value)) flag(where, rule);
  };
  /** A workflow or job key around a token step: allow-listed, and an env of image names only. */
  const around = (where: string, key: string, value: unknown, keys: ReadonlySet<string>, rule: Rule) => {
    if (!keys.has(key)) flag(where, rule);
    else if (key === 'env' && Object.keys(record(value)).some((k) => !SCOPE_ENV.has(k))) flag(where, 'scope-env');
  };
  /** An env the guard cannot read (one ${{ }} string, a list) may set any name, the token's too. */
  const envExpr = (where: string, key: string, value: unknown) => {
    if (key === 'env' && !plain(value)) flag(where, 'env-expr');
  };
  const wf = record(workflow);
  const jobs = Object.entries(record(wf['jobs'])).map(([jobId, jobValue]) => {
    const job = record(jobValue);
    const steps = (Array.isArray(job['steps']) ? job['steps'] : []).map(record);
    const last = steps.findLastIndex((s) => mentions(s['env']));
    // An action's post stage runs after every later step of its job, with its env (the token) set.
    const post = steps.findIndex((s) => mentions(s['env']) && s['uses'] !== undefined);
    return { jobId, job, steps, last, post };
  });
  const holds = jobs.some((j) => j.last >= 0);
  for (const [key, value] of Object.entries(wf)) {
    if (key === 'jobs') continue;
    envExpr(key, key, value);
    scan(key, value, key === 'env' ? 'workflow-env' : 'elsewhere');
    if (holds) around(key, key, value, WORKFLOW_KEYS, 'workflow-key');
  }
  for (const { jobId, job, steps, last, post } of jobs) {
    for (const [key, value] of Object.entries(job)) {
      if (key === 'steps') continue;
      envExpr(`${jobId} > ${key}`, key, value);
      // A reusable workflow's secrets: one named, unrelated secret per entry, nothing passed whole.
      if (key === 'secrets') {
        if (!plain(value) || ALL_SECRETS.test(values(value)) || mentions(value)) flag(`${jobId} > secrets`, 'job-secrets');
      } else scan(`${jobId} > ${key}`, value, key === 'env' ? 'job-env' : 'elsewhere');
      if (last >= 0) around(`${jobId} > ${key}`, key, value, JOB_KEYS, 'job-key');
    }
    steps.forEach((step, i) => {
      const named = typeof step['name'] === 'string';
      const label = named ? String(step['name']) : `#${i}`;
      const where = (key: string) => `${jobId} > ${label} > ${key}`;
      // Only a named step can be allow-listed: an index would pass whatever step moves into it.
      const shape = named ? allowed.get(stepId(file, jobId, label)) : undefined;
      const bearing = mentions(step['env']);
      const uses = step['uses'];
      for (const [key, value] of Object.entries(step)) {
        envExpr(where(key), key, value);
        const t = text(value);
        if (ALL_SECRETS.test(values(value))) flag(where(key), 'all-secrets');
        if (key === 'run') {
          if ((EXPORT.test(t) && (bearing || NAMED.test(t))) || (last >= 0 && RUNNER_ENV.test(t))) flag(where(key), 'github-env');
          else if (VALUE_REF.test(t)) flag(where(key), 'run-value');
          else if (NAMED.test(t) && !shape) flag(where(key), 'non-install-step');
        } else if (!NAMED.test(t)) {
          continue;
        } else if (key === 'env') {
          if (!shape) flag(where(key), 'non-install-step');
          if (Object.entries(record(value)).some(([k, x]) => k !== TOKEN && mentions(x))) flag(where(key), 'env-alias');
        } else if (key === 'with') {
          if (!shape || VALUE_REF.test(t)) flag(where(key), 'with');
        } else {
          flag(where(key), 'elsewhere');
        }
      }
      if (i < last && !bearing && !SETUP_ACTION.test(String(uses))) flag(where('step'), 'step-order');
      if (post >= 0 && i > post) flag(where('step'), 'post-stage');
      // A setup action's inputs and env decide which node, npm registry or BuildKit the token reaches.
      const setup = i < last ? SETUP_ACTION.exec(String(uses)) : null;
      if (setup) {
        if (!inputsFit(step['with'] ?? {}, SETUP_WITH[setup[1].toLowerCase()])) flag(where('with'), 'setup-with');
        if (text(step['env']) !== '') flag(where('env'), 'setup-with');
      }
      if (bearing && shape) {
        for (const [key, value] of Object.entries(step)) {
          if (!STEP_KEYS.has(key)) flag(where(key), 'step-key');
          if (key !== 'run' && ALL_ENV.test(values(value))) flag(where(key), 'all-env');
        }
        if (Object.entries(record(step['env'])).some(([k, x]) => k !== TOKEN && !mentions(x))) flag(where('env'), 'step-env');
        if (shape.kind === 'action') {
          if (uses !== shape.uses) flag(where('uses'), 'token-action');
          else if (!inputsFit(step['with'] ?? {}, ACTION_WITH[shape.uses.split('@')[0]] ?? {})) flag(where('with'), 'action-with');
        } else {
          if (uses !== undefined) flag(where('uses'), 'token-action');
          if (!runFits(step['run'], shape)) flag(where('run'), 'run-grammar');
        }
      }
      // In any job: a setup or build action at any ref but its pinned commit, any other remote
      // action at anything but a full commit SHA; in a token job, at anything but LATER_PINS.
      const action = remoteAction(uses);
      if (action !== undefined) {
        const pin = ACTION_PINS.get(action.name);
        if (pin !== undefined) {
          if (action.ref !== pin) flag(where('uses'), 'action-pin');
        } else if (!FULL_SHA.test(action.ref)) {
          flag(where('uses'), action.name.split('/')[0] === 'aquasecurity' ? 'trivy-unpinned' : 'action-sha');
        } else if (last >= 0 && LATER_PINS.get(action.name) !== action.ref) {
          flag(where('uses'), 'pre-stage');
        }
      }
    });
  }
  return out;
}
