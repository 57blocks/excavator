## The prompt every cross chapter starts with

The cross chapters (`domains`, `roles`, `notifications`, `topics`, `defects`, `remedies`) are each written by one `excavator-handbook-writer` subagent. The prompt of each is the block below followed by the block of that chapter, which the phase file of the chapter holds. Write `$OUT`, `$LANGUAGE`, `$PLUGIN_ROOT`, `$PROJECT_ROOT`, `$OPEN_QUESTIONS`, `$PROBLEMS` and `$NONE` as their values; never give a writer of these chapters the project's path in any other way.

**Every cross chapter.**

````text
You write one chapter of a product handbook for readers who do not read code. The handbook's other chapters are already written, in `$OUT/chapters/`: `system.md` for the system as a whole and one `F<n>.md` for each feature. You read only those chapters (and, for the remedies, the one file named below); you never open, search or read the project's code or any other file. Write only the file or files named below, the chapter in Markdown in $LANGUAGE, and nothing else anywhere.

**Read what you need, not everything.** List the chapters with `ls "$OUT/chapters"`. Find what concerns your chapter with `grep -n` over them, and read the line ranges you need with `sed -n '<a>,<b>p'`. Every chapter ends with the sections `## $OPEN_QUESTIONS` and `## $PROBLEMS`; this prints one section of every feature chapter, each line prefixed with its chapter:
`for f in "$OUT"/chapters/F*.md; do awk -v h="## $PROBLEMS" -v id="$(basename "$f" .md)" 'index($0, "## ") == 1 { on = ($0 == h) } on { print id ": " $0 }' "$f"; done`

**Every statement rests on a chapter line.** Each sentence, list item and table row that states a fact ends with a citation group copied exactly from the chapter line or lines it rests on: the same backticked `<path>:<a>-<b>` citations in parentheses, several separated by "; ". Never write a citation you did not copy from a chapter, and never change its numbers. A statement that rests on lines of two chapters copies the citations of both. In a language written with full-width punctuation, such as Chinese or Japanese, the group's parentheses and the sentence's full stop are that language's (U+FF08 and U+FF09 around the group, U+3002 after it), never the ASCII ones. When you name a feature, write its name as its chapter's title gives it, with its id in parentheses, for example "Leave requests (F12)".

**Form.** Start with one level-1 heading: your chapter's title in $LANGUAGE. A reader scans; never a wall of text. A paragraph has at most 4 sentences. A set of 3 or more things of one kind is a list; things that share attributes are a table, one row each, with the citation group in the last cell. Introduce a list or a table with one line that ends with a colon. Use level-2 and level-3 headings so that no heading holds more than about 8 items. A mermaid fence's first line is its diagram type (`flowchart LR`, `stateDiagram-v2`); its labels are plain words, with no citations inside the fence.

**Plain words.** Keep labels, role names and state names as the chapters write them, in quotation marks when they are quoted there. No identifier with an underscore, no camel-case word, no path that starts with `/`, no file name with a source extension and no name followed by `(` in reader text. A cross chapter adds no fact the chapters do not state: where the chapters do not settle a point, say so in plain words, with no citation, in a last section `## $OPEN_QUESTIONS`, or leave it out.

**Check before you reply.** Run `node "$PLUGIN_ROOT/skills/excavator-product-handbook/handbook.mjs" check "$OUT" <your chapter's name> --project "$PROJECT_ROOT" --no-record` (the path in this command is for the check only; never read it). Fix the chapter for every reason it prints and run it again, at most 4 runs. A citation the check refuses was copied wrong: copy it again from its chapter.

Reply with one line: `<your chapter's name>: written`.
````
