// Token-scope guard for .github/workflows (run by deploy/__tests__/workflowTokenGuard.test.ts).
// NODE_AUTH_TOKEN reads @figurecollecting packages from GitHub Packages. It may only be in the
// env of an allow-listed install or image-build step, so tests, scans and third-party actions
// never see it; it is never workflow- or job-wide, never in with: or a value in run: text, and
// never exported through $GITHUB_ENV. A token step's npm ci must not run install scripts, and
// aquasecurity/trivy-action is pinned by full SHA (GHSA-69fq-xp46-6x23).

export type Rule =
  | 'workflow-env'
  | 'job-env'
  | 'with'
  | 'github-env'
  | 'run-value'
  | 'non-install-step'
  | 'elsewhere'
  | 'npm-ci-scripts'
  | 'trivy-unpinned';

export interface Violation {
  file: string;
  where: string;
  rule: Rule;
}

export const stepId = (file: string, job: string, step: string): string => `${file} > ${job} > ${step}`;

/** The steps that may carry NODE_AUTH_TOKEN in their env: npm installs and image builds only. */
export const TOKEN_STEPS: ReadonlySet<string> = new Set([
  stepId('build.yml', 'build', 'Install dependencies'),
  stepId('security-scan.yml', 'npm-audit', 'Install dependencies'),
  stepId('stack.yml', 'stack', 'Install app dependencies'),
  stepId('stack.yml', 'stack', 'Install harness dependencies'),
  // The harness clones the pinned fc-coordinator and runs its npm ci (--ignore-scripts).
  stepId('stack.yml', 'stack', 'Fetch and install the pinned coordinator'),
  stepId('web-image.yml', 'image', 'Install app dependencies'),
  stepId('web-image.yml', 'image', 'Install harness dependencies and the pinned coordinator'),
  // BuildKit secret for the Dockerfile's npm ci (--ignore-scripts).
  stepId('web-image.yml', 'image', 'Build image N and N+1'),
  stepId('web-image.yml', 'publish', 'Build and push'),
]);

const TOKEN = 'NODE_AUTH_TOKEN';
// A dereference of the token's value, as opposed to naming the variable (env=NODE_AUTH_TOKEN).
const VALUE_REF = /secrets\.NODE_AUTH_TOKEN\b|env\.NODE_AUTH_TOKEN\b|\$\{?NODE_AUTH_TOKEN\b/;
const EXPORT = /\bGITHUB_(ENV|OUTPUT)\b/;
const NPM_CI = /(^|\s)npm\s(.*\s)?ci(\s|$)/;
const SHA_PIN = /@[0-9a-f]{40}$/;

type Rec = Record<string, unknown>;
const record = (v: unknown): Rec => (v !== null && typeof v === 'object' ? (v as Rec) : {});
const mentions = (v: unknown): boolean => JSON.stringify(v ?? null).includes(TOKEN);

export function checkWorkflow(file: string, workflow: unknown, allowed: ReadonlySet<string>): Violation[] {
  const out: Violation[] = [];
  const flag = (where: string, rule: Rule) => out.push({ file, where, rule });
  const wf = record(workflow);
  for (const [key, value] of Object.entries(wf)) {
    if (key !== 'jobs' && mentions(value)) flag(key, key === 'env' ? 'workflow-env' : 'elsewhere');
  }
  for (const [jobId, jobValue] of Object.entries(record(wf['jobs']))) {
    const job = record(jobValue);
    for (const [key, value] of Object.entries(job)) {
      if (key !== 'steps' && mentions(value)) flag(`${jobId} > ${key}`, key === 'env' ? 'job-env' : 'elsewhere');
    }
    const steps = Array.isArray(job['steps']) ? job['steps'] : [];
    steps.forEach((stepValue, i) => {
      const step = record(stepValue);
      const label = typeof step['name'] === 'string' ? step['name'] : `#${i}`;
      const where = (key: string) => `${jobId} > ${label} > ${key}`;
      const ok = allowed.has(stepId(file, jobId, label));
      for (const [key, value] of Object.entries(step)) {
        if (!mentions(value)) continue;
        const text = JSON.stringify(value);
        if (key === 'env') {
          if (!ok) flag(where(key), 'non-install-step');
        } else if (key === 'with') {
          if (!ok || VALUE_REF.test(text)) flag(where(key), 'with');
        } else if (key === 'run') {
          if (EXPORT.test(text)) flag(where(key), 'github-env');
          else if (VALUE_REF.test(text)) flag(where(key), 'run-value');
          else if (!ok) flag(where(key), 'non-install-step');
        } else {
          flag(where(key), 'elsewhere');
        }
      }
      if (mentions(step['env']) && typeof step['run'] === 'string') {
        for (const line of step['run'].split('\n')) {
          if (NPM_CI.test(line) && !line.includes('--ignore-scripts')) flag(where('run'), 'npm-ci-scripts');
        }
      }
      const uses = step['uses'];
      if (typeof uses === 'string' && uses.startsWith('aquasecurity/') && !SHA_PIN.test(uses)) flag(where('uses'), 'trivy-unpinned');
    });
  }
  return out;
}
