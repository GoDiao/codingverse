/**
 * Rust tags query.
 * Follows the tree-sitter `@definition.<kind>` / `@reference.<kind>` / `@name`
 * convention shared by every language config (see extract.ts DEF_KIND/REF_KIND).
 */
export const RUST_TAGS = `
; Functions / methods (function_item inside impl is refined to method later)
(function_item
  name: (identifier) @name) @definition.function

; Structs
(struct_item
  name: (type_identifier) @name) @definition.struct

; Enums
(enum_item
  name: (type_identifier) @name) @definition.enum

; Traits -> interface
(trait_item
  name: (type_identifier) @name) @definition.interface

; Type aliases
(type_item
  name: (type_identifier) @name) @definition.type

; Calls -> reference
(call_expression
  function: [
    (identifier) @name
    (field_expression field: (field_identifier) @name)
    (scoped_identifier name: (identifier) @name)
  ]) @reference.call
`;
