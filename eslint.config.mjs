// Lints the frontend for the one rule we hold it to strictly: no raw HTML.
// React escapes everything it renders, which is what replaced the old
// escapeHtml() (bugs/Closed/BUG-004); dangerouslySetInnerHTML would undo that.
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";

export default [
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { react },
    rules: { "react/no-danger": "error" },
  },
];
