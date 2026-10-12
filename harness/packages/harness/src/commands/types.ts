export interface CommandArgs {
  /** Абсолютный путь к корню проекта. */
  root: string;
  out?: string;
  rawBase?: string;
  /** Текущий момент; подменяется в тестах. */
  now: Date;
}
