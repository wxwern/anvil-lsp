## Anvil Language Server Protocol (LSP) Support

**Progress:**

- ✅ Inline Diagnostics
    - ✅ Compile Errors
    - ⚠️ Compile Warnings
- ✅ Hover Information
    - ✅ Definitions and types
    - ⚠️ Lifetimes and timings
    - ❌ Documentation
    - ✅ Anvil syntax help
- ✅ Go to Definition
    - Requires compiler annotations for definitions.
- ⚠️ Go to Type Definition
    - Requires compiler annotations for type definitions.
- ✅ Find All References
    - Only works within the same file.
- ✅ Signature Help
    - ✅ Function call arguments (`call <identifier>(<args>)`)
    - ✅ Endpoint message send arguments (`send <endpoint>.<message>(<args>)`)
    - ✅ Record init field values (`Rec::{<field> = <value>; ... }`)
    - ✅ Spawn process arguments (`spawn <proc>(<args>)`)
- ✅ Autocompletion
    - ✅ Anvil keywords
    - ✅ Document symbols
    - ✅ Context-aware suggestions
        - ✅ Function call syntax (`call <identifier>(<args>)`)
        - ✅ Endpoint message send/receive (`send`/`recv`) syntax
        - ✅ Register read (`*`) syntax
        - ✅ Register assign (`set`) syntax
        - ✅ Enum value syntax (`Enum::value`) syntax
        - ❌ Record init (`Rec::{field =`) syntax
        - ⏳ Record read (`.field`) syntax
        - ✅ Type annotation syntax (`<identifier> : <type>`)
        - ✅ Lifetime annotation syntax (`chan { <left/right> ... : <lifetime> }`)
        - ⏳ Datatype-matched parameter values
    - ✅ Snippets
        - ✅ Automatic delimiter insertion
        - ✅ Function call snippet (`call <identifier>(<args>)`)
        - ✅ Record init snippet (`Rec::{<field> = <value>; ... }`)
        - ✅ Spawn process snippet (`spawn <proc>(<args>)`)
- ✅ Inlay Hints
    - ⚠️ Lifetime and timings
        - ⚠️ Clock Cycle indicators
        - ⚠️ Lifetime indicators
- ⏳ Rename/Refactor symbol
    - Requires compiler annotations for all symbol reference locations.

**Legend:**
- ✅ Supported and operational
- ⚠️ Supported by language server; requires compiler updates to be fully operational
- ⚙️ WIP / incomplete support
- ⏳ Not supported; requires compiler updates to implement support
- ❌ Not supported
