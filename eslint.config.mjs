import canvaPlugin from "@canva/app-eslint-plugin";

export default [
  {
    ignores: [
      "**/node_modules/",
      "**/dist",
      "**/*.d.ts",
      "**/*.d.tsx",
      "**/*.config.*",
    ],
  },
  ...canvaPlugin.configs.apps_no_i18n,
  {
    files: ["src/**/*"],
    ...canvaPlugin.configs.apps_i18n,
  },
];
