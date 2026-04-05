import { createHash } from "node:crypto";
import type { GraphNode, NodeKind } from "@codeintel/core";
import type { ParsedTree, SyntaxNode } from "../parsers/parser.js";

export interface ExtractedSymbol {
  node: GraphNode;
  callSites: CallSite[];
}

export interface CallSite {
  callerNodeId: string;
  calleeName: string;
  line: number;
  isQualified: boolean;
  qualifier?: string;
}

/**
 * Extracts symbol nodes and call sites from a parsed syntax tree.
 */
export function extractSymbols(
  tree: ParsedTree,
  filePath: string
): ExtractedSymbol[] {
  const results: ExtractedSymbol[] = [];
  const langId = tree.language.id;
  const queries = tree.language.nodeQueries;

  visitNode(tree.rootNode, null);

  function visitNode(node: SyntaxNode, parentSymbol: ExtractedSymbol | null): void {
    const extracted = tryExtract(node, parentSymbol);
    const currentSymbol = extracted ?? parentSymbol;

    for (const child of node.namedChildren) {
      visitNode(child, currentSymbol);
    }

    // Extract call sites for the current function/method
    if (extracted) {
      extractCallSites(node, extracted);
    }
  }

  function tryExtract(
    node: SyntaxNode,
    parentSymbol: ExtractedSymbol | null
  ): ExtractedSymbol | null {
    const kind = mapNodeKind(node.type, langId, parentSymbol);
    if (!kind) return null;

    const name = extractName(node, langId);
    if (!name) return null;

    const nodeId = makeNodeId(filePath, name, kind, node.startPosition.row);
    const contentHash = createHash("sha256").update(node.text).digest("hex");
    const signature = extractSignature(node, langId);
    const docstring = extractDocstring(node);
    const exported = isExported(node, langId);

    const symbol: ExtractedSymbol = {
      node: {
        id: nodeId,
        kind,
        name,
        filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        contentHash,
        language: langId,
        signature: signature ?? undefined,
        docstring: docstring ?? undefined,
        exported,
        lastIndexed: Date.now(),
      },
      callSites: [],
    };

    results.push(symbol);
    return symbol;
  }

  function extractCallSites(scope: SyntaxNode, symbol: ExtractedSymbol): void {
    const callNodes = scope.descendantsOfType(["call_expression", "new_expression"]);
    for (const call of callNodes) {
      const callee = call.namedChildren[0];
      if (!callee) continue;

      let calleeName: string;
      let qualifier: string | undefined;
      let isQualified = false;

      if (callee.type === "member_expression" || callee.type === "attribute") {
        // foo.bar() or self.method()
        const obj = callee.namedChildren[0];
        const prop = callee.namedChildren[1];
        if (obj && prop) {
          qualifier = obj.text;
          calleeName = prop.text;
          isQualified = true;
        } else {
          calleeName = callee.text;
        }
      } else {
        calleeName = callee.text;
      }

      symbol.callSites.push({
        callerNodeId: symbol.node.id,
        calleeName,
        line: call.startPosition.row + 1,
        isQualified,
        qualifier,
      });
    }
  }

  return results;
}

function mapNodeKind(
  nodeType: string,
  langId: string,
  parent: ExtractedSymbol | null
): NodeKind | null {
  // Map tree-sitter node types to our NodeKind
  switch (nodeType) {
    case "function_declaration":
    case "function_definition":
    case "arrow_function":
    case "function":
      return "function";

    case "class_declaration":
    case "class_definition":
      return "class";

    case "method_definition":
    case "method_declaration":
    case "constructor_declaration":
      return "method";

    case "function_item":
      // Rust: fn inside impl block = method, otherwise function
      return parent?.node.kind === "class" ? "method" : "function";

    case "interface_declaration":
      return "interface";

    case "trait_item":
      return "interface";

    case "type_alias_declaration":
    case "type_item":
      return "type_alias";

    case "enum_declaration":
    case "enum_item":
      return "enum";

    case "variable_declarator":
    case "lexical_declaration":
    case "var_declaration":
    case "short_var_declaration":
    case "let_declaration":
    case "assignment":
    case "field_declaration":
    case "local_variable_declaration":
      return "variable";

    case "const_item":
    case "static_item":
    case "const_declaration":
      return "constant";

    case "type_declaration":
      // Go: could be interface or type alias — approximate as type_alias
      return "type_alias";

    default:
      return null;
  }
}

function extractName(node: SyntaxNode, langId: string): string | null {
  // Try the "name" field first (most languages)
  const nameNode = node.childForFieldName("name");
  if (nameNode) return nameNode.text;

  // For variable declarators, the first named child is often the name
  if (node.type === "variable_declarator") {
    const first = node.namedChildren[0];
    if (first && first.type === "identifier") return first.text;
  }

  // For assignments (Python), left side
  if (node.type === "assignment") {
    const left = node.namedChildren[0];
    if (left && left.type === "identifier") return left.text;
  }

  // Fallback: first identifier child
  for (const child of node.namedChildren) {
    if (child.type === "identifier" || child.type === "type_identifier") {
      return child.text;
    }
  }

  return null;
}

function extractSignature(node: SyntaxNode, langId: string): string | null {
  // Extract function/method signature (first line, up to the body)
  const text = node.text;
  const bodyStart = text.indexOf("{");
  const colonStart = text.indexOf(":");  // Python

  if (langId === "python") {
    const defLine = text.split("\n")[0];
    return defLine?.replace(/:$/, "").trim() ?? null;
  }

  if (bodyStart > 0) {
    return text.substring(0, bodyStart).trim();
  }

  // For single-line declarations
  const firstLine = text.split("\n")[0];
  return firstLine?.trim() ?? null;
}

function extractDocstring(node: SyntaxNode): string | null {
  // Check for JSDoc/docstring before the node
  const prev = node.previousSibling;
  if (prev && prev.type === "comment") {
    const text = prev.text;
    // JSDoc: /** ... */
    if (text.startsWith("/**")) {
      return text
        .replace(/^\/\*\*\s*/, "")
        .replace(/\s*\*\/$/, "")
        .replace(/^\s*\*\s?/gm, "")
        .trim();
    }
    // Line comment: // ...
    if (text.startsWith("//")) {
      return text.replace(/^\/\/\s?/, "").trim();
    }
  }

  // Python: first string expression in body
  if (node.type === "function_definition" || node.type === "class_definition") {
    const body = node.childForFieldName("body");
    if (body) {
      const first = body.namedChildren[0];
      if (first?.type === "expression_statement") {
        const str = first.namedChildren[0];
        if (str?.type === "string") {
          return str.text.replace(/^['"]{1,3}/, "").replace(/['"]{1,3}$/, "").trim();
        }
      }
    }
  }

  return null;
}

function isExported(node: SyntaxNode, langId: string): boolean {
  if (langId === "typescript" || langId === "javascript") {
    // Check if parent is export_statement
    const parent = node.parent;
    if (parent?.type === "export_statement") return true;
    // Check for "export" keyword in text
    if (node.text.startsWith("export ")) return true;
  }

  if (langId === "go" || langId === "rust" || langId === "java") {
    // Go: starts with uppercase
    const name = extractName(node, langId);
    if (langId === "go" && name) {
      return name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
    }
    // Rust: pub keyword
    if (langId === "rust") return node.text.trimStart().startsWith("pub ");
    // Java: public keyword
    if (langId === "java") return node.text.includes("public ");
  }

  if (langId === "python") {
    // Python: not starting with _
    const name = extractName(node, langId);
    return name ? !name.startsWith("_") : false;
  }

  return false;
}

function makeNodeId(filePath: string, name: string, kind: NodeKind, line: number): string {
  return `${filePath}::${kind}::${name}::${line}`;
}
