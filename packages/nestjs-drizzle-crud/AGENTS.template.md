<!--
  nestjs-drizzle-crud - AI agent rules for apps that consume the package.

  Copy this file to your project root under whatever filename your agent reads:

      cp node_modules/nestjs-drizzle-crud/AGENTS.template.md ./AGENTS.md

  Most tools read AGENTS.md (OpenAI Codex, Cursor, GitHub Copilot, Zed, Cline,
  Windsurf, Jules). Tools with their own filename:

      Claude Code   ./CLAUDE.md
      Gemini CLI    ./GEMINI.md
      Aider         ./CONVENTIONS.md, then `aider --read CONVENTIONS.md`

  You can copy this file to several of those names, or keep one and have the
  others point at it with a single line.

  The line below loads the full guide that ships inside the package, so AGENT.md
  stays the single source of truth and you never duplicate the rules. If your
  agent does not resolve `@` imports, delete it and paste the contents of
  node_modules/nestjs-drizzle-crud/AGENT.md here instead, or run the package's
  MCP server (see "MCP" in the README) so the agent can read the docs on demand.
-->

@node_modules/nestjs-drizzle-crud/AGENT.md

<!--
  Fallback for agents that ignore the line above: read
  node_modules/nestjs-drizzle-crud/AGENT.md before writing any code that uses
  this package, and follow it.
-->
