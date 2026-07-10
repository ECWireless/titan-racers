# Titan Racers Skills Tree

This directory is a progressively disclosed tree of reusable knowledge for agents working on Titan Racers. Start here, identify the branches relevant to the current task, and read only as deeply as the work requires.

## Capability Boundary

This is project knowledge, not a collection of installable Codex skills. Files in this tree use `README.md`; do not add `SKILL.md` files unless the repository deliberately adopts an executable Codex skill package in a separately reviewed change.

The Skills Tree supplements the repository's source-of-truth documents. It does not redefine product scope, phase boundaries, acceptance criteria, or approved architecture. When guidance here conflicts with `IMPLEMENTATION_PLAN.md` or a narrower authoritative project document, stop and resolve the inconsistency before implementation continues.

Nested `AGENTS.md` files may link to relevant Skills Tree nodes and add concise instructions for a code subtree. They do not replace this tree's explanatory role or the repository workflow documents. Repository workflows are read first; applicable scoped agent guides and their linked knowledge follow before local edits begin.

## Top-Level Branches

- [`game-concepts/`](game-concepts/README.md): engine-independent, best-supported standards for how game capabilities should behave and be validated.
- [`tools/`](tools/README.md): tool-, engine-, library-, and platform-specific capabilities, constraints, and working methods.
- [`project-systems/`](project-systems/README.md): how Titan Racers currently combines concepts and tools in its implemented systems.

## Navigation

At the beginning of a session:

1. Read this root index.
2. Use the phase or task scope to identify relevant top-level branches.
3. Follow their child indexes only while they remain relevant to the work.
4. Read linked concept, tool, and project-system nodes together when a task crosses those boundaries.
5. Do not load the entire tree by default.

The filesystem is a tree, but the knowledge is a graph. Use links between related nodes rather than duplicating guidance under multiple branches.

## Node Contract

Each knowledge node should explain:

- its purpose and scope,
- when an agent should read it,
- the guidance or system knowledge it owns,
- what it inherits from parent nodes,
- related nodes in other branches,
- relevant project files or external primary sources,
- known limitations or open questions,
- its maturity when the guidance is still evolving.

Use `exploratory`, `candidate`, or `validated` when a maturity label is helpful:

- **Exploratory:** under investigation and not yet a default.
- **Candidate:** supported enough to guide implementation, but still awaiting fuller project validation.
- **Validated:** demonstrated through accepted implementation, testing, or explicit review and treated as the current default.

## Growth Rules

- Use lowercase kebab-case directory names.
- Give every node a `README.md` that acts as both its summary and child index.
- Put guidance at the highest node where it remains accurate.
- Create a child node only when it has substantive knowledge to own.
- Keep engine-independent standards out of tool-specific branches.
- Keep tool API details and constraints out of concept branches.
- Keep Titan Racers implementation truth in project-system nodes and the source files they reference.
- Link to authoritative material instead of copying it.
- Update or deprecate stale guidance when implementation evidence changes.
- Add nested `AGENTS.md` files only at meaningful architectural boundaries with distinct local rules, not in every directory.
- Keep scoped agent guides concise: place required workflow files in a clearly labeled section near the top, then define responsibilities, invariants, required reading, change rules, verification, and stop conditions and link here for deeper knowledge.
