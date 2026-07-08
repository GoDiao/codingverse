/**
 * TypeScript/JavaScript/TSX tags query.
 * Follows the tree-sitter `@definition.<kind>` / `@reference.<kind>` / `@name`
 * convention. `@definition.*` marks the full symbol node; `@name` its identifier.
 */
export const TS_TAGS = `
; Classes
(class_declaration
  name: (type_identifier) @name) @definition.class

; Interfaces
(interface_declaration
  name: (type_identifier) @name) @definition.interface

; Type aliases
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

; Enums
(enum_declaration
  name: (identifier) @name) @definition.enum

; Function declarations
(function_declaration
  name: (identifier) @name) @definition.function

; Methods
(method_definition
  name: (property_identifier) @name) @definition.method

; Arrow / function-expression assigned to a const/let
(variable_declarator
  name: (identifier) @name
  value: [(arrow_function) (function_expression)]) @definition.function

; Call expressions -> reference
(call_expression
  function: [
    (identifier) @name
    (member_expression property: (property_identifier) @name)
  ]) @reference.call

; new Foo() -> reference
(new_expression
  constructor: [
    (identifier) @name
    (member_expression property: (property_identifier) @name)
  ]) @reference.call
`;
