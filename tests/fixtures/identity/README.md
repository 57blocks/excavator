# identity fixtures

Synthetic sources for the node-identity rules in the `verifiable-statements`
change (design D2). Every file here exists to make one collapse mode visible:

| path | what it pins |
|---|---|
| `a/util.ts`, `b/util.ts` | byte-identical content at two paths — the path is part of the identity |
| `go/receivers.go` | two `Save` methods with different receivers, and a free `Save` |
| `cs/Overloads.cs` | two same-named methods in one class — the colliding group needs line numbers |
| `php/mixed.php` | trait, enum and anonymous-class methods |
| `ts/api.ts` | object-literal methods and class methods, owned by their binding/class |

Nothing here is derived from a real project.
