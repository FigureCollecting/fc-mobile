// Token-scope guard for .github/workflows (run by deploy/__tests__/workflowTokenGuard.test.ts).
// NODE_AUTH_TOKEN reads @figurecollecting packages from GitHub Packages. It may only be in the
// env of an allow-listed step, and that step must do exactly what its entry says: npm ci
// --ignore-scripts (or the coordinator checkout) line by line, one pinned script, or one action
// pinned by full SHA. Tests, scans and every other action run without it. It is never workflow-
// or job-wide, never in with: or a value in run: text, never under a second env name, and a
// token step never writes the runner files ($GITHUB_ENV, _OUTPUT, _STATE, _PATH). toJSON(secrets),
// a computed secrets[...] and secrets: inherit are refused, as they hand over every secret. Names
// match case-insensitively (secret names are). aquasecurity actions are pinned by full SHA
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
  | 'trivy-unpinned';

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

/** The steps that may carry NODE_AUTH_TOKEN in their env: npm installs and image builds only. */
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

const TOKEN = 'NODE_AUTH_TOKEN';
const NAMED = /node_auth_token/i;
// A dereference of the token's value, as opposed to naming the variable (env=NODE_AUTH_TOKEN).
const VALUE_REF = /(secrets|env)(\.|\[\s*')node_auth_token|\$\{?node_auth_token/i;
const ALL_SECRETS = /tojson\(\s*secrets\s*\)|secrets\[\s*[^'\s]/i;
const EXPORT = /GITHUB_(ENV|OUTPUT|STATE|PATH)|::(set-output|save-state|set-env|add-path)/;
const INSTALL_LINE = /^npm (--prefix [\w./-]+ )?ci --ignore-scripts$/;
const CHECKOUT_LINE = 'npm --prefix e2e/stack run checkout';
const SHA_PIN = /@[0-9a-f]{40}$/;

type Rec = Record<string, unknown>;
const record = (v: unknown): Rec => (v !== null && typeof v === 'object' ? (v as Rec) : {});
/** Every key and string under v, so a name is found whether it is a key or in a value. */
const text = (v: unknown): string =>
  typeof v === 'string' ? v : Object.entries(record(v)).map(([k, x]) => `${k}\n${text(x)}`).join('\n');
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
    if (ALL_SECRETS.test(text(value))) flag(where, 'all-secrets');
    if (mentions(value)) flag(where, rule);
  };
  const wf = record(workflow);
  for (const [key, value] of Object.entries(wf)) {
    if (key !== 'jobs') scan(key, value, key === 'env' ? 'workflow-env' : 'elsewhere');
  }
  for (const [jobId, jobValue] of Object.entries(record(wf['jobs']))) {
    const job = record(jobValue);
    for (const [key, value] of Object.entries(job)) {
      if (key !== 'steps') scan(`${jobId} > ${key}`, value, key === 'env' ? 'job-env' : 'elsewhere');
    }
    if (String(job['secrets']).toLowerCase() === 'inherit') flag(`${jobId} > secrets`, 'secrets-inherit');
    const steps = Array.isArray(job['steps']) ? job['steps'] : [];
    steps.forEach((stepValue, i) => {
      const step = record(stepValue);
      const named = typeof step['name'] === 'string';
      const label = named ? String(step['name']) : `#${i}`;
      const where = (key: string) => `${jobId} > ${label} > ${key}`;
      // Only a named step can be allow-listed: an index would pass whatever step moves into it.
      const shape = named ? allowed.get(stepId(file, jobId, label)) : undefined;
      const bearing = mentions(step['env']);
      for (const [key, value] of Object.entries(step)) {
        const t = text(value);
        if (ALL_SECRETS.test(t)) flag(where(key), 'all-secrets');
        if (key === 'run') {
          if (EXPORT.test(t) && (bearing || NAMED.test(t))) flag(where(key), 'github-env');
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
      const uses = step['uses'];
      if (bearing && shape) {
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
