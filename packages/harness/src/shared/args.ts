export interface CommandArgs {
  root: string;
  out?: string;
  file?: string;
  html?: string;
  port?: string;
  rawBase?: string;
  apply?: boolean;
  now: Date;
  params?: Record<string, string>;
  home?: string;
  name?: string;
  request?: string;
}
