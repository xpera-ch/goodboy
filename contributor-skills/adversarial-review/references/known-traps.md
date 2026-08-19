# Known Traps

Specific mistakes this review discipline has already caught once. Read this
before writing probes so the same mistake isn't re-learned a second time.

This file deliberately stays inside the skill rather than becoming a
separate registry entry. A design allowing project-specific trap files to
bind in dynamically ("slots," resolved at install time via custom
frontmatter syntax) was considered and abandoned — it breaks Agent Skills
standard compatibility and added authoring complexity for no proven need.
If project-specific traps ever earn their place, the fallback is simplest
possible: a project's own `SKILL.md` body says "also consult any
project-traps skill deployed alongside this one" — no new machinery.

## Prototype pollution: build payloads via `JSON.parse`, never object literals

`JSON.parse('{"__proto__": {...}}')` creates `__proto__` as a genuine *own
property* on the parsed object. An object literal written directly in test
code — `{ __proto__: {...} }` — does the opposite: it invokes the
`__proto__` accessor as a prototype-*setter*, so the key never becomes an
own property at all.

A probe written with an object literal will silently pass even against
vulnerable code, because the "attack" never actually constructs the
adversarial shape it's supposed to simulate. Always build the probe payload
as a JSON *string* and parse it:

```js
const payload = JSON.parse('{"__proto__": {"polluted": true}}');
```

never:

```js
const payload = { __proto__: { polluted: true } }; // WRONG — sets the prototype, doesn't add an own key
```

This exact mistake was made once, caught, disclosed, and then correctly
avoided in the next review only because it was written explicitly into the
review prompt. It must not be re-learned a third time — this is why it lives
here instead of only in one reviewer's memory.

## Coverage-ignore comments: verify the format is actually honored

A multi-line-style ignore comment silently failed to suppress coverage
reporting on the intended lines in at least one past case — the tool didn't
error, it just didn't apply the exemption, and the gap wasn't caught until an
adversarial review specifically audited each ignore comment individually
rather than trusting that "coverage is 100%" implies every ignore is doing
what it looks like it's doing.

When auditing coverage-ignore annotations: don't just check that the overall
number is 100%. Open each ignored block, confirm the exact comment syntax
the tool expects, and confirm the specific lines it's meant to cover are the
ones actually excluded — not silently still counted as covered by something
else, and not silently uncovered-but-passing due to a threshold rounding.
