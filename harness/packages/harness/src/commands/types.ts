export interface CommandArgs {
  /** Абсолютный путь к корню проекта. */
  root: string;
  out?: string;
  /** `secrets scan --file`: файл по пути, в том числе вне проекта. */
  file?: string;
  rawBase?: string;
  /** `expect judge --apply`: применить ответы судьи. */
  apply?: boolean;
  /** Текущий момент; подменяется в тестах. */
  now: Date;
  /** Значения параметров пути команды: `<session>`, `<harness>`. */
  params?: Record<string, string>;
  /** Каталог harness в user scope; по умолчанию `~/.config/harness`. */
  home?: string;
  /** `plan <harness> start`: название плана и запрос без вопросов в терминале. */
  name?: string;
  request?: string;
  /** `session <session> check --hook`: режим Stop-hook. */
  hook?: boolean;
}
