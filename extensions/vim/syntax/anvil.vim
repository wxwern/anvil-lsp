" Vim syntax file
" Language: AnvilHDL

if exists("b:current_syntax")
  finish
endif

syn case match

" Comments
syn region anvilCommentBlock start=/\/\*/ end=/\*\// contains=anvilCommentBlock
syn match anvilCommentLine "//.*$"

" Strings
syn region anvilString start=/\"/ skip=/\\\"/ end=/\"/

" Numbers (decimal or width'base like 8'd255, 4'b1010, 16'hFF)
syn match anvilNumber "\<\d\+\('\(d\d\+\|b[01]\+\|h[0-9A-Fa-f]\+\)\)\?\>"

" Identifiers
syn match anvilIdentifier "\<[A-Za-z_][A-Za-z0-9_]*\>"

" Types and modifiers
syn keyword anvilType logic int dyn
syn keyword anvilStorageModifier left right extern
syn keyword anvilOtherModifier shared assigned\ by import generate generate_seq

" Declaration keywords and names
syn keyword anvilDeclaration struct enum proc spawn type func const reg chan
syn match anvilStructName "\(\<struct\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"
syn match anvilEnumName "\(\<enum\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"
syn match anvilProcName "\(\<proc\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"
syn match anvilSpawnName "\(\<spawn\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"
syn match anvilTypeName "\(\<type\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"
syn match anvilFuncName "\(\<func\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"
syn match anvilConstName "\(\<const\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"
syn match anvilRegName "\(\<reg\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"

" Channel declarations: chan A -- B  and chan A
" Highlight first and second identifiers separately
syn match anvilChanName "\(\<chan\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)\(\s*--\)\@!"
syn match anvilChanFirst "\(\<chan\>\s\+\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)\(\s*--\)\@="
syn match anvilChanSecond "\(\<chan\>\s\+[A-Za-z_][A-Za-z0-9_]*\s*--\s*\)\@<=\([A-Za-z_][A-Za-z0-9_]*\)"

" Namespace :: and enum variant patterns: Type::Variant and Type:: { ... }
syn match anvilNamespaceFull "\<[A-Za-z_][A-Za-z0-9_]*\>\(\s*::\s*\)\@=\<[A-Za-z_][A-Za-z0-9_]*\>"
syn match anvilNamespaceLeft "\<[A-Za-z_][A-Za-z0-9_]*\>\(\s*::\)\@="
syn match anvilNamespaceRight "\(::\s*\)\@<=\<[A-Za-z_][A-Za-z0-9_]*\>"

" Type annotations like : Type or : left Type or : right Type
syn match anvilTypeAnnotationRight "\(:\s*\<right\>\s\+\)\@<=[A-Za-z_][A-Za-z0-9_]*\>"
syn match anvilTypeAnnotationLeft "\(:\s*\<left\>\s\+\)\@<=[A-Za-z_][A-Za-z0-9_]*\>"
syn match anvilTypeAnnotation "\(:\s*\)\@<=[A-Za-z_][A-Za-z0-9_]*\>"

" Operators, punctuation and keywords
syn match anvilOperatorConnect "--"
syn match anvilOperatorNamespace "::"
syn match anvilOperatorType ":"
syn match anvilPunctComma ","
syn match anvilPunctSemi ";"
syn match anvilPunctDot "\." "contained"

" Control keywords
syn keyword anvilControl call loop recursive if else try recurse recv send dprint dfinish set cycle sync match put ready in probe
syn keyword anvilOtherKeywords with let
syn match anvilAssignment ":=\|="
syn match anvilWait ">>"

" Ensure identifiers don't override other groups
syn cluster anvilTop add=anvilCommentBlock,anvilCommentLine,anvilString,anvilNumber,anvilStructName,anvilEnumName,anvilProcName,anvilSpawnName,anvilChanFirst,anvilChanSecond,anvilChanName,anvilTypeName,anvilFuncName,anvilConstName,anvilRegName,anvilNamespaceFull,anvilTypeAnnotation,anvilOperatorConnect,anvilOperatorNamespace,anvilAssignment,anvilWait,anvilPunctComma,anvilPunctSemi,anvilPunctDot,anvilControl,anvilType,anvilDeclaration,anvilStorageModifier,anvilOtherModifier,anvilOtherKeywords

" Link to highlight groups
hi def link anvilCommentBlock Comment
hi def link anvilCommentLine Comment
hi def link anvilString String
hi def link anvilNumber Number
hi def link anvilDeclaration Keyword
hi def link anvilStructName Type
hi def link anvilEnumName Type
hi def link anvilProcName Function
hi def link anvilSpawnName Function
hi def link anvilTypeName Type
hi def link anvilFuncName Function
hi def link anvilConstName Constant
hi def link anvilRegName Identifier
hi def link anvilIdentifier Identifier
hi def link anvilChanFirst Identifier
hi def link anvilChanSecond Identifier
hi def link anvilChanName Type
hi def link anvilNamespaceFull Identifier
hi def link anvilNamespaceLeft Identifier
hi def link anvilNamespaceRight Identifier
hi def link anvilTypeAnnotationLeft Type
hi def link anvilTypeAnnotationRight Type
hi def link anvilTypeAnnotation Type
hi def link anvilOperatorConnect Operator
hi def link anvilOperatorNamespace Operator
hi def link anvilAssignment Operator
hi def link anvilWait Special
hi def link anvilPunctComma Delimiter
hi def link anvilPunctSemi Delimiter
hi def link anvilPunctDot Delimiter
hi def link anvilControl Keyword
hi def link anvilType Type
hi def link anvilOtherModifier Keyword
hi def link anvilOtherKeywords Keyword
hi def link anvilStorageModifier Keyword

let b:current_syntax = "anvil"
