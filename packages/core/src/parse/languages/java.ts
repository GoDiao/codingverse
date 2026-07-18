/**
 * Java tags query.
 * Follows the tree-sitter `@definition.<kind>` / `@reference.<kind>` / `@name`
 * convention shared by every language config (see extract.ts DEF_KIND/REF_KIND).
 */
export const JAVA_TAGS = `
; Classes
(class_declaration
  name: (identifier) @name) @definition.class

; Interfaces
(interface_declaration
  name: (identifier) @name) @definition.interface

; Enums
(enum_declaration
  name: (identifier) @name) @definition.enum

; Methods
(method_declaration
  name: (identifier) @name) @definition.method

; Constructors -> method
(constructor_declaration
  name: (identifier) @name) @definition.method

; Calls -> reference
(method_invocation
  name: (identifier) @name) @reference.call

; Object creation -> reference (new Foo())
(object_creation_expression
  type: (type_identifier) @name) @reference.call
`;
