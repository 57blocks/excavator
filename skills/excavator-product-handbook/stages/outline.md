## Phase 6e: The outline

Write what you tell the user during this phase in `$LANGUAGE`, as **Language** in Phase 0 says.

The outline decides how the handbook is laid out: which parts and chapters there are, in what order, and what each is called. It runs after Phase 6d (after Phase 6c and Phase 6b when those did not run, and after the written sections when none of them is selected) and before Phase 7. It needs the map and nothing else; it reads no code, and it dispatches no subagent: you write it yourself, in one file, from the blocks the script lists. The outline never removes or edits content: a block's content is computed from the entries and the facts of the run, and each block is shown the same way wherever you put it. The outline only places blocks, and `check-outline` holds you to placing every one of them.

1. List the blocks:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" outline-facts "$OUT" --project "$PROJECT_ROOT"
   ```
   - Exit 1: tell the user the lines it printed, as they are, and stop.
   - Exit 2: the command could not run. Show its message and stop.
   - Exit 0: one line per block, tab separated: the id, `block` or `list`, `technical` (only the technical view has it) or `both`, and the block's default title in the fixed text of this run. A `list` block is not one page: it expands into one page for each entity (the business domains, the applications, the external systems). Read the default titles for what each block holds. When you need to know what a block holds in this run, read the verified entries and `$OUT/map.json` as you have already read them; open no source file for it.
2. Write `$OUT/outline.json`:
   ```json
   {
     "format": "excavator-product-handbook-outline/1",
     "language": "<$RUN_LANGUAGE>",
     "parts": [
       {"title": "<the part, in the reader's words>", "chapters": [
         {"title": "<the chapter, in the reader's words>", "block": "<a block id>"},
         {"title": "<the chapter, in the reader's words>", "list": "<a list id>"}
       ]}
     ],
     "unplaced": [{"block": "<a block id>", "reason": "<why this block is not in the handbook>"}]
   }
   ```
   - Group the blocks into parts, and name parts and chapters, the way the readers of this project think of it: use the words of the project's own menus, screens and documents that you have already read, and never a name taken from these instructions or from another project.
   - Write every part title, chapter title and reason in `$LANGUAGE`, under the reader-text rules of Phase 3: no code-shaped word, and no number the source does not hold. The `language` is the map's language.
   - Put what a reader asks first at the front: what the product is, what it is for and how work moves through it, then the people and what they may do, then each business area, then the cross-cutting pages. Put the technical blocks (the ones marked `technical`) after them, together. Put the findings, the recommendations, the open questions, the glossary and the sources of the run last.
   - One block goes in one chapter, and a chapter holds exactly one block, written as `block`, or one list, written as `list`. A list is written as `list` and a block as `block`, never the other way. A part holds at least one chapter. A block that only the technical view has is placed like any other: the product view leaves it out by itself, and a part that then has no chapter is left out with it.
   - Every block id from the listing is in the outline exactly once: in a chapter or in `unplaced`. A block with nothing in it in this run still has to be placed or listed; where the run has nothing to write for a block, the handbook leaves its chapter out and the coverage section says why.
   - A block may go to `unplaced` only with a reason that is true and that a reader could check: say what the block holds in this run and why it does not belong in this handbook. Do not use `unplaced` to make the handbook shorter, to avoid naming a chapter, or for a block that holds something. The coverage section of the handbook and the coverage page list each block you leave out with your reason.
   - The coverage section is not a block: it is always last, and nothing you write moves it.
3. Check it:
   ```bash
   node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check-outline "$OUT" --project "$PROJECT_ROOT"
   ```
   - Exit 0: it prints `outline ok: ...`; tell the user the parts, one line each: the title and its chapters' titles; go to Phase 7.
   - Exit 1: it prints, one per line, every block that is not placed, placed twice or not a block, every list written as a block and every block written as a list, every part without a chapter, every code-shaped word, number or language problem in a title or a reason, every empty reason and a language that is not the map's. Fix `outline.json` for each line it prints and run it again, until it exits 0. Fix the cause, never the check: do not move a block to `unplaced` to make its line go away. When the third run still exits 1, tell the user the lines it printed, as printed, and go to Phase 7 with the file as it is: the handbook then uses the default order under the default names and says so, with those lines, in its coverage section.
   - Exit 2: show its message and stop.

   A run with no `outline.json`, or with one that does not pass, still assembles: Phase 7 writes the handbook in the default order under the fixed names and says so in its coverage section. An outline can be written again after the handbook was assembled, and Phase 7 run again, without repeating any other phase.

---
