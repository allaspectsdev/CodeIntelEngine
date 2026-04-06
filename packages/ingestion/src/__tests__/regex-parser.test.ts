import { describe, it, expect } from "vitest";
import { RegexParser } from "../parsers/parser.js";
import { extractSymbols } from "../extractors/symbol-extractor.js";

describe("RegexParser", () => {
  const parser = new RegexParser();

  it("extracts function declarations from TypeScript", () => {
    const source = `
export async function fetchUser(id: string): Promise<User> {
  const result = await db.query(id);
  return result;
}

function helper() {
  return 42;
}
`;
    const tree = parser.parse(source, "test.ts");
    expect(tree).not.toBeNull();

    const symbols = extractSymbols(tree!, "test.ts");
    const names = symbols.map((s) => s.node.name);
    expect(names).toContain("fetchUser");
    expect(names).toContain("helper");
  });

  it("extracts call sites from function bodies", () => {
    const source = `
function processOrder(order) {
  const user = getUser(order.userId);
  const total = calculateTotal(order.items);
  sendEmail(user.email, total);
  db.save(order);
}
`;
    const tree = parser.parse(source, "test.ts");
    expect(tree).not.toBeNull();

    const symbols = extractSymbols(tree!, "test.ts");
    const processOrder = symbols.find((s) => s.node.name === "processOrder");
    expect(processOrder).toBeDefined();

    const callNames = processOrder!.callSites.map((c) => c.calleeName);
    expect(callNames).toContain("getUser");
    expect(callNames).toContain("calculateTotal");
    expect(callNames).toContain("sendEmail");
    // db.save should produce a qualified call
    const dbSave = processOrder!.callSites.find((c) => c.calleeName === "save");
    expect(dbSave).toBeDefined();
    expect(dbSave!.qualifier).toBe("db");
  });

  it("does NOT produce call sites for keywords like if, while, for", () => {
    const source = `
function example() {
  if (true) { }
  while (running) { }
  for (let i = 0; i < 10; i++) { }
  switch (x) { }
  return foo();
  throw bar();
}
`;
    const tree = parser.parse(source, "test.ts");
    const symbols = extractSymbols(tree!, "test.ts");
    const example = symbols.find((s) => s.node.name === "example");
    expect(example).toBeDefined();

    const callNames = example!.callSites.map((c) => c.calleeName);
    // foo and bar should be there
    expect(callNames).toContain("foo");
    expect(callNames).toContain("bar");
    // keywords should not
    expect(callNames).not.toContain("if");
    expect(callNames).not.toContain("while");
    expect(callNames).not.toContain("for");
    expect(callNames).not.toContain("switch");
    expect(callNames).not.toContain("return");
    expect(callNames).not.toContain("throw");
  });

  it("handles braces inside string literals without truncating body", () => {
    const source = `
function render() {
  const template = "Hello { world }";
  const backtick = \`value: \${getValue()}\`;
  doSomething();
}
`;
    const tree = parser.parse(source, "test.ts");
    const symbols = extractSymbols(tree!, "test.ts");
    const render = symbols.find((s) => s.node.name === "render");
    expect(render).toBeDefined();

    const callNames = render!.callSites.map((c) => c.calleeName);
    // doSomething should be found even though braces appear in strings above
    expect(callNames).toContain("doSomething");
  });

  it("extracts Python function definitions and calls", () => {
    const source = `
def process_data(data):
    cleaned = clean(data)
    result = transform(cleaned)
    save_to_db(result)
    return result
`;
    const tree = parser.parse(source, "test.py");
    expect(tree).not.toBeNull();

    const symbols = extractSymbols(tree!, "test.py");
    const processFn = symbols.find((s) => s.node.name === "process_data");
    expect(processFn).toBeDefined();

    const callNames = processFn!.callSites.map((c) => c.calleeName);
    expect(callNames).toContain("clean");
    expect(callNames).toContain("transform");
    expect(callNames).toContain("save_to_db");
  });

  it("descendantsOfType recursively searches the full subtree", () => {
    const source = `
function outer() {
  inner();
  deep.nested.call();
}
`;
    const tree = parser.parse(source, "test.ts");
    expect(tree).not.toBeNull();

    // The root node should find call_expression nodes inside function bodies
    const callExprs = tree!.rootNode.descendantsOfType("call_expression");
    expect(callExprs.length).toBeGreaterThan(0);
    const callTexts = callExprs.map((n) => n.namedChildren[0]?.text).filter(Boolean);
    expect(callTexts).toContain("inner");
  });
});
