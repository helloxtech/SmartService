import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
    {
        ignores: [
            "**/dist/**",
            "**/node_modules/**",
            "**/worker-configuration.d.ts",
            "coverage/**",
            "docs/**",
            "需求/**",
        ],
    },
    eslint.configs.recommended,
    ...typescriptEslint.configs.strict,
    {
        files: ["**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2023,
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            "@stylistic": stylistic,
        },
        rules: {
            "@stylistic/brace-style": ["error", "allman", {
                allowSingleLine: false,
            }],
            "@stylistic/comma-dangle": ["error", "always-multiline"],
            "@stylistic/indent": ["error", 4, {
                SwitchCase: 1,
            }],
            "@stylistic/quotes": ["error", "double", {
                avoidEscape: true,
            }],
            "@stylistic/semi": ["error", "always"],
        },
    },
    {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
            ecmaVersion: 2023,
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.worker,
            },
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        plugins: {
            "@stylistic": stylistic,
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        rules: {
            ...reactHooks.configs.flat.recommended.rules,
            "@stylistic/brace-style": ["error", "allman", {
                allowSingleLine: false,
            }],
            "@stylistic/comma-dangle": ["error", "always-multiline"],
            "@stylistic/indent": ["error", 4, {
                SwitchCase: 1,
            }],
            "@stylistic/quotes": ["error", "double", {
                avoidEscape: true,
            }],
            "@stylistic/semi": ["error", "always"],
            "@typescript-eslint/consistent-type-imports": ["error", {
                fixStyle: "inline-type-imports",
            }],
            "@typescript-eslint/no-explicit-any": "error",
            "react-refresh/only-export-components": ["warn", {
                allowConstantExport: true,
            }],
        },
    },
    {
        files: ["**/*.config.ts", "tooling/**/*.ts"],
        rules: {
            "react-refresh/only-export-components": "off",
        },
    },
);
