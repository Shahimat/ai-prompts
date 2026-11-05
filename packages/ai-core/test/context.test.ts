import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectContext } from '#commands/context/context';

let root: string;

async function put(rel: string, content: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), content, 'utf8');
}

async function messages(): Promise<string[]> {
  return (await collectContext(root)).map((d) => `${d.file}: ${d.message}`);
}

async function seed(): Promise<void> {
  await put(
    '.oc3/project.yml',
    'name: demo\nnamespaces:\n  vpn: удалённый доступ\n  infra: инфраструктура\n',
  );
  await put(
    '.oc3/data/entities/vpn-server.yml',
    'id: vpn-server\nkind: entity\nnamespace: vpn\nsummary: "сервер: AWG на 51820"\nmanuals: [first-run]\n',
  );
  await put(
    '.oc3/data/entities/ansible-layout.yml',
    'id: ansible-layout\nnamespace: infra\nsummary: раскладка\nmanuals: [.oc3/manuals/first-run.md]\n',
  );
  await put(
    '.oc3/data/behavior/handshake-ok.yml',
    'id: handshake-ok\nnamespace: vpn\ntitle: handshake работает\n',
  );
  await put(
    '.oc3/conventions/naming.yml',
    'key: naming\nsummary: kebab-case\nrule: |\n  длинный текст\n',
  );
  await put(
    '.oc3/conventions/code/strict-ts.yml',
    'key: strict-ts\nsummary: strict везде\nrule: x\n',
  );
  await put('.oc3/manuals/first-run.md', '# Первый запуск\n\n## Шаги\n');
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'harness-ctx-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('collectContext', () => {
  it('слои без нарушений — диагностик нет', async () => {
    await seed();
    expect(await messages()).toEqual([]);
  });

  it('пустой проект — нарушение про project.yml', async () => {
    expect(await messages()).toEqual([
      '.oc3/project.yml: файл не найден: namespace не проверяются',
    ]);
  });

  it('нарушения: id, namespace, summary, title, H1, manual без ссылок', async () => {
    await seed();
    await put('.oc3/data/entities/wrong-name.yml', 'id: other\nnamespace: vpn\nsummary: x\n');
    await put('.oc3/data/entities/no-ns.yml', 'id: no-ns\nsummary: x\n');
    await put('.oc3/data/entities/alien.yml', 'id: alien\nnamespace: misc\nsummary: x\n');
    await put('.oc3/data/entities/no-summary.yml', 'id: no-summary\nnamespace: vpn\n');
    await put(
      '.oc3/data/entities/multi.yml',
      'id: multi\nnamespace: vpn\nsummary: |\n  строка 1\n  строка 2\n',
    );
    await put('.oc3/data/behavior/no-title.yml', 'id: no-title\nnamespace: vpn\n');
    await put('.oc3/manuals/orphan.md', '# Сирота\n');
    await put('.oc3/manuals/no-h1.md', 'текст\n');
    await put(
      '.oc3/data/entities/refs-no-h1.yml',
      'id: refs-no-h1\nnamespace: vpn\nsummary: x\nmanuals: [no-h1]\n',
    );
    await put('.oc3/conventions/dup.yml', 'key: naming\nsummary: x\n');
    await put('.oc3/data/entities/broken.yml', 'id: [\n');

    expect(await messages()).toEqual([
      '.oc3/data/entities/alien.yml: namespace «misc» не объявлен в .oc3/project.yml → namespaces',
      expect.stringMatching(/^\.oc3\/data\/entities\/broken\.yml: невалидный YAML: /),
      '.oc3/data/entities/multi.yml: summary должно быть одной строкой',
      '.oc3/data/entities/no-ns.yml: нет поля namespace',
      '.oc3/data/entities/no-summary.yml: нет поля summary (одна строка для индекса)',
      '.oc3/data/entities/wrong-name.yml: id «other» не совпадает с именем файла «wrong-name»',
      '.oc3/data/behavior/no-title.yml: нет поля title (одна строка для индекса)',
      '.oc3/conventions/naming.yml: key «naming» уже занят другой convention',
      '.oc3/manuals/no-h1.md: нет заголовка «# …» (одна строка для индекса)',
      '.oc3/manuals/orphan.md: manual не упомянут ни в одной entity (поле manuals) — namespace не определить',
    ]);
  });

  it('конвенции-области: плоский список правил в одном файле', async () => {
    await seed();
    await rm(path.join(root, '.oc3/conventions'), { recursive: true, force: true });
    await put(
      '.oc3/conventions/common.yml',
      '- key: naming\n  summary: kebab-case\n  rule: имена в kebab-case\n- key: eol\n  summary: lf везде\n  rule: переводы строк — lf\n',
    );
    expect(await messages()).toEqual([]);
  });
});

describe('слои модулей (provides.index_layers)', () => {
  const MANIFEST =
    'key: knowledge-external-gui\nprovides:\n  index_layers:\n    - section: knowledge\n      dir: .oc3/knowledge/\n';
  const card = (id: string, ns = 'vpn', title = '# Provider: вебхуки'): string =>
    `---\n# комментарий YAML не заголовок\nid: ${id}\nkind: knowledge\nnamespace: ${ns}\n---\n\n${title}\n\n## Карта\n`;

  it('слой модуля по namespace без нарушений', async () => {
    await seed();
    await put('.oc3/modules/knowledge-external-gui.yml', MANIFEST);
    await put('.oc3/knowledge/provider/webhooks.md', card('provider-webhooks'));
    await put('.oc3/knowledge/other/login.md', card('other-login', 'infra', '# Other: вход'));
    expect(await messages()).toEqual([]);
  });

  it('модуль без index_layers — проверки слоёв не добавляются', async () => {
    await seed();
    await put(
      '.oc3/modules/code-rules.yml',
      'key: code-rules\nprovides:\n  layers: [.oc3/conventions/code/]\n',
    );
    expect(await messages()).toEqual([]);
  });

  it('нарушения в манифесте и файлах слоя', async () => {
    await seed();
    await put('.oc3/modules/a.yml', MANIFEST);
    await put(
      '.oc3/modules/b.yml',
      'provides:\n  index_layers:\n    - section: knowledge\n      dir: .oc3/k2\n    - section: entities\n      dir: x\n    - section: ok\n      dir: ../outside\n',
    );
    await put('.oc3/modules/c.yml', 'provides:\n  index_layers: knowledge\n');
    await put('.oc3/knowledge/p/wrong.md', card('other-id'));
    await put('.oc3/knowledge/p/no-fm.md', '# Без frontmatter\n');
    await put('.oc3/knowledge/p/no-h1.md', '---\nid: p-no-h1\nnamespace: vpn\n---\nтекст\n');
    await put('.oc3/knowledge/p/alien.md', card('p-alien', 'misc'));
    await put('.oc3/knowledge/p/no-id.md', '---\nnamespace: vpn\n---\n# x\n');
    expect(await messages()).toEqual([
      '.oc3/modules/b.yml: index_layers: section «knowledge» уже объявлена в .oc3/modules/a.yml',
      '.oc3/modules/b.yml: index_layers: section «entities» — нужен kebab-case, не description/entities/behaviors/manuals',
      '.oc3/modules/b.yml: index_layers: dir «../outside» — нужен путь внутри проекта',
      '.oc3/modules/c.yml: provides.index_layers должно быть списком',
      '.oc3/knowledge/p/alien.md: namespace «misc» не объявлен в .oc3/project.yml → namespaces',
      '.oc3/knowledge/p/no-fm.md: нет frontmatter (id, namespace)',
      '.oc3/knowledge/p/no-h1.md: нет заголовка «# …» (одна строка для индекса)',
      '.oc3/knowledge/p/no-id.md: нет поля id',
      '.oc3/knowledge/p/wrong.md: id «other-id» не совпадает с путём «p-wrong»',
    ]);
  });
});

describe('слои модулей в формате yml', () => {
  const MANIFEST =
    'provides:\n  index_layers:\n    - section: facts\n      dir: life/facts\n      format: yml\n';

  it('индексирует yml по summary', async () => {
    await seed();
    await put('.oc3/modules/life.yml', MANIFEST);
    await put(
      'life/facts/sleep/baseline.yml',
      'id: sleep-baseline\nnamespace: vpn\nsummary: сон — базовая линия\n',
    );
    expect(await messages()).toEqual([]);
  });

  it('нарушения: нет summary, id не по пути, неизвестный format', async () => {
    await seed();
    await put('.oc3/modules/life.yml', MANIFEST);
    await put(
      '.oc3/modules/bad.yml',
      'provides:\n  index_layers:\n    - section: x\n      dir: x\n      format: json\n',
    );
    await put('life/facts/a.yml', 'id: b\nnamespace: vpn\n');
    expect(await messages()).toEqual([
      '.oc3/modules/bad.yml: index_layers: format «json» — md или yml',
      'life/facts/a.yml: нет поля summary (одна строка для индекса)',
      'life/facts/a.yml: id «b» не совпадает с путём «a»',
    ]);
  });
});
