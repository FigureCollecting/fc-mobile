// Token-scope guard for .github/workflows (run by deploy/__tests__/workflowTokenGuard.test.ts).
// NODE_AUTH_TOKEN reads @figurecollecting packages from GitHub Packages. It may only be in the
// env of an allow-listed step, and that step runs exactly what its entry says: npm ci
// --ignore-scripts line by line, one pinned script, or one action pinned by full SHA. The one
// entry that runs repo code is the coordinator checkout (npm --prefix e2e/stack run checkout).
// Nothing else may change how a token step runs: its keys are allow-listed (no shell or
// working-directory), its env holds the token and nothing else, its job has no container,
// services or defaults, the job and workflow env hold only the image names in SCOPE_ENV, and
// before the job's last token step only other token steps and the setup actions in SETUP_ACTION
// run. No step of that job writes $GITHUB_ENV or $GITHUB_PATH, and the token step writes no
// runner file. The token is never workflow- or job-wide, never in with: or a value in run: text,
// never under a second env name. A secrets ref must name one secret (secrets.NAME or
// secrets['NAME']), and a token step's env refs one variable; anything else (toJSON(secrets),
// secrets.*, a computed index) and secrets: inherit hand over every secret. Names match
// case-insensitively (secret names are). aquasecurity actions are pinned by full SHA
// (GHSA-69fq-xp46-6x23).

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
  | 'secrets-inherit'
  | 'trivy-unpinned'
  | 'step-key'
  | 'step-env'
  | 'step-order'
  | 'job-key'
  | 'workflow-key'
  | 'scope-env'
  | 'all-env';

export interface Violation {
  file: string;
  where: string;
  rule: Rule;
}

/** What an allow-listed step may do with the token in its env. */
export type TokenStep =
  | { kind: 'install' }
  | { kind: 'script'; lines: readonly string[] }
  | { kind: 'action'; action: string };

export const stepId = (file: string, job: string, step: string): string => `${file} > ${job} > ${step}`;

const INSTALL: TokenStep = { kind: 'install' };

/** The steps that may carry NODE_AUTH_TOKEN in their env: npm installs, the coordinator checkout and image builds. */
export const TOKEN_STEPS: ReadonlyMap<string, TokenStep> = new Map<string, TokenStep>([
  [stepId('build.yml', 'build', 'Install dependencies'), INSTALL],
  [stepId('security-scan.yml', 'npm-audit', 'Install dependencies'), INSTALL],
  [stepId('stack.yml', 'stack', 'Install app dependencies'), INSTALL],
  [stepId('stack.yml', 'stack', 'Install harness dependencies'), INSTALL],
  // The harness clones the pinned fc-coordinator and runs its npm ci (--ignore-scripts).
  [stepId('stack.yml', 'stack', 'Fetch and install the pinned coordinator'), INSTALL],
  [stepId('web-image.yml', 'image', 'Install app dependencies'), INSTALL],
  [stepId('web-image.yml', 'image', 'Install harness dependencies and the pinned coordinator'), INSTALL],
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
  [stepId('web-image.yml', 'publish', 'Build and push'), { kind: 'action', action: 'docker/build-push-action' }],
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
const INSTALL_LINE = /^npm (--prefix [\w./-]+ )?ci --ignore-scripts$/;
const CHECKOUT_LINE = 'npm --prefix e2e/stack run checkout';
const SHA_PIN = /@[0-9a-f]{40}$/;

type Rec = Record<string, unknown>;
const record = (v: unknown): Rec => (v !== null && typeof v === 'object' ? (v as Rec) : {});
/** Every key and string under v, so a name is found whether it is a key or in a value. */
const text = (v: unknown): string =>
  typeof v === 'string' ? v : Object.entries(record(v)).map(([k, x]) => `${k}\n${text(x)}`).join('\n');
/** Every string under v, keys left out: a secrets: key or input is not a secrets ref. */
const values = (v: unknown): string => (typeof v === 'string' ? v : Object.values(record(v)).map(values).join('\n'));
const mentions = (v: unknown): boolean => NAMED.test(text(v));
const lines = (run: unknown): string[] =>
  typeof run === 'string' ? run.split('\n').map((l) => l.trim()).filter((l) => l !== '') : [];

function runFits(run: unknown, shape: Exclude<TokenStep, { kind: 'action' }>): boolean {
  const got = lines(run);
  if (shape.kind === 'script') return got.join('\n') === shape.lines.join('\n');
  return got.length > 0 && got.every((l) => INSTALL_LINE.test(l) || l === CHECKOUT_LINE);
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
  const wf = record(workflow);
  const jobs = Object.entries(record(wf['jobs'])).map(([jobId, jobValue]) => {
    const job = record(jobValue);
    const steps = (Array.isArray(job['steps']) ? job['steps'] : []).map(record);
    const last = steps.findLastIndex((s) => mentions(s['env']));
    return { jobId, job, steps, last };
  });
  const holds = jobs.some((j) => j.last >= 0);
  for (const [key, value] of Object.entries(wf)) {
    if (key === 'jobs') continue;
    scan(key, value, key === 'env' ? 'workflow-env' : 'elsewhere');
    if (holds) around(key, key, value, WORKFLOW_KEYS, 'workflow-key');
  }
  for (const { jobId, job, steps, last } of jobs) {
    for (const [key, value] of Object.entries(job)) {
      if (key === 'steps') continue;
      scan(`${jobId} > ${key}`, value, key === 'env' ? 'job-env' : 'elsewhere');
      if (last >= 0) around(`${jobId} > ${key}`, key, value, JOB_KEYS, 'job-key');
    }
    if (String(job['secrets']).toLowerCase() === 'inherit') flag(`${jobId} > secrets`, 'secrets-inherit');
    steps.forEach((step, i) => {
      const named = typeof step['name'] === 'string';
      const label = named ? String(step['name']) : `#${i}`;
      const where = (key: string) => `${jobId} > ${label} > ${key}`;
      // Only a named step can be allow-listed: an index would pass whatever step moves into it.
      const shape = named ? allowed.get(stepId(file, jobId, label)) : undefined;
      const bearing = mentions(step['env']);
      const uses = step['uses'];
      for (const [key, value] of Object.entries(step)) {
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
      if (bearing && shape) {
        for (const [key, value] of Object.entries(step)) {
          if (!STEP_KEYS.has(key)) flag(where(key), 'step-key');
          if (key !== 'run' && ALL_ENV.test(values(value))) flag(where(key), 'all-env');
        }
        if (Object.entries(record(step['env'])).some(([k, x]) => k !== TOKEN && !mentions(x))) flag(where('env'), 'step-env');
        if (shape.kind === 'action') {
          const pinned = typeof uses === 'string' && uses.startsWith(`${shape.action}@`) && SHA_PIN.test(uses);
          if (!pinned) flag(where('uses'), 'token-action');
        } else {
          if (uses !== undefined) flag(where('uses'), 'token-action');
          if (!runFits(step['run'], shape)) flag(where('run'), 'run-grammar');
        }
      }
      if (typeof uses === 'string' && uses.toLowerCase().startsWith('aquasecurity/') && !SHA_PIN.test(uses)) {
        flag(where('uses'), 'trivy-unpinned');
      }
    });
  }
  return out;
}
