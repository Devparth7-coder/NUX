# NEXUS Feature Specification

## Command Center
A single large input accepts an objective. Submitting it starts the execution pipeline, not a chat response. The interface surfaces recent intent, suggested actions, active runs, projects and memory context.

## Intent Engine
Natural language is converted into a structured intent containing objective, desired outcome, entities, constraints, deadline, project context, required capabilities, risk level and required permissions. Output is schema validated before it is used.

## Agent System
Seven agents are registered: planning, research, knowledge, execution, review, creative and analyst. Each declares capabilities, allowed tools and a permission ceiling.

## Permission and approvals
Permission levels are READ, WRITE, EXTERNAL_ACTION and HIGH_IMPACT. Write actions and everything above require approval. High-impact actions always require approval. Approval records capture what will happen, why it is needed, which tool runs and what data is affected.

## Memory
Memory has four layers: short term, project, long term and explicit. Memories carry confidence, importance, scope and lifecycle metadata, and users can edit, disable or delete them.

## Workflows
Workflows are saved graphs of triggers, agents, tools, conditions, approvals, delays, branches and loops. They are versioned, validated and observable, and they reuse the same agent and tool registries as the intent pipeline.