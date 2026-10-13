export interface CommandArgs {
  /** Абсолютный путь к корню проекта. */
  root: string;
  out?: string;
  rawBase?: string;
  /** `expect judge --apply`: применить ответы судьи. */
  apply?: boolean;
  /** Текущий момент; подменяется в тестах. */
  now: Date;
}
