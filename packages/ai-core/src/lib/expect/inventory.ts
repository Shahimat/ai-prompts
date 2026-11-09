import path from 'node:path';
import ts from 'typescript';
import { confinedProjectPath, normalizedProjectPath } from '#lib/artifacts';
import { canonicalJson } from '#lib/proof/inputs';
import { createHash } from 'node:crypto';
import { extractionPrinter } from '#lib/expect/syntax-printer';
import { observedDigest } from '#lib/expect/observation-digest';

export const canonicalDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export const EXTRACTION_POLICY = 'criterion-ts-v2.2';

export interface CriterionInput {
  identity: string;
  lineage: string;
  file: string;
  location: { line: number; column: number; endLine: number; endColumn: number };
  intent: string[];
  body: string;
  registration: string;
  dependencies: { file: string; declaration: string }[];
  complete: boolean;
  titleComplete?: boolean;
  diagnostics: string[];
  multiplicity: number;
  input: string;
  reviewScope: { kind: 'criterion' | 'registration-group' | 'entry'; key: string };
}

export interface CriterionInventory {
  policy: string;
  entry: string;
  criteria: CriterionInput[];
  membership: string;
  generation: string;
  configuration: { file: string; text: string | null }[];
}

function rootName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return rootName(node.expression);
  if (ts.isCallExpression(node)) return rootName(node.expression);
  return '';
}

function moduleName(node: ts.Node): string | undefined {
  for (let n: ts.Node | undefined = node; n !== undefined; n = n.parent)
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier))
      return n.moduleSpecifier.text;
  return undefined;
}

const inventories = new Map<
  string,
  { inventory: CriterionInventory; observations: (() => boolean)[] }
>();
const cacheCounts = { extractions: 0, hits: 0, invalidations: 0 };
export const inventoryCacheCounts = () => ({ ...cacheCounts });

export function criterionInventory(root: string, entryPath: string): CriterionInventory {
  const key = canonicalDigest({
    root: path.resolve(root),
    entry: normalizedProjectPath(entryPath),
    policy: EXTRACTION_POLICY,
  });
  const previous = inventories.get(key);
  if (previous !== undefined && previous.observations.every((current) => current())) {
    cacheCounts.hits++;
    return structuredClone(previous.inventory);
  }
  const observations = new Map<string, { digest: string; current: () => boolean }>();
  let unstable = false;
  cacheCounts.extractions++;
  if (previous !== undefined) cacheCounts.invalidations++;
  const observe = <T>(operation: string, args: readonly unknown[], read: () => T): T => {
    const value = read();
    const digest = observedDigest(value);
    const key = canonicalDigest({ operation, args: args.map(observedDigest) });
    const previous = observations.get(key);
    if (previous !== undefined && previous.digest !== digest) unstable = true;
    if (previous === undefined)
      observations.set(key, { digest, current: () => observedDigest(read()) === digest });
    return value;
  };
  const system: ts.System = {
    ...ts.sys,
    readFile: (file, encoding) =>
      observe('readFile', [file, encoding], () => ts.sys.readFile(file, encoding)),
    fileExists: (file) => observe('fileExists', [file], () => ts.sys.fileExists(file)),
    directoryExists: (directory) =>
      observe('directoryExists', [directory], () => ts.sys.directoryExists(directory)),
    getDirectories: (directory) =>
      observe('getDirectories', [directory], () => ts.sys.getDirectories(directory)),
    readDirectory: (directory, extensions, exclude, include, depth) => {
      const capturedExtensions = extensions === undefined ? undefined : [...extensions];
      const capturedExclude = exclude === undefined ? undefined : [...exclude];
      const capturedInclude = include === undefined ? undefined : [...include];
      return observe(
        'readDirectory',
        [directory, capturedExtensions, capturedExclude, capturedInclude, depth],
        () =>
          ts.sys.readDirectory(
            directory,
            capturedExtensions,
            capturedExclude,
            capturedInclude,
            depth,
          ),
      );
    },
  };
  if (ts.sys.realpath !== undefined)
    system.realpath = (file) => observe('realpath', [file], () => ts.sys.realpath?.(file) ?? file);
  const inventory = extractInventory(root, entryPath, system);
  const current = [...observations.values()].map((item) => item.current);
  if (unstable || !current.every((read) => read())) throw new Error('UNSTABLE_EXPECT_INPUT');
  inventories.set(key, { inventory: structuredClone(inventory), observations: current });
  return inventory;
}

function extractInventory(root: string, entryPath: string, system: ts.System): CriterionInventory {
  const print = extractionPrinter();
  const entry = normalizedProjectPath(entryPath);
  const absolute = confinedProjectPath(root, entry);
  const rel = (file: string): string => path.relative(root, file).split(path.sep).join('/');
  const configuration = new Map<string, string | null>();
  let directory = path.dirname(absolute);
  let config: string | undefined;
  for (;;) {
    const candidate = path.join(directory, 'tsconfig.json');
    configuration.set(rel(candidate), null);
    if (system.fileExists(candidate)) {
      config = candidate;
      break;
    }
    if (directory === path.resolve(root)) break;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const configDiagnostics: string[] = [];
  const read = (file: string): string | undefined => {
    if (
      rel(file).startsWith('../') ||
      /(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|credentials(?:\.[^/\\]*)?|secrets?(?:\.[^/\\]*)?)(?:[/\\]|$)/i.test(
        file,
      )
    ) {
      configDiagnostics.push('unavailable/private resolution configuration');
      return undefined;
    }
    let text: string | undefined;
    try {
      text = system.readFile(confinedProjectPath(root, rel(file)));
    } catch {
      configDiagnostics.push('unavailable resolution configuration');
    }
    if (!rel(file).startsWith('../')) configuration.set(rel(file), text ?? null);
    else configDiagnostics.push('external resolution configuration');
    return text;
  };
  const parsed =
    config === undefined
      ? undefined
      : ts.getParsedCommandLineOfConfigFile(
          config,
          {},
          {
            ...system,
            readFile: read,
            onUnRecoverableConfigFileDiagnostic: () => configDiagnostics.push('invalid tsconfig'),
          },
        );
  if ((parsed?.errors.length ?? 0) > 0) configDiagnostics.push('invalid tsconfig');
  for (const file of ['package.json', 'package-lock.json']) read(path.join(root, file));
  const options: ts.CompilerOptions = parsed?.options ?? {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
  };
  if (
    options.paths !== undefined ||
    options.moduleSuffixes !== undefined ||
    options.customConditions !== undefined
  )
    configDiagnostics.push('runtime alias/conditions resolution unverified');
  const host = ts.createCompilerHost(options);
  host.fileExists = (file) => system.fileExists(file);
  host.directoryExists = (directory) => system.directoryExists(directory);
  host.getDirectories = (directory) => system.getDirectories(directory);
  host.readDirectory = (directory, extensions, exclude, include, depth) =>
    system.readDirectory(directory, extensions, exclude, include, depth);
  if (system.realpath !== undefined) host.realpath = (file) => system.realpath?.(file) ?? file;
  const hostRead = (file: string) => system.readFile(file);
  host.readFile = (file) => {
    if (
      /(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|credentials(?:\.[^/\\]*)?|secrets?(?:\.[^/\\]*)?)(?:[/\\]|$)/i.test(
        file,
      )
    ) {
      configDiagnostics.push('private source dependency unavailable');
      return undefined;
    }
    if (rel(file).startsWith('../')) {
      if (
        file.includes(`${path.sep}node_modules${path.sep}`) &&
        (file.endsWith('.d.ts') || file.endsWith('package.json'))
      )
        return hostRead(file);
      configDiagnostics.push('external source dependency unavailable');
      return undefined;
    }
    try {
      return hostRead(confinedProjectPath(root, rel(file)));
    } catch {
      configDiagnostics.push('unavailable source dependency');
      return undefined;
    }
  };
  const program = ts.createProgram([absolute], options, host);
  const checker = program.getTypeChecker();
  const sources = program
    .getSourceFiles()
    .filter(
      (f) =>
        !f.isDeclarationFile &&
        !rel(f.fileName).startsWith('../') &&
        !rel(f.fileName).includes('node_modules/'),
    );
  const symbol = (node: ts.Node): ts.Symbol | undefined => {
    const found = checker.getSymbolAtLocation(node);
    return found !== undefined && (found.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(found)
      : found;
  };
  const imported = (node: ts.Expression): string | undefined => {
    if (ts.isCallExpression(node)) return imported(node.expression);
    let base = node;
    while (ts.isPropertyAccessExpression(base)) base = base.expression;
    if (!ts.isIdentifier(base)) return undefined;
    return checker
      .getSymbolAtLocation(base)
      ?.declarations?.map(moduleName)
      .find((m) => m !== undefined);
  };
  const apiName = (expression: ts.Expression): string => {
    if (ts.isCallExpression(expression)) return apiName(expression.expression);
    if (ts.isPropertyAccessExpression(expression)) {
      if (['skip', 'todo', 'only', 'each', 'wip'].includes(expression.name.text))
        return apiName(expression.expression);
      return expression.name.text;
    }
    const declaration = checker.getSymbolAtLocation(expression)?.declarations?.[0];
    return declaration !== undefined && ts.isImportSpecifier(declaration)
      ? (declaration.propertyName ?? declaration.name).text
      : rootName(expression);
  };
  const registration = (call: ts.CallExpression): boolean => {
    if (ts.isCallExpression(call.parent) && call.parent.expression === call) return false;
    const mod = imported(call.expression);
    return (
      (mod === 'vitest' || mod === '@shahimat/ai-core/expect') &&
      ['it', 'test', 'crit', 'warn'].includes(apiName(call.expression))
    );
  };
  const suite = (call: ts.CallExpression): boolean =>
    ['describe', 'suite'].includes(apiName(call.expression)) &&
    ['vitest', '@shahimat/ai-core/expect'].includes(imported(call.expression) ?? '');
  const callbackImplementations = (
    node: ts.Node,
    seen = new Set<ts.Node>(),
  ): (
    ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration
  )[] => {
    if (seen.has(node)) return [];
    seen.add(node);
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    )
      return node.body === undefined ? [] : [node];
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined)
      return callbackImplementations(node.initializer, seen);
    if (ts.isParenthesizedExpression(node)) return callbackImplementations(node.expression, seen);
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node))
      return (
        symbol(ts.isPropertyAccessExpression(node) ? node.name : node)?.declarations ?? []
      ).flatMap((declaration) => callbackImplementations(declaration, seen));
    return [];
  };
  const modifier = (expression: ts.Expression, name: string): boolean => {
    if (ts.isCallExpression(expression)) return modifier(expression.expression, name);
    return (
      ts.isPropertyAccessExpression(expression) &&
      (expression.name.text === name || modifier(expression.expression, name))
    );
  };
  const expectCallee = (expression: ts.Expression): boolean =>
    imported(expression) === 'vitest' && apiName(expression) === 'expect';
  const assertionReceiver = (expression: ts.Expression): boolean => {
    if (
      !ts.isPropertyAccessExpression(expression) ||
      ![
        'toBe',
        'toEqual',
        'toStrictEqual',
        'toBeDefined',
        'toBeUndefined',
        'toBeNull',
        'toBeTruthy',
        'toBeFalsy',
        'toBeNaN',
        'toContain',
        'toContainEqual',
        'toHaveLength',
        'toMatch',
        'toMatchObject',
        'toBeGreaterThan',
        'toBeGreaterThanOrEqual',
        'toBeLessThan',
        'toBeLessThanOrEqual',
      ].includes(expression.name.text)
    )
      return false;
    let receiver = expression.expression;
    while (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'not')
      receiver = receiver.expression;
    return ts.isCallExpression(receiver) && expectCallee(receiver.expression);
  };
  const globalDiagnostics = [...configDiagnostics];
  const effects: { file: string; declaration: string }[] = [];
  const effectNodes: ts.Node[] = [];
  const suiteInvocations: string[] = [];
  const checkResolution = (source: ts.SourceFile, mod: string): void => {
    if (!mod.startsWith('.') && !mod.startsWith('#')) {
      if (mod !== 'vitest') globalDiagnostics.push(`external module effects: ${mod}`);
      return;
    }
    const resolved = ts.resolveModuleName(mod, source.fileName, options, host).resolvedModule;
    if (resolved === undefined) globalDiagnostics.push(`unresolved import closure: ${mod}`);
    const direct = path.resolve(path.dirname(source.fileName), mod);
    if (
      mod.startsWith('#') ||
      !/\.(?:[cm]?js|[cm]?ts)$/.test(mod) ||
      (resolved !== undefined &&
        system.fileExists(direct) &&
        path.resolve(resolved.resolvedFileName) !== direct)
    )
      globalDiagnostics.push(`runtime resolution unverified: ${mod}`);
  };
  for (const source of sources) {
    if (program.getSyntacticDiagnostics(source).length > 0)
      globalDiagnostics.push(`parse error: ${rel(source.fileName)}`);
    for (const statement of source.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
      )
        checkResolution(source, statement.moduleSpecifier.text);
      if (ts.isImportDeclaration(statement)) {
        const mod = ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : '';
        checkResolution(source, mod);
        if (
          statement.importClause === undefined ||
          (!mod.startsWith('.') && !mod.startsWith('#') && mod !== 'vitest')
        ) {
          effects.push({ file: rel(source.fileName), declaration: print(statement) });
          globalDiagnostics.push(`unmodelled module effects: ${mod}`);
        }
      } else if (
        ts.isExpressionStatement(statement) &&
        ts.isCallExpression(statement.expression) &&
        (registration(statement.expression) || suite(statement.expression))
      ) {
        continue;
      } else if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isExportDeclaration(statement)
      ) {
        if (
          ts.isClassDeclaration(statement) &&
          ((ts.getDecorators(statement)?.length ?? 0) > 0 ||
            statement.heritageClauses !== undefined ||
            statement.members.some(
              (member) =>
                ts.isClassStaticBlockDeclaration(member) ||
                (member.name !== undefined && ts.isComputedPropertyName(member.name)) ||
                (ts.canHaveDecorators(member) && (ts.getDecorators(member)?.length ?? 0) > 0) ||
                (ts.isPropertyDeclaration(member) &&
                  member.initializer !== undefined &&
                  ts
                    .getModifiers(member)
                    ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) === true),
            ))
        ) {
          effects.push({ file: rel(source.fileName), declaration: print(statement) });
          globalDiagnostics.push(`class initialization effects: ${rel(source.fileName)}`);
        }
        continue;
      } else if (
        ts.isVariableStatement(statement) &&
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
        statement.declarationList.declarations.every(
          (d) =>
            d.initializer !== undefined &&
            (ts.isLiteralExpression(d.initializer) ||
              ts.isArrowFunction(d.initializer) ||
              ts.isFunctionExpression(d.initializer)),
        )
      ) {
        continue;
      } else {
        effects.push({ file: rel(source.fileName), declaration: print(statement) });
        if (!(
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          ['beforeEach', 'beforeAll', 'afterEach', 'afterAll'].includes(
            rootName(statement.expression),
          )
        ))
          globalDiagnostics.push(`unresolved shared effects: ${rel(source.fileName)}`);
      }
    }
    const nestedEffects = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && registration(node) && modifier(node.expression, 'only')) {
        suiteInvocations.push(print(node.expression));
        globalDiagnostics.push('exclusive registration membership requires group review');
      }
      if (
        (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
        !(
          ts.isCallExpression(node) &&
          (registration(node) ||
            suite(node) ||
            expectCallee(node.expression) ||
            assertionReceiver(node.expression))
        ) &&
        callbackImplementations(node.expression).length === 0
      ) {
        effects.push({ file: rel(source.fileName), declaration: print(node) });
        effectNodes.push(node);
        globalDiagnostics.push(
          'entry call effects: runtime implementation is not attested by a type declaration',
        );
      }
      if (
        (ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
        ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          (node.operator === ts.SyntaxKind.PlusPlusToken ||
            node.operator === ts.SyntaxKind.MinusMinusToken)) ||
        ts.isDeleteExpression(node)
      ) {
        effects.push({ file: rel(source.fileName), declaration: print(node) });
        effectNodes.push(node);
        globalDiagnostics.push('entry write effects: affected closure is not isolated');
      }
      if (
        ts.isCallExpression(node) &&
        ['beforeEach', 'beforeAll', 'afterEach', 'afterAll'].includes(apiName(node.expression))
      ) {
        effects.push({ file: rel(source.fileName), declaration: print(node) });
        globalDiagnostics.push(`hook closure requires controlled effects: ${rel(source.fileName)}`);
      }
      if (ts.isCallExpression(node) && suite(node)) {
        const callback = node.arguments[1];
        if (modifier(node.expression, 'only') || ts.isCallExpression(node.expression)) {
          suiteInvocations.push(print(node.expression));
          globalDiagnostics.push('suite dispatch/membership policy requires group review');
        }
        if (
          callback === undefined ||
          (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
        ) {
          suiteInvocations.push(print(node));
          globalDiagnostics.push('suite callback invocation provenance incomplete');
          if (callback !== undefined) effectNodes.push(callback);
        } else if (!ts.isBlock(callback.body)) {
          effects.push({ file: rel(source.fileName), declaration: print(callback.body) });
          effectNodes.push(callback.body);
          globalDiagnostics.push('suite expression/control effects require group review');
        }
        if (
          callback !== undefined &&
          (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
          ts.isBlock(callback.body)
        ) {
          for (const statement of callback.body.statements)
            if (!(
              ts.isExpressionStatement(statement) &&
              ts.isCallExpression(statement.expression) &&
              (registration(statement.expression) || suite(statement.expression))
            )) {
              effects.push({ file: rel(source.fileName), declaration: print(statement) });
              globalDiagnostics.push(`suite initializer/effects group: ${rel(source.fileName)}`);
            }
        }
      }
      ts.forEachChild(node, nestedEffects);
    };
    nestedEffects(source);
  }
  const criteria: CriterionInput[] = [];
  for (const source of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && registration(node)) {
        const title = node.arguments[0];
        const callback = node.arguments[1];
        const diagnostics = [...globalDiagnostics, ...configDiagnostics];
        const intent: string[] = [];
        const registrationContracts = [print(node.expression), ...suiteInvocations];
        const registrationControls = new Set<ts.Node>();
        const captureControl = (control: ts.Node): void => {
          if (registrationControls.has(control)) return;
          registrationControls.add(control);
          const walkControl = (part: ts.Node): void => {
            if (ts.isIdentifier(part)) {
              for (const declaration of symbol(part)?.declarations ?? []) {
                if (declaration === part.parent || ts.isSourceFile(declaration)) continue;
                const file = rel(declaration.getSourceFile().fileName);
                if (!file.startsWith('../') && !file.includes('node_modules/'))
                  captureControl(declaration);
              }
            }
            ts.forEachChild(part, walkControl);
          };
          walkControl(control);
        };
        for (
          let parent: ts.Node | undefined = node.parent;
          parent !== undefined;
          parent = parent.parent
        ) {
          if (ts.isCallExpression(parent) && suite(parent)) {
            registrationContracts.push(print(parent.expression));
            if (
              modifier(parent.expression, 'skip') ||
              modifier(parent.expression, 'only') ||
              ts.isCallExpression(parent.expression)
            )
              diagnostics.push('suite registration modifier/membership unmodelled');
            const suiteCallback = parent.arguments[1];
            if (
              suiteCallback !== undefined &&
              (ts.isArrowFunction(suiteCallback) || ts.isFunctionExpression(suiteCallback)) &&
              !ts.isBlock(suiteCallback.body)
            )
              captureControl(suiteCallback.body);
            const name = parent.arguments[0];
            if (name !== undefined && ts.isStringLiteralLike(name)) intent.unshift(name.text);
            else diagnostics.push('dynamic suite');
          } else if (
            ts.isForStatement(parent) ||
            ts.isForOfStatement(parent) ||
            ts.isIfStatement(parent) ||
            ts.isConditionalExpression(parent) ||
            ts.isSwitchStatement(parent) ||
            ts.isWhileStatement(parent) ||
            ts.isDoStatement(parent) ||
            ts.isFunctionDeclaration(parent) ||
            ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
              !(
                ts.isCallExpression(parent.parent) &&
                suite(parent.parent) &&
                parent.parent.arguments[1] === parent
              ))
          ) {
            diagnostics.push('dynamic/factory registration group');
            captureControl(parent);
          }
        }
        if (title !== undefined && ts.isStringLiteralLike(title)) intent.push(title.text);
        else {
          intent.push(title === undefined ? '' : print(title));
          diagnostics.push('dynamic title/table group');
        }
        if (ts.isCallExpression(node.expression) || print(node.expression).includes('.each'))
          diagnostics.push('dynamic table group');
        const titleComplete = !diagnostics.some((diagnostic) =>
          /dynamic.*(?:suite|title|table|registration)|factory registration|suite (?:dispatch|callback invocation|expression\/control)|suite registration modifier/.test(
            diagnostic,
          ),
        );
        const dependencies = new Map<string, { file: string; declaration: string }>();
        const visited = new Set<ts.Node>();
        const include = (n: ts.Node): void => {
          if (visited.has(n)) return;
          visited.add(n);
          const file = rel(n.getSourceFile().fileName);
          if (file.startsWith('../') || file.includes('node_modules/')) {
            diagnostics.push('external dependency');
            return;
          }
          const declaration = print(n);
          dependencies.set(`${file}:${declaration}`, { file, declaration });
          walk(n);
        };
        const walk = (n: ts.Node): void => {
          if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword)
            diagnostics.push('runtime callback receiver unmodelled');
          if (
            ts.isBinaryExpression(n) &&
            n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
          )
            diagnostics.push('unmodelled mutation effects');
          if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) {
            if (
              n.operator === ts.SyntaxKind.PlusPlusToken ||
              n.operator === ts.SyntaxKind.MinusMinusToken
            )
              diagnostics.push('unmodelled mutation effects');
          }
          if (ts.isPropertyAccessExpression(n)) {
            const owner = symbol(n.expression)?.declarations?.find(ts.isClassDeclaration);
            const methods = symbol(n.name)?.declarations?.filter(ts.isMethodDeclaration) ?? [];
            if (
              owner !== undefined &&
              methods.length > 0 &&
              methods.every(
                (method) =>
                  method.parent === owner &&
                  ts
                    .getModifiers(method)
                    ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) === true,
              )
            ) {
              const header = ts.factory.updateClassDeclaration(
                owner,
                owner.modifiers,
                owner.name,
                owner.typeParameters,
                owner.heritageClauses,
                [],
              );
              const declaration = print(header, owner.getSourceFile());
              const file = rel(owner.getSourceFile().fileName);
              dependencies.set(`${file}:class:${declaration}`, { file, declaration });
              dependencies.set(`${file}:overloads:${n.name.text}`, {
                file,
                declaration: methods.map((method) => print(method)).join('\n'),
              });
              let base: ts.Expression = n.expression;
              while (ts.isPropertyAccessExpression(base)) base = base.expression;
              for (const importedDeclaration of checker.getSymbolAtLocation(base)?.declarations ??
                []) {
                if (moduleName(importedDeclaration) === undefined) continue;
                let parent: ts.Node = importedDeclaration;
                while (!ts.isImportDeclaration(parent) && parent.parent !== undefined)
                  parent = parent.parent;
                if (ts.isImportDeclaration(parent))
                  dependencies.set(`${rel(parent.getSourceFile().fileName)}:${print(parent)}`, {
                    file: rel(parent.getSourceFile().fileName),
                    declaration: print(parent),
                  });
              }
              for (const method of methods) include(method);
              return;
            }
            const baseSymbol = ts.isIdentifier(n.expression)
              ? checker.getSymbolAtLocation(n.expression)
              : undefined;
            const namespace = baseSymbol?.declarations?.find(ts.isNamespaceImport);
            if (namespace !== undefined && imported(n.expression) !== 'vitest') {
              const declaration = namespace.parent.parent;
              if (ts.isImportDeclaration(declaration))
                dependencies.set(`${rel(source.fileName)}:${print(declaration)}`, {
                  file: rel(source.fileName),
                  declaration: print(declaration),
                });
              const target = symbol(n.name);
              if (target?.declarations === undefined)
                diagnostics.push('unresolved namespace member');
              for (const member of target?.declarations ?? []) include(member);
              return;
            }
            let base: ts.Expression = n.expression;
            while (ts.isPropertyAccessExpression(base) || ts.isCallExpression(base))
              base = base.expression;
            if (
              ts.isIdentifier(base) &&
              apiName(base) === 'expect' &&
              imported(base) === 'vitest'
            ) {
              walk(n.expression);
              return;
            }
          }
          if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
            const mod = imported(n.expression);
            const target = symbol(
              ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression,
            );
            if (
              mod !== 'vitest' &&
              target?.declarations === undefined &&
              !print(n.expression).startsWith('expect(')
            )
              diagnostics.push(`unresolved call: ${print(n.expression)}`);
          }
          if (ts.isIdentifier(n)) {
            const direct = checker.getSymbolAtLocation(n);
            const mod = direct?.declarations?.map(moduleName).find((m) => m !== undefined);
            if (mod === 'vitest') return;
            for (const declaration of direct?.declarations ?? []) {
              if (moduleName(declaration) !== undefined) {
                let parent: ts.Node = declaration;
                while (!ts.isImportDeclaration(parent) && parent.parent !== undefined)
                  parent = parent.parent;
                if (ts.isImportDeclaration(parent))
                  dependencies.set(`${rel(parent.getSourceFile().fileName)}:${print(parent)}`, {
                    file: rel(parent.getSourceFile().fileName),
                    declaration: print(parent),
                  });
              }
            }
            for (const declaration of symbol(n)?.declarations ?? []) {
              if (
                declaration === n.parent ||
                (callback !== undefined &&
                  declaration.getSourceFile() === callback.getSourceFile() &&
                  declaration.pos >= callback.pos &&
                  declaration.end <= callback.end)
              )
                continue;
              if (ts.isSourceFile(declaration)) {
                diagnostics.push('namespace dependency');
                continue;
              }
              include(declaration);
            }
            if (direct === undefined && !['undefined', 'NaN', 'Infinity'].includes(n.text))
              diagnostics.push(`unresolved identifier: ${n.text}`);
          }
          ts.forEachChild(n, walk);
        };
        if (callback !== undefined) {
          const implementations = callbackImplementations(callback);
          if (implementations.length === 0)
            diagnostics.push('runtime callback implementation unresolved');
          if (implementations.some((implementation) => implementation.parameters.length > 0))
            diagnostics.push('runtime callback fixture context unmodelled');
          include(callback);
        } else diagnostics.push('missing callback');
        for (const argument of node.arguments.slice(2)) include(argument);
        for (const effect of effectNodes) include(effect);
        for (const effect of effects)
          dependencies.set(`${effect.file}:${effect.declaration}`, effect);
        const body = [
          print(node.expression),
          ...node.arguments.slice(1).map((arg) => print(arg)),
        ].join('\n');
        const registration = canonicalDigest({
          contracts: registrationContracts,
          controls: [...registrationControls]
            .map((control) => ({
              file: rel(control.getSourceFile().fileName),
              declaration: print(control),
            }))
            .sort((a, b) =>
              `${a.file}:${a.declaration}`.localeCompare(`${b.file}:${b.declaration}`),
            ),
        });
        const file = rel(source.fileName);
        const anchor =
          callback !== undefined &&
          (ts.isIdentifier(callback) || ts.isPropertyAccessExpression(callback))
            ? print(callback)
            : intent;
        const identity = canonicalDigest({ entry, file, anchor, policy: EXTRACTION_POLICY });
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        const end = source.getLineAndCharacterOfPosition(node.end);
        const deps = [...dependencies.values()].sort((a, b) =>
          `${a.file}:${a.declaration}`.localeCompare(`${b.file}:${b.declaration}`),
        );
        const unique = [...new Set(diagnostics)].sort();
        criteria.push({
          titleComplete,
          identity,
          lineage: identity,
          file,
          location: {
            line: location.line + 1,
            column: location.character + 1,
            endLine: end.line + 1,
            endColumn: end.character + 1,
          },
          intent,
          body,
          registration,
          dependencies: deps,
          complete: unique.length === 0,
          diagnostics: unique,
          multiplicity: 1,
          input: '',
          reviewScope: {
            kind:
              unique.length === 0
                ? 'criterion'
                : globalDiagnostics.length > 0 || configDiagnostics.length > 0
                  ? 'entry'
                  : 'registration-group',
            key:
              unique.length === 0
                ? identity
                : canonicalDigest({ entry, file, suite: intent.slice(0, -1) }),
          },
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const configurationList = [...configuration]
    .map(([file, text]) => ({ file, text }))
    .sort((a, b) => a.file.localeCompare(b.file));
  for (const criterion of criteria) {
    criterion.multiplicity = criteria.filter((c) => c.identity === criterion.identity).length;
    if (criterion.multiplicity > 1) {
      criterion.complete = false;
      criterion.diagnostics.push('duplicate registration group');
      if (criterion.reviewScope.kind !== 'entry')
        criterion.reviewScope = { kind: 'registration-group', key: criterion.identity };
    }
    criterion.input = canonicalDigest({
      policy: EXTRACTION_POLICY,
      compiler: ts.version,
      entry,
      file: criterion.file,
      intent: criterion.intent,
      body: criterion.body,
      registration: criterion.registration,
      dependencies: criterion.dependencies,
      configuration: configurationList,
      multiplicity: criterion.multiplicity,
      diagnostics: criterion.diagnostics,
      reviewScope: criterion.reviewScope,
    });
  }
  const membership = canonicalDigest(
    criteria
      .map((c) => ({
        identity: c.identity,
        intent: c.intent,
        multiplicity: c.multiplicity,
        registration: c.registration,
      }))
      .sort((a, b) => a.identity.localeCompare(b.identity)),
  );
  const generation = canonicalDigest({
    membership,
    configuration: configurationList,
    sources: sources
      .map((f) => ({ file: rel(f.fileName), text: f.text }))
      .sort((a, b) => a.file.localeCompare(b.file)),
  });
  return {
    policy: EXTRACTION_POLICY,
    entry,
    criteria,
    membership,
    generation,
    configuration: configurationList,
  };
}

export function reconcileCriterionLineage(
  previous: CriterionInventory,
  current: CriterionInventory,
): CriterionInventory {
  if (previous.entry !== current.entry || previous.policy !== current.policy) return current;
  const candidates = current.criteria.map((criterion) =>
    previous.criteria.filter(
      (old) =>
        old.multiplicity === 1 &&
        criterion.multiplicity === 1 &&
        old.file === criterion.file &&
        (old.identity === criterion.identity ||
          (canonicalDigest(old.intent.slice(0, -1)) ===
            canonicalDigest(criterion.intent.slice(0, -1)) &&
            (old.body === criterion.body ||
              canonicalDigest(old.intent) === canonicalDigest(criterion.intent)))),
    ),
  );
  return {
    ...current,
    criteria: current.criteria.map((criterion, index) => {
      const matches = candidates[index];
      const old = matches?.length === 1 ? matches[0] : undefined;
      if (
        old === undefined ||
        candidates.filter((group) => group.some((candidate) => candidate.identity === old.identity))
          .length !== 1
      )
        return criterion;
      return { ...criterion, lineage: old.lineage };
    }),
  };
}

export function registrationInput(
  inventory: CriterionInventory,
  registration: { file: string; line: number; column: number },
  collection: readonly { file: string; line: number; column: number }[] = [registration],
): CriterionInput | undefined {
  const candidates = inventory.criteria.filter((criterion) => {
    const range = criterion.location;
    return (
      criterion.file === registration.file &&
      (registration.line > range.line ||
        (registration.line === range.line && registration.column >= range.column)) &&
      (registration.line < range.endLine ||
        (registration.line === range.endLine && registration.column <= range.endColumn))
    );
  });
  const criterion = candidates.length === 1 ? candidates[0] : undefined;
  if (criterion === undefined) return undefined;
  const count = collection.filter((location) =>
    registrationInputWithin(criterion, location),
  ).length;
  if (count <= 1) return criterion;
  const diagnostics = [
    ...new Set([
      ...criterion.diagnostics,
      'repeated runtime registration location: invocation provenance incomplete',
    ]),
  ];
  return {
    ...criterion,
    complete: false,
    titleComplete: false,
    multiplicity: Math.max(count, criterion.multiplicity),
    diagnostics,
    reviewScope: {
      kind: criterion.reviewScope.kind === 'entry' ? 'entry' : 'registration-group',
      key: criterion.identity,
    },
    input: canonicalDigest({
      declaration: criterion.input,
      runtimeMultiplicity: count,
      diagnostics,
    }),
  };
}

function registrationInputWithin(
  criterion: CriterionInput,
  registration: { file: string; line: number; column: number },
): boolean {
  const range = criterion.location;
  return (
    criterion.file === registration.file &&
    (registration.line > range.line ||
      (registration.line === range.line && registration.column >= range.column)) &&
    (registration.line < range.endLine ||
      (registration.line === range.endLine && registration.column <= range.endColumn))
  );
}
