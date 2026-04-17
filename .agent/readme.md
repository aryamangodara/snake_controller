# .agent Directory
This directory contains configuration, domain knowledge, and standard operating procedures for the AI agent assisting with the `snake-game-firebase` project.

## Structure Overview

- `/skills`: AI agent custom tools and domain knowledge related to this codebase (e.g. Firebase configurations, Vanilla JS patterns).
- `/workflows`: Automation scripts and slash commands.
- `/system`: Architectural truth, DB schemas, and how things are wired together.
- `/tasks`: Implementation plans and PRDs.
- `/SOPs`: Standard Operating Procedures for repeating tasks like deployments and CSS formatting.
- `mcp_config.json`: External tool hookups if available locally.

## Purpose

The files herein help the AI agent remember context across sessions without needing extensive prompts. This is the "semantic index" to the project, keeping the agent aligned with the user's workflow and architectural rules.
