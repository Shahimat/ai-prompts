import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { parseFrontmatter } from '../frontmatter.ts';
import { isRecord } from '../guards.ts';
import { readRepo, repoRoot } from './repo.ts';

/** Экземпляр для проверки: имя (для сообщения) и данные. */
export interface Instance {
  name: string;
  data: unknown;
}

let ajv: Promise<Ajv2020> | null = null;

/**
 * Все `*.schema.json` из каталога схемы — в одном Ajv: схемы ссылаются
 * друг на друга по имени файла (`$ref: provides.schema.json`).
 */
async function validator(schemaPath: string): Promise<ReturnType<Ajv2020['compile']>> {
  ajv ??= (async () => {
    const dir = path.posix.dirname(schemaPath);
    const instance = new Ajv2020({ allErrors: true, strict: false });
    for (const name of (await readdir(path.join(repoRoot(), dir)))
      .filter((n) => n.endsWith('.schema.json'))
      .sort()) {
      const schema: unknown = JSON.parse(await readRepo(`${dir}/${name}`));
      if (!isRecord(schema)) throw new Error(`${dir}/${name}: схема должна быть объектом`);
      instance.addSchema(schema, name);
    }
    return instance;
  })();
  const v = (await ajv).getSchema(path.posix.basename(schemaPath));
  if (v === undefined) throw new Error(`схема ${schemaPath} не найдена`);
  return v;
}

function describeError(e: ErrorObject): string {
  const extra: unknown = e.params['additionalProperty'];
  return `${e.instancePath === '' ? '(корень)' : e.instancePath} ${e.message ?? ''}${
    e.keyword === 'additionalProperties' ? `: ${String(extra)}` : ''
  }`.trim();
}

/** Ошибки валидации по JSON Schema; пустой массив — всё соответствует. */
export async function schemaErrors(instances: Instance[], schemaPath: string): Promise<string[]> {
  const validate = await validator(schemaPath);
  return instances.flatMap((i) =>
    validate(i.data) === true
      ? []
      : (validate.errors ?? []).map((e) => `${i.name}: ${describeError(e)}`),
  );
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
