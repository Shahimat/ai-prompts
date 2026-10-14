import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { parseFrontmatter } from '../../shared/frontmatter.ts';
import { isRecord } from '../../shared/guards.ts';
import { issueText, schemaSet, type SchemaIssue, type Validate } from '../../shared/schema.ts';
import { readRepo, repoRoot } from './repo.ts';

/** Экземпляр для проверки: имя (для сообщения) и данные. */
export interface Instance {
  name: string;
  data: unknown;
}

let schemas: Promise<(name: string) => Validate | undefined> | null = null;

/**
 * Все `*.schema.json` из каталога схемы — в одном наборе: схемы ссылаются
 * друг на друга по имени файла (`$ref: provides.schema.json`).
 */
async function validator(schemaPath: string): Promise<Validate> {
  schemas ??= (async () => {
    const dir = path.posix.dirname(schemaPath);
    const all: Record<string, object> = {};
    for (const name of (await readdir(path.join(repoRoot(), dir)))
      .filter((n) => n.endsWith('.schema.json'))
      .sort()) {
      const schema: unknown = JSON.parse(await readRepo(`${dir}/${name}`));
      if (!isRecord(schema)) throw new Error(`${dir}/${name}: схема должна быть объектом`);
      all[name] = schema;
    }
    return schemaSet(all);
  })();
  const v = (await schemas)(path.posix.basename(schemaPath));
  if (v === undefined) throw new Error(`схема ${schemaPath} не найдена`);
  return v;
}

const describe = (i: SchemaIssue): string =>
  `${i.path === '' ? '(корень)' : i.path} ${issueText(i)}`.trim();

/** Ошибки валидации по JSON Schema; пустой массив — всё соответствует. */
export async function schemaErrors(instances: Instance[], schemaPath: string): Promise<string[]> {
  const validate = await validator(schemaPath);
  return instances.flatMap((i) => validate(i.data).map((e) => `${i.name}: ${describe(e)}`));
}

/** Утверждение для ожиданий: все экземпляры соответствуют схеме. */
export async function expectSchema(instances: Instance[], schemaPath: string): Promise<void> {
  if (instances.length === 0) throw new Error(`нет экземпляров для схемы ${schemaPath}`);
  const errors = await schemaErrors(instances, schemaPath);
  if (errors.length > 0) throw new Error(`не по схеме ${schemaPath}:\n${errors.join('\n')}`);
}

/** YAML- или JSON-файлы репозитория как экземпляры. */
export async function dataFiles(paths: string[]): Promise<Instance[]> {
  return Promise.all(
    paths.map(async (p): Promise<Instance> => {
      const data: unknown = parse(await readRepo(p));
      return { name: p, data };
    }),
  );
}

/** Frontmatter markdown-файлов как экземпляры. */
export async function frontmatters(paths: string[]): Promise<Instance[]> {
  return Promise.all(
    paths.map(async (p) => ({ name: p, data: parseFrontmatter(await readRepo(p)) ?? {} })),
  );
}
