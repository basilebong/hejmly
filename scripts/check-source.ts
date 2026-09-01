#!/usr/bin/env bun
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AsExpression,
  Identifier,
  Node,
  SourceFile,
  TypeAssertion,
  TypeNode,
  TypeReferenceNode,
} from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";
import { API } from "typescript/unstable/async";

type Violation = {
  file: string;
  line: number;
  col: number;
  rule: "no-bare-as";
  message: string;
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const collectFiles = (): string[] => {
  if (args.length > 0) return args.map((f) => resolve(repoRoot, f));
  const glob = new Bun.Glob("**/*.{ts,tsx}");
  const out: string[] = [];
  for (const f of glob.scanSync(repoRoot)) {
    if (/(^|\/)(node_modules|dist|build|coverage|drizzle|\.git)\//.test(f)) continue;
    if (f.endsWith(".d.ts")) continue;
    out.push(resolve(repoRoot, f));
  }
  return out;
};

// TypeScript 7 ships no is-helpers for these kinds and `Node` is a base interface
// rather than a discriminated union, so `kind` alone does not narrow.
const isAsExpression = (node: Node): node is AsExpression => node.kind === SyntaxKind.AsExpression;

const isTypeAssertion = (node: Node): node is TypeAssertion =>
  node.kind === SyntaxKind.TypeAssertionExpression;

const isTypeReferenceNode = (node: TypeNode): node is TypeReferenceNode =>
  node.kind === SyntaxKind.TypeReference;

const isIdentifier = (node: Node): node is Identifier => node.kind === SyntaxKind.Identifier;

const isAsConst = (typeNode: TypeNode): boolean =>
  isTypeReferenceNode(typeNode) &&
  isIdentifier(typeNode.typeName) &&
  typeNode.typeName.text === "const";

const checkSourceFile = (file: string, sf: SourceFile): Violation[] => {
  const violations: Violation[] = [];
  const at = (node: Node) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    return { line: line + 1, col: character + 1 };
  };

  const visit = (node: Node): void => {
    if (isAsExpression(node) && !isAsConst(node.type)) {
      violations.push({
        file,
        ...at(node.type),
        rule: "no-bare-as",
        message: "'as' type assertion forbidden; only 'as const' is allowed",
      });
    }

    if (isTypeAssertion(node)) {
      violations.push({
        file,
        ...at(node),
        rule: "no-bare-as",
        message: "angle-bracket type assertion forbidden",
      });
    }

    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return violations;
};

// TypeScript 7 exposes no parser for a bare source string — an AST only comes out
// of a Program. The files to check do not all belong to one: drizzle.config.ts,
// better-auth.config.ts and scripts/ sit outside every referenced project. So the
// project is synthesised here and handed to the API through its virtual-FS hooks,
// which fall back to the real disk for everything except this one path. That also
// keeps the pre-commit invocation (an explicit list of staged files) on the same
// code path as a full scan.
const virtualConfigPath = resolve(repoRoot, "tsconfig.check-source.json");

const virtualConfig = (files: string[]): string =>
  JSON.stringify({
    extends: "./tsconfig.base.json",
    compilerOptions: { noEmit: true, composite: false, declaration: false, incremental: false },
    files,
  });

const files = collectFiles();
if (files.length === 0) {
  console.log("check-source: ok (0 files)");
  process.exit(0);
}

const configText = virtualConfig(files);
const api = new API({
  cwd: repoRoot,
  fs: {
    readFile: (fileName) => (fileName === virtualConfigPath ? configText : undefined),
    fileExists: (fileName) => (fileName === virtualConfigPath ? true : undefined),
  },
});

const all: Violation[] = [];
const missing: string[] = [];
try {
  const snapshot = await api.updateSnapshot({ openProjects: [virtualConfigPath] });
  const project = snapshot.getProjects()[0];
  if (project === undefined) {
    console.error("check-source: failed to load the synthesised project");
    process.exit(1);
  }
  for (const file of files) {
    const sf = await project.program.getSourceFile(file);
    // A file silently absent from the program would be a silently unchecked file.
    if (sf === undefined) {
      missing.push(file);
      continue;
    }
    all.push(...checkSourceFile(file, sf));
  }
} finally {
  await api.close();
}

if (missing.length > 0) {
  for (const file of missing) {
    console.error(`check-source: ${relative(repoRoot, file)} was not loaded into the program`);
  }
  console.error(`\ncheck-source: ${missing.length} file(s) could not be checked`);
  process.exit(1);
}

for (const v of all) {
  const rel = relative(repoRoot, v.file);
  console.error(`${rel}:${v.line}:${v.col}  [${v.rule}]  ${v.message}`);
}

if (all.length > 0) {
  console.error(`\ncheck-source: ${all.length} violation(s) across ${files.length} file(s)`);
  process.exit(1);
}

console.log(`check-source: ok (${files.length} files)`);
