import { getLanguageForFile, type LanguageConfig } from "./language-config.js";

// Tree-sitter types — we keep these loose to avoid hard coupling to the
// native module at compile time (tree-sitter uses native bindings that
// can be problematic in monorepo builds).

export interface ParsedTree {
  rootNode: SyntaxNode;
  language: LanguageConfig;
  sourceText: string;
}

export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
  parent: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
  descendantsOfType(type: string | string[]): SyntaxNode[];
}

// Parser cache: one parser per language
const parserCache = new Map<string, unknown>();

export interface ParserBackend {
  parse(sourceText: string, filePath: string): ParsedTree | null;
}

/**
 * Tree-sitter-backed parser. Lazily loads language grammars on first use.
 */
export class TreeSitterParser implements ParserBackend {
  private TreeSitter: unknown = null;

  async ensureLoaded(): Promise<void> {
    if (this.TreeSitter) return;
    try {
      const mod = await import("tree-sitter");
      this.TreeSitter = mod.default ?? mod;
    } catch {
      throw new Error(
        "tree-sitter is not installed. Run: npm install tree-sitter"
      );
    }
  }

  parse(sourceText: string, filePath: string): ParsedTree | null {
    const language = getLanguageForFile(filePath);
    if (!language) return null;

    const parser = this.getOrCreateParser(language);
    if (!parser) return null;

    const tree = (parser as { parse(src: string): { rootNode: SyntaxNode } }).parse(sourceText);
    return {
      rootNode: tree.rootNode,
      language,
      sourceText,
    };
  }

  private getOrCreateParser(lang: LanguageConfig): unknown {
    if (parserCache.has(lang.id)) {
      return parserCache.get(lang.id);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const TS = this.TreeSitter as any;
      const parser = new TS();

      let grammar: unknown;
      try {
        const req = typeof require !== "undefined" ? require : undefined;
        if (lang.id === "typescript") {
          grammar = req?.(lang.treeSitterPackage)?.typescript ?? req?.(lang.treeSitterPackage);
        } else {
          grammar = req?.(lang.treeSitterPackage);
        }
      } catch {
        return null;
      }

      parser.setLanguage(grammar);
      parserCache.set(lang.id, parser);
      return parser;
    } catch {
      return null;
    }
  }
}

/**
 * Regex-based fallback parser for when tree-sitter isn't available.
 *
 * Produces a pseudo-AST that includes:
 * - Symbol declarations (functions, classes, methods, etc.)
 * - Import statements
 * - Call expression nodes inside function bodies
 *
 * descendantsOfType searches the full subtree recursively, so call
 * extraction works the same as with tree-sitter nodes.
 */
export class RegexParser implements ParserBackend {
  parse(sourceText: string, filePath: string): ParsedTree | null {
    const language = getLanguageForFile(filePath);
    if (!language) return null;

    const rootNode = this.buildPseudoAST(sourceText, language);
    return { rootNode, language, sourceText };
  }

  private buildPseudoAST(source: string, language: LanguageConfig): SyntaxNode {
    const lines = source.split("\n");
    const children: SyntaxNode[] = [];

    // Phase 1: Extract symbol declarations
    const symbolPatterns = this.getSymbolPatterns(language.id);
    const symbolNodes: Array<{ node: SyntaxNode; startOffset: number; endOffset: number }> = [];

    for (const pattern of symbolPatterns) {
      const regex = new RegExp(pattern.regex, "gm");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        const startOffset = match.index;
        const lineNum = source.substring(0, startOffset).split("\n").length - 1;

        // Estimate the body extent for functions/methods/classes
        const bodyEnd = this.findBodyEnd(source, startOffset, language.id);
        const bodyText = source.substring(startOffset, bodyEnd);
        const endLineNum = lineNum + bodyText.split("\n").length - 1;

        const symbolNode = makePseudoNode(
          pattern.type, bodyText, match[1] ?? match[0], lineNum, endLineNum
        );

        // Phase 2: Extract call expressions inside this symbol's body
        const callChildren = this.extractCallNodes(bodyText, lineNum, language.id);
        if (callChildren.length > 0) {
          symbolNode.children = callChildren;
          symbolNode.namedChildren = callChildren;
          for (const child of callChildren) {
            (child as { parent: SyntaxNode | null }).parent = symbolNode;
          }
        }

        children.push(symbolNode);
        symbolNodes.push({ node: symbolNode, startOffset, endOffset: bodyEnd });
      }
    }

    // Phase 3: Extract import statements (no call extraction needed)
    const importPatterns = this.getImportPatterns(language.id);
    for (const pattern of importPatterns) {
      const regex = new RegExp(pattern.regex, "gm");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        const startOffset = match.index;
        const lineNum = source.substring(0, startOffset).split("\n").length - 1;
        const endLineNum = lineNum + (match[0].split("\n").length - 1);
        children.push(
          makePseudoNode(pattern.type, match[0], match[1] ?? match[0], lineNum, endLineNum)
        );
      }
    }

    return makePseudoNode("program", source, "program", 0, lines.length - 1, children);
  }

  /**
   * Extract function call pseudo-nodes from a body of source text.
   * Produces call_expression nodes with a callee child, matching the
   * structure that extractCallSites expects.
   */
  private extractCallNodes(bodyText: string, baseLineNum: number, langId: string): SyntaxNode[] {
    const calls: SyntaxNode[] = [];
    const callPatterns = this.getCallPatterns(langId);

    for (const pattern of callPatterns) {
      const regex = new RegExp(pattern, "gm");
      let match: RegExpExecArray | null;
      while ((match = regex.exec(bodyText)) !== null) {
        const callText = match[0];
        const calleeFull = match[1]; // the full callee expression (e.g., "foo" or "obj.method")
        if (!calleeFull) continue;

        const lineOffset = bodyText.substring(0, match.index).split("\n").length - 1;
        const callLine = baseLineNum + lineOffset;

        // Build the callee child node — distinguish qualified (a.b) from simple (a)
        const dotIndex = calleeFull.lastIndexOf(".");
        let calleeNode: SyntaxNode;

        if (dotIndex > 0) {
          // Qualified call: obj.method(...)
          const objText = calleeFull.substring(0, dotIndex);
          const propText = calleeFull.substring(dotIndex + 1);
          const objNode = makePseudoNode("identifier", objText, objText, callLine, callLine);
          const propNode = makePseudoNode("identifier", propText, propText, callLine, callLine);
          calleeNode = makePseudoNode(
            "member_expression", calleeFull, calleeFull, callLine, callLine, [objNode, propNode]
          );
        } else {
          // Simple call: func(...)
          calleeNode = makePseudoNode("identifier", calleeFull, calleeFull, callLine, callLine);
        }

        const callNode = makePseudoNode(
          "call_expression", callText, calleeFull, callLine, callLine, [calleeNode]
        );
        calls.push(callNode);
      }
    }

    return calls;
  }

  /**
   * Estimate the end of a function/class body by counting braces or indentation.
   */
  private findBodyEnd(source: string, startOffset: number, langId: string): number {
    if (langId === "python") {
      // Python: find the next line at the same or lower indentation level
      const lineStart = source.lastIndexOf("\n", startOffset) + 1;
      const firstLine = source.substring(lineStart, source.indexOf("\n", startOffset));
      const baseIndent = firstLine.match(/^(\s*)/)?.[1].length ?? 0;

      let pos = source.indexOf("\n", startOffset);
      while (pos !== -1 && pos < source.length) {
        const nextNewline = source.indexOf("\n", pos + 1);
        const nextLine = source.substring(pos + 1, nextNewline === -1 ? source.length : nextNewline);
        if (nextLine.trim().length > 0) {
          const indent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
          if (indent <= baseIndent && !nextLine.trim().startsWith("#")) {
            return pos;
          }
        }
        pos = nextNewline;
      }
      return source.length;
    }

    // Brace-based languages: count matching braces
    const braceStart = source.indexOf("{", startOffset);
    if (braceStart === -1) {
      // No braces — return to end of line (e.g., variable declaration)
      const eol = source.indexOf("\n", startOffset);
      return eol === -1 ? source.length : eol;
    }

    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return source.length;
  }

  private getCallPatterns(langId: string): string[] {
    switch (langId) {
      case "typescript":
      case "javascript":
        // Match: identifier(...), obj.method(...), new Constructor(...)
        // Capture group 1 = the callee expression
        return [
          "(?:new\\s+)?((?:[a-zA-Z_$][\\w$]*\\.)*[a-zA-Z_$][\\w$]*)\\s*\\(",
        ];
      case "python":
        return [
          "((?:[a-zA-Z_][\\w]*\\.)*[a-zA-Z_][\\w]*)\\s*\\(",
        ];
      case "go":
        return [
          "((?:[a-zA-Z_][\\w]*\\.)*[a-zA-Z_][\\w]*)\\s*\\(",
        ];
      case "rust":
        return [
          "((?:[a-zA-Z_][\\w]*(?:::|\\.)?)*[a-zA-Z_][\\w]*)\\s*\\(",
        ];
      case "java":
        return [
          "(?:new\\s+)?((?:[a-zA-Z_][\\w]*\\.)*[a-zA-Z_][\\w]*)\\s*\\(",
        ];
      default:
        return ["((?:[a-zA-Z_][\\w]*\\.)*[a-zA-Z_][\\w]*)\\s*\\("];
    }
  }

  private getSymbolPatterns(langId: string): Array<{ type: string; regex: string }> {
    switch (langId) {
      case "typescript":
      case "javascript":
        return [
          { type: "function_declaration", regex: "(?:export\\s+)?(?:async\\s+)?function\\s+(\\w+)" },
          { type: "class_declaration", regex: "(?:export\\s+)?class\\s+(\\w+)" },
          { type: "method_definition", regex: "(?:async\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*\\{" },
          { type: "interface_declaration", regex: "(?:export\\s+)?interface\\s+(\\w+)" },
          { type: "type_alias_declaration", regex: "(?:export\\s+)?type\\s+(\\w+)\\s*=" },
        ];
      case "python":
        return [
          { type: "function_definition", regex: "(?:async\\s+)?def\\s+(\\w+)" },
          { type: "class_definition", regex: "class\\s+(\\w+)" },
        ];
      case "go":
        return [
          { type: "function_declaration", regex: "func\\s+(\\w+)" },
          { type: "method_declaration", regex: "func\\s+\\([^)]+\\)\\s+(\\w+)" },
          { type: "type_declaration", regex: "type\\s+(\\w+)\\s+" },
        ];
      case "rust":
        return [
          { type: "function_item", regex: "(?:pub\\s+)?fn\\s+(\\w+)" },
          { type: "struct_item", regex: "(?:pub\\s+)?struct\\s+(\\w+)" },
          { type: "trait_item", regex: "(?:pub\\s+)?trait\\s+(\\w+)" },
          { type: "enum_item", regex: "(?:pub\\s+)?enum\\s+(\\w+)" },
        ];
      case "java":
        return [
          { type: "class_declaration", regex: "(?:public|private|protected)?\\s*class\\s+(\\w+)" },
          { type: "method_declaration", regex: "(?:public|private|protected)?\\s*(?:static\\s+)?\\w+\\s+(\\w+)\\s*\\(" },
          { type: "interface_declaration", regex: "(?:public\\s+)?interface\\s+(\\w+)" },
        ];
      default:
        return [];
    }
  }

  private getImportPatterns(langId: string): Array<{ type: string; regex: string }> {
    switch (langId) {
      case "typescript":
      case "javascript":
        return [
          { type: "import_statement", regex: "import\\s+.*?from\\s+['\"]([^'\"]+)['\"]" },
          { type: "export_statement", regex: "export\\s+(?:default\\s+)?(\\w+)" },
        ];
      case "python":
        return [
          { type: "import_statement", regex: "import\\s+(\\w+)" },
          { type: "import_from_statement", regex: "from\\s+(\\S+)\\s+import" },
        ];
      case "go":
        return [{ type: "import_declaration", regex: "import\\s+[\"(]" }];
      case "rust":
        return [{ type: "use_declaration", regex: "use\\s+(\\S+);" }];
      case "java":
        return [{ type: "import_declaration", regex: "import\\s+(\\S+);" }];
      default:
        return [];
    }
  }
}

/**
 * Create a pseudo-AST node. descendantsOfType searches the full subtree
 * recursively, so it works correctly for extractCallSites and other
 * consumers that expect tree-sitter-like traversal.
 */
function makePseudoNode(
  type: string, text: string, name: string,
  startRow: number, endRow: number, children: SyntaxNode[] = []
): SyntaxNode {
  const node: SyntaxNode = {
    type,
    text,
    startPosition: { row: startRow, column: 0 },
    endPosition: { row: endRow, column: 0 },
    children,
    namedChildren: children,
    parent: null,
    nextSibling: null,
    previousSibling: null,
    childForFieldName: () => null,
    descendantsOfType: (t: string | string[]) => {
      const types = Array.isArray(t) ? t : [t];
      const results: SyntaxNode[] = [];
      const stack = [...children];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (types.includes(current.type)) {
          results.push(current);
        }
        // Recurse into children
        for (let i = current.children.length - 1; i >= 0; i--) {
          stack.push(current.children[i]);
        }
      }
      return results;
    },
  };
  for (const child of children) {
    (child as { parent: SyntaxNode | null }).parent = node;
  }
  return node;
}
