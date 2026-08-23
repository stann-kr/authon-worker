import path from "node:path";
import { fileURLToPath } from "node:url";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import ts from "typescript";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const tsconfigPath = path.join(projectRoot, "tsconfig.json");
const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

if (tsconfig.error) {
  throw new Error(ts.flattenDiagnosticMessageText(tsconfig.error.messageText, "\n"));
}

const parsedTsconfig = ts.parseJsonConfigFileContent(
  tsconfig.config,
  ts.sys,
  projectRoot,
);
const appPath = path.join(projectRoot, "app");
const apiTypesPath = path.join(projectRoot, "lib/api/types.ts");
const moduleResolutionHost = {
  ...ts.sys,
  fileExists(fileName) {
    return (
      path.resolve(fileName) === apiTypesPath || ts.sys.fileExists(fileName)
    );
  },
};
const moduleResolutionCache = ts.createModuleResolutionCache(
  projectRoot,
  (fileName) => fileName,
  parsedTsconfig.options,
);

function resolveModulePath(specifier, containingFile) {
  return ts.resolveModuleName(
    specifier,
    containingFile,
    parsedTsconfig.options,
    moduleResolutionHost,
    moduleResolutionCache,
  ).resolvedModule?.resolvedFileName;
}

function resolvesToApiTypes(specifier, containingFile) {
  const resolvedFileName = resolveModulePath(specifier, containingFile);

  return resolvedFileName
    ? path.resolve(resolvedFileName) === apiTypesPath
    : false;
}

function resolvesInsideApp(specifier, containingFile) {
  const resolvedFileName = resolveModulePath(specifier, containingFile);
  if (!resolvedFileName) return false;

  const relativePath = path.relative(appPath, path.resolve(resolvedFileName));
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function getModuleSpecifier(node) {
  if (!node) return null;
  if (typeof node.value === "string") return node.value;
  if (node.type === "TSLiteralType") {
    return getModuleSpecifier(node.literal);
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function createModuleSourceVisitors(checkModuleSource) {
  return {
    ImportDeclaration(node) {
      checkModuleSource(node, node.source);
    },
    ExportNamedDeclaration(node) {
      checkModuleSource(node, node.source);
    },
    ExportAllDeclaration(node) {
      checkModuleSource(node, node.source);
    },
    ImportExpression(node) {
      checkModuleSource(node, node.source);
    },
    TSImportType(node) {
      checkModuleSource(node, node.source ?? node.argument);
    },
    TSImportEqualsDeclaration(node) {
      const moduleReference = node.moduleReference;
      if (moduleReference.type === "TSExternalModuleReference") {
        checkModuleSource(node, moduleReference.expression);
      }
    },
    CallExpression(node) {
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "require"
      ) {
        checkModuleSource(node, node.arguments[0]);
      }
    },
  };
}

const capabilityBoundaryPlugin = {
  rules: {
    "no-api-types-facade": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          useCapabilityOwner:
            "Import public contracts from their capability owner instead of lib/api/types.",
        },
      },
      create(context) {
        function checkModuleSource(node, source) {
          const specifier = getModuleSpecifier(source);
          if (
            specifier &&
            resolvesToApiTypes(specifier, context.filename)
          ) {
            context.report({ node, messageId: "useCapabilityOwner" });
          }
        }

        return createModuleSourceVisitors(checkModuleSource);
      },
    },
    "no-app-imports-from-components": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          useNeutralOwner:
            "Shared components must not import from app routes. Move the dependency to a neutral owner.",
        },
      },
      create(context) {
        function checkModuleSource(node, source) {
          const specifier = getModuleSpecifier(source);
          if (specifier && resolvesInsideApp(specifier, context.filename)) {
            context.report({ node, messageId: "useNeutralOwner" });
          }
        }

        return createModuleSourceVisitors(checkModuleSource);
      },
    },
  },
};

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "worker-configuration.d.ts",
    ],
  },
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "authon-boundaries": capabilityBoundaryPlugin,
    },
    rules: {
      "authon-boundaries/no-api-types-facade": "error",
    },
  },
  {
    files: ["components/**/*.{ts,tsx}"],
    plugins: {
      "authon-boundaries": capabilityBoundaryPlugin,
    },
    rules: {
      "authon-boundaries/no-app-imports-from-components": "error",
    },
  },
];

export default eslintConfig;
