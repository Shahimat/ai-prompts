export interface AgentsPiece {
  marker: string;
  body: string;
}

const ROUTE = `## Где искать ответ

Любой запрос — сначала документация: \`context/index.yml\` → conventions, design, docs — точный ответ или указатель, где искать.

- как сейчас устроено X → источник реальности (\`context/project.yml\` → \`reality\`); почему X → \`CHANGELOG.md\`, затем \`git log\`;
- как договорились → \`context/conventions/<key>.yml\`; реквизиты, sync, roles.exceptions, roles.models → \`context/project.yml\`;
- цели, программы, тикеты → \`goals/\`; роли → \`agents/\`, skills → \`context/skills.yml\`, автономия → \`context/autonomy.yml\`; возможности → \`context/modules/*.yml\`.

Полный обход \`docs/\`, \`context/\` и \`goals/\` запрещён: иди по маршруту.
`;

const RULES = `## Жёсткие правила

1. Перед правкой — прочитай документы по маршруту задачи.
2. Memory агента запрещена: «запомни» — это \`docs_request\` librarian, а не память инструмента.
3. Внимание пользователя — самый дорогой ресурс: вопрос — только когда без решения нельзя продолжить или откатить.
4. Документацию пишет только librarian по \`docs_request\`: оператор, executor и judge её читают; генерируемое меняет \`ai\`.
5. Ничего не создавать, не переносить, не удалять без явного «да».
6. Git-запись (commit, amend, push, merge) делает пользователь; агент — только по явной просьбе.
7. Тяжёлая работа — ролям; действие наружу — по \`context/autonomy.yml\`; ролевые skills оператор не загружает.
`;

const SCENARIOS = `## Сценарии

\`plan\` — «предложи»; \`execute\` — «делай»; \`audit\` — «проверь»; \`challenge\` — «покритикуй»; \`report\` — «статус». Протоколы — skill \`workflow\`.
`;

const OPERATOR_SECTION = `## Оператор

- одна primary-сессия; роли запускает только с \`background: true\`; не блокируется и остаётся доступен человеку;
- цель — \`goals/<goal>.expect.ts\`, программа — \`goals/program--<key>.expect.ts\`, тикет — \`describe('ticket: …')\`; один активный тикет на цель;
- ролям — \`brief\` до 15 строк, от них — \`report\`; judge — \`verdict\`, librarian — \`docs_request\`; researcher от оператора — сколько угодно, от executor — ≤2 на тикет;
- worktree и merge — оператор; проверки — в скоупе цели или программы.
`;

const SKILLS_SECTION = `## Skills

- ролевые skills — в \`.agents/skills/\`, привязка — \`context/skills.yml\`; оператор — только \`operator-feedback\`; браузер — \`browser\` у executor, \`browser-read\` у judge и researcher.
`;

const WORKTREES_MODULE = `<!-- module:worktrees -->
## worktrees

- одна задача — одна ветка — один worktree; правила и горячие файлы →
  skill \`worktrees\`.
<!-- /module:worktrees -->
`;

export const AGENTS_PIECES: readonly AgentsPiece[] = [
  { marker: '## Где искать ответ', body: ROUTE },
  { marker: '## Жёсткие правила', body: RULES },
  { marker: '## Сценарии', body: SCENARIOS },
  { marker: '## Оператор', body: OPERATOR_SECTION },
  { marker: '## Skills', body: SKILLS_SECTION },
  { marker: '<!-- module:worktrees -->', body: WORKTREES_MODULE },
];

export const AGENTS_MD = AGENTS_PIECES.map((piece) => piece.body).join('\n');

export const PROJECT_YML = `name: 'ЗАПОЛНИ: имя проекта'
summary: 'ЗАПОЛНИ: одно предложение — что это за проект'
stack: []
reality: []
namespaces: {}
roles:
  exceptions: []
  models: {}
runtime: full
briefing:
  mode: cheap
sync:
  index_source: https://raw.githubusercontent.com/Shahimat/ai-prompts/main/prompts/index.yml
  contract:
    key: agent-operational-contract-v3
    edition: operator-centric
    parts: {}
`;

export const AUTONOMY_YML = `defaults:
  external: deny
  publish: deny
notes:
  - действие наружу (публикация, внешние системы) — только по явному «да» человека
`;

export const SKILLS_YML = `roles: {}
`;

export const GITIGNORE_LINES = [
  'node_modules/',
  'dist/',
  'coverage/',
  '.opencode/artifacts/',
  '.opencode/worktrees/',
  '.ops/operator/',
  '.ops/locks/',
  '.ops/submit/',
  '.ops/sessions/',
];

export const GITATTR_LINES = ['* text=auto eol=lf', 'CHANGELOG.md merge=union'];

export const DEFAULT_INDEX_SOURCE =
  'https://raw.githubusercontent.com/Shahimat/ai-prompts/main/prompts/index.yml';

export const AI_CORE_FALLBACK_PIN = '0.1.6';
export const OC3_FALLBACK_PIN = '0.1.4';

export const newPackageJson = (name: string, aiCore: string, oc3: string): string =>
  `${JSON.stringify(
    {
      name,
      private: true,
      type: 'module',
      engines: { node: '>=24' },
      devDependencies: {
        '@shahimat/ai-core': aiCore,
        '@shahimat/oc3': oc3,
      },
    },
    null,
    2,
  )}\n`;
