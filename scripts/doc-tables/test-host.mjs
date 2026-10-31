/**
 * `<!-- generated:test-host -->`: the public members of `TestHost`
 * (src/plugin/testing.ts) with the first sentence of their doc comment,
 * in source order. Private, `#private` and `@internal` members are left
 * out.
 */
import ts from "typescript";
import { docText, sourceFile, summary } from "./lib/source.mjs";

export default function testHost({ table }) {
  const file = sourceFile("src/plugin/testing.ts");
  const host = file.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === "TestHost",
  );
  if (!host) throw new Error("src/plugin/testing.ts: no class TestHost");
  const rows = [];
  const seen = new Set();
  for (const member of host.members) {
    if (!member.name || ts.isPrivateIdentifier(member.name)) continue;
    if (ts.isConstructorDeclaration(member)) continue;
    const modifiers = ts.getCombinedModifierFlags(member);
    if (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
      continue;
    const text = docText(member);
    if (!text || /(^|\n)@internal\b/.test(text)) continue;
    const name = member.name.getText();
    if (seen.has(name)) continue; // a getter and its setter
    seen.add(name);
    const call = ts.isMethodDeclaration(member) ? `${name}()` : name;
    const first = /^(.+?[.!?])(\s|$)/.exec(summary(text))?.[1] ?? summary(text);
    rows.push([
      `{@link "@vestra-player/sdk/testing"!TestHost.${name}}${call.endsWith("()") ? "()" : ""}`,
      first,
    ]);
  }
  if (rows.length < 20) throw new Error("TestHost: too few members found");
  return table(["Member", "What it is"], rows);
}
