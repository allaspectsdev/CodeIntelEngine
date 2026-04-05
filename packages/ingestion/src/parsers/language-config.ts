export interface LanguageConfig {
  id: string;
  name: string;
  extensions: string[];
  treeSitterPackage: string;
  nodeQueries: NodeQuerySet;
}

export interface NodeQuerySet {
  functions: string[];
  classes: string[];
  methods: string[];
  interfaces: string[];
  typeAliases: string[];
  variables: string[];
  constants: string[];
  enums: string[];
  imports: string[];
  exports: string[];
}

export const LANGUAGES: LanguageConfig[] = [
  {
    id: "typescript",
    name: "TypeScript",
    extensions: [".ts", ".tsx"],
    treeSitterPackage: "tree-sitter-typescript",
    nodeQueries: {
      functions: ["function_declaration", "arrow_function", "function"],
      classes: ["class_declaration"],
      methods: ["method_definition"],
      interfaces: ["interface_declaration"],
      typeAliases: ["type_alias_declaration"],
      variables: ["variable_declarator", "lexical_declaration"],
      constants: ["variable_declarator"],
      enums: ["enum_declaration"],
      imports: ["import_statement", "import_declaration"],
      exports: ["export_statement", "export_declaration"],
    },
  },
  {
    id: "javascript",
    name: "JavaScript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    treeSitterPackage: "tree-sitter-javascript",
    nodeQueries: {
      functions: ["function_declaration", "arrow_function", "function"],
      classes: ["class_declaration"],
      methods: ["method_definition"],
      interfaces: [],
      typeAliases: [],
      variables: ["variable_declarator", "lexical_declaration"],
      constants: ["variable_declarator"],
      enums: [],
      imports: ["import_statement"],
      exports: ["export_statement"],
    },
  },
  {
    id: "python",
    name: "Python",
    extensions: [".py", ".pyi"],
    treeSitterPackage: "tree-sitter-python",
    nodeQueries: {
      functions: ["function_definition"],
      classes: ["class_definition"],
      methods: ["function_definition"],   // context-dependent: inside class
      interfaces: [],
      typeAliases: [],
      variables: ["assignment", "augmented_assignment"],
      constants: ["assignment"],
      enums: ["class_definition"],        // enum.Enum subclasses
      imports: ["import_statement", "import_from_statement"],
      exports: [],
    },
  },
  {
    id: "go",
    name: "Go",
    extensions: [".go"],
    treeSitterPackage: "tree-sitter-go",
    nodeQueries: {
      functions: ["function_declaration"],
      classes: [],
      methods: ["method_declaration"],
      interfaces: ["type_declaration"],
      typeAliases: ["type_declaration"],
      variables: ["var_declaration", "short_var_declaration"],
      constants: ["const_declaration"],
      enums: [],
      imports: ["import_declaration"],
      exports: [],
    },
  },
  {
    id: "rust",
    name: "Rust",
    extensions: [".rs"],
    treeSitterPackage: "tree-sitter-rust",
    nodeQueries: {
      functions: ["function_item"],
      classes: [],
      methods: ["function_item"],   // inside impl block
      interfaces: ["trait_item"],
      typeAliases: ["type_item"],
      variables: ["let_declaration"],
      constants: ["const_item", "static_item"],
      enums: ["enum_item"],
      imports: ["use_declaration"],
      exports: [],
    },
  },
  {
    id: "java",
    name: "Java",
    extensions: [".java"],
    treeSitterPackage: "tree-sitter-java",
    nodeQueries: {
      functions: [],
      classes: ["class_declaration"],
      methods: ["method_declaration", "constructor_declaration"],
      interfaces: ["interface_declaration"],
      typeAliases: [],
      variables: ["field_declaration", "local_variable_declaration"],
      constants: ["field_declaration"],
      enums: ["enum_declaration"],
      imports: ["import_declaration"],
      exports: [],
    },
  },
];

const extensionMap = new Map<string, LanguageConfig>();
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) {
    extensionMap.set(ext, lang);
  }
}

export function getLanguageForFile(filePath: string): LanguageConfig | null {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  return extensionMap.get(ext) ?? null;
}

export function getSupportedExtensions(): string[] {
  return LANGUAGES.flatMap((l) => l.extensions);
}
