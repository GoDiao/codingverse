/**
 * Go tags query.
 * Follows the tree-sitter `@definition.<kind>` / `@reference.<kind>` / `@name`
 * convention shared by every language config (see extract.ts DEF_KIND/REF_KIND).
 */
export const GO_TAGS = `
; Functions
(function_declaration
  name: (identifier) @name) @definition.function

; Methods (receiver-bound)
(method_declaration
  name: (field_identifier) @name) @definition.method

; Struct types
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (struct_type))) @definition.struct

; Interface types
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (interface_type))) @definition.interface

; Other named types (aliases / defined types)
(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: [(qualified_type) (type_identifier) (pointer_type) (map_type) (slice_type)])) @definition.type

; Calls -> reference
(call_expression
  function: [
    (identifier) @name
    (selector_expression field: (field_identifier) @name)
  ]) @reference.call
`;
