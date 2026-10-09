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

export const TOKEN_STEPS: ReadonlySet<string> = new Set();

export function checkWorkflow(_file: string, _workflow: unknown, _allowed: ReadonlySet<string>): Violation[] {
  return [];
}
