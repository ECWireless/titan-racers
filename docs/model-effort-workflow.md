# Model Effort Workflow

Use this workflow to choose an appropriate Codex model-effort setting for each session and to recognize when the work has changed enough to justify switching settings.

## Capability Boundary

The agent may assess the work and recommend a model-effort setting, but it must not claim that it changed the active setting unless the current Codex environment provides and successfully uses an explicit control for doing so.

When the active setting is not visible to the agent, say that it is unknown rather than guessing. If a different setting would materially improve the work, explain why and ask the feature lead to make the change before continuing. Available effort levels and their behavior may vary by model and Codex surface.

## Session Start

During the phase debrief:

1. Identify the most demanding kind of work expected in the session.
2. Recommend the lowest effort level that is appropriate for that work.
3. Explain the recommendation when the choice is not obvious.
4. Confirm whether a setting change is needed before implementation begins.
5. Record the agreed choice in the session plan when it affects verification, scope, or review depth.

Do not delay work merely to discuss effort when the current setting is adequate and the task is low risk.

## Effort Guide

### Low

Use for mechanical, reversible, and precisely specified work, such as:

- small copy or formatting changes,
- obvious documentation updates,
- narrow configuration edits with known values,
- running established verification commands,
- simple file moves or renames.

### Medium

Use for normal scoped implementation where the requirements and technical direction are already agreed, such as:

- building a well-defined component or route,
- routine database queries or schema usage,
- adding tests for understood behavior,
- contained refactors with established patterns,
- debugging with a small, reproducible search space.

Medium is the default recommendation for ordinary phase implementation after the architecture and stack are approved.

### High

Use when the work requires substantial judgment, synthesis, or investigation, such as:

- product-goal and phase debriefs,
- architecture and data-model design,
- privacy, authentication, or security decisions,
- migrations or changes that are difficult to reverse,
- unfamiliar integrations,
- complex debugging across several systems,
- final review of a consequential phase.

### XHigh

Reserve for rare work with unusually high ambiguity, consequence, or cost of rework, such as:

- resolving several interacting architectural uncertainties,
- diagnosing an intermittent failure after normal investigation has stalled,
- reviewing a security-critical design with multiple trust boundaries,
- making a foundational decision that will constrain many later phases.

Do not recommend XHigh merely because a task is large. Break large but straightforward work into smaller tasks first. XHigh is model-dependent and may not be available in every Codex environment.

## When To Reassess

Reassess the recommendation when:

- the user changes the goal or materially expands the scope,
- a supposedly mechanical task exposes an architectural decision,
- debugging crosses multiple systems or repeated attempts fail,
- sensitive data, destructive operations, authentication, or security boundaries enter scope,
- the session moves from planning into implementation,
- the session moves from implementation into final review.

A change in task type does not always require a setting change. Recommend switching only when the current effort is materially mismatched to the next work.

## Switching Protocol

When recommending a switch:

1. Pause at a safe boundary.
2. State the current setting if it is known.
3. Name the recommended setting.
4. Give a one-sentence reason tied to risk or complexity.
5. Wait for the feature lead to change or confirm the setting when the switch is important.
6. Rebuild session context if changing the setting requires a new Codex session.

Never use a higher effort setting as a substitute for clarifying the product goal, reducing scope, or creating a testable plan.
