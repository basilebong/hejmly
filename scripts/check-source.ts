#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";

type Violation = {
  file: string;
  line: number;
  col: number;
  rule: "no-bare-as";
  message: string;
};

const args = process.argv.slice(2);

const collectFiles = (): string[] => {
  if (args.length > 0) return args;
  const glob = new Bun.Glob("**/*.{ts,tsx}");
  const out: string[] = [];
  for (const f of glob.scanSync(".")) {
    if (/(^|\/)(node_modules|dist|build|coverage|drizzle|\.git)\//.test(f)) continue;
    if (f.endsWith(".d.ts")) continue;
    out.push(f);
  }
  return out;
};

const isAsConst = (typeNode: ts.TypeNode): boolean =>
  ts.isTypeReferenceNode(typeNode) &&
  ts.isIdentifier(typeNode.typeName) &&
  typeNode.typeName.text === "const";

const checkFile = (file: string): Violation[] => {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const violations: Violation[] = [];
  const at = (node: ts.Node) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
    return { line: line + 1, col: character + 1 };
  };

  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) && !isAsConst(node.type)) {
      const pos = at(node.type);
      violations.push({
        file,
        ...pos,
        rule: "no-bare-as",
        message: "'as' type assertion forbidden; only 'as const' is allowed",
      });
    }

    if (ts.isTypeAssertionExpression(node)) {
      const pos = at(node);
      violations.push({
        file,
        ...pos,
        rule: "no-bare-as",
        message: "angle-bracket type assertion forbidden",
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
};

const files = collectFiles();
const all: Violation[] = [];
for (const file of files) {
  all.push(...checkFile(file));
}

const cwd = process.cwd();
for (const v of all) {
  const rel = relative(cwd, v.file);
  console.error(`${rel}:${v.line}:${v.col}  [${v.rule}]  ${v.message}`);
}

if (all.length > 0) {
  console.error(`\ncheck-source: ${all.length} violation(s) across ${files.length} file(s)`);
  process.exit(1);
}

console.log(`check-source: ok (${files.length} files)`);
