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
      // Dynamic import to handle native module loading
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

      // Dynamic import of language grammar — this is synchronous for native tree-sitter
      // In practice, these packages must be installed
      let grammar: unknown;
      try {
        // Node.js require for native modules
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
 * Provides basic symbol extraction without full AST support.
 */
export class RegexParser implements ParserBackend {
  parse(sourceText: string, filePath: string): ParsedTree | null {
    const language = getLanguageForFile(filePath);
    if (!language) return null;

    // Build a pseudo-AST from regex matches
    const rootNode = this.buildPseudoAST(sourceText, language);
    return { rootNode, language, sourceText };
  }

  private buildPseudoAST(source: string, language: LanguageConfig): SyntaxNode {
    const lines = source.split("\n");
    const children: SyntaxNode[] = [];

    const patterns = this.getPatternsForLanguage(language.id);
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(pattern.regex, "gm");
      while ((match = regex.exec(source)) !== null) {
        const startOffset = match.index;
        const lineNum = source.substring(0, startOffset).split("\n").length - 1;
        const endLineNum = lineNum + (match[0].split("\n").length - 1);

        children.push(
          this.makePseudoNode(pattern.type, match[0], match[1] ?? match[0], lineNum, endLineNum)
        );
      }
    }

    return this.makePseudoNode("program", source, "program", 0, lines.length - 1, children);
  }

  private getPatternsForLanguage(langId: string): Array<{ type: string; regex: string }> {
    switch (langId) {
      case "typescript":
      case "javascript":
        return [
          { type: "function_declaration", regex: "(?:export\\s+)?(?:async\\s+)?function\\s+(\\w+)" },
          { type: "class_declaration", regex: "(?:export\\s+)?class\\s+(\\w+)" },
          { type: "method_definition", regex: "(?:async\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*\\{" },
          { type: "interface_declaration", regex: "(?:export\\s+)?interface\\s+(\\w+)" },
          { type: "type_alias_declaration", regex: "(?:export\\s+)?type\\s+(\\w+)\\s*=" },
          { type: "import_statement", regex: "import\\s+.*?from\\s+['\"]([^'\"]+)['\"]" },
          { type: "export_statement", regex: "export\\s+(?:default\\s+)?(\\w+)" },
        ];
      case "python":
        return [
          { type: "function_definition", regex: "(?:async\\s+)?def\\s+(\\w+)" },
          { type: "class_definition", regex: "class\\s+(\\w+)" },
          { type: "import_statement", regex: "import\\s+(\\w+)" },
          { type: "import_from_statement", regex: "from\\s+(\\S+)\\s+import" },
        ];
      case "go":
        return [
          { type: "function_declaration", regex: "func\\s+(\\w+)" },
          { type: "method_declaration", regex: "func\\s+\\([^)]+\\)\\s+(\\w+)" },
          { type: "type_declaration", regex: "type\\s+(\\w+)\\s+" },
          { type: "import_declaration", regex: "import\\s+[\"(]" },
        ];
      case "rust":
        return [
          { type: "function_item", regex: "(?:pub\\s+)?fn\\s+(\\w+)" },
          { type: "struct_item", regex: "(?:pub\\s+)?struct\\s+(\\w+)" },
          { type: "trait_item", regex: "(?:pub\\s+)?trait\\s+(\\w+)" },
          { type: "enum_item", regex: "(?:pub\\s+)?enum\\s+(\\w+)" },
          { type: "use_declaration", regex: "use\\s+(\\S+);" },
        ];
      case "java":
        return [
          { type: "class_declaration", regex: "(?:public|private|protected)?\\s*class\\s+(\\w+)" },
          { type: "method_declaration", regex: "(?:public|private|protected)?\\s*(?:static\\s+)?\\w+\\s+(\\w+)\\s*\\(" },
          { type: "interface_declaration", regex: "(?:public\\s+)?interface\\s+(\\w+)" },
          { type: "import_declaration", regex: "import\\s+(\\S+);" },
        ];
      default:
        return [];
    }
  }

  private makePseudoNode(
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
        return children.filter((c) => types.includes(c.type));
      },
    };
    // Set parent references
    for (const child of children) {
      (child as { parent: SyntaxNode | null }).parent = node;
    }
    return node;
  }
}
