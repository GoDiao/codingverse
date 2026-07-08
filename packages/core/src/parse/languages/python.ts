/**
 * Python tags query.
 * Follows the tree-sitter `@definition.<kind>` / `@reference.<kind>` / `@name`
 * convention.
 */
export const PY_TAGS = `
; Classes
(class_definition
  name: (identifier) @name) @definition.class

; Functions / methods (method vs function disambiguated by enclosing scope later)
(function_definition
  name: (identifier) @name) @definition.function

; Calls -> reference
(call
  function: [
    (identifier) @name
    (attribute attribute: (identifier) @name)
  ]) @reference.call
`;
