export interface ProofPolicy {
  owner: string;
  scope: readonly string[];
  force: boolean;
  allowJudge: boolean;
}

export interface ProofRun extends ProofPolicy {
  root: string;
  id: string;
  token: string;
}
