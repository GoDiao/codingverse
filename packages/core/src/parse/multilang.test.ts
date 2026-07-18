import { describe, it, expect, afterAll } from "vitest";
import { parseFile, disposeParsers } from "./index.js";
import type { FileEntry } from "@codingverse/shared";

const mkFile = (path: string, content: string): FileEntry => ({
  path,
  absPath: `/tmp/${path}`,
  content,
  size: content.length,
});

afterAll(() => disposeParsers());

describe("parseFile — Go (V3-5)", () => {
  it("extracts funcs, methods, structs, interfaces + call refs", async () => {
    const src = `package main

type Greeter struct {
	name string
}

type Speaker interface {
	Speak() string
}

func (g Greeter) Greet() string {
	return format(g.name)
}

func format(s string) string {
	return "hi " + s
}

func main() {
	g := Greeter{name: "x"}
	println(g.Greet())
}
`;
    const parsed = await parseFile(mkFile("main.go", src));
    expect(parsed.language).toBe("go");
    expect(parsed.degraded).toBe(false);

    const byName = new Map(parsed.symbols.map((s) => [s.name, s]));
    expect(byName.get("Greeter")?.kind).toBe("struct");
    expect(byName.get("Speaker")?.kind).toBe("interface");
    expect(byName.get("Greet")?.kind).toBe("method");
    expect(byName.get("format")?.kind).toBe("function");

    const callNames = parsed.refs.filter((r) => r.kind === "calls").map((r) => r.name);
    expect(callNames).toContain("format");
    expect(callNames).toContain("Greet");
  });
});

describe("parseFile — Rust (V3-5)", () => {
  it("extracts fns, structs, enums, traits + call refs", async () => {
    const src = `struct Point {
    x: i32,
}

enum Shape {
    Circle,
    Square,
}

trait Draw {
    fn draw(&self);
}

fn helper(n: i32) -> i32 {
    n * 2
}

fn main() {
    let r = helper(21);
    println!("{}", r);
}
`;
    const parsed = await parseFile(mkFile("main.rs", src));
    expect(parsed.language).toBe("rust");
    expect(parsed.degraded).toBe(false);

    const byName = new Map(parsed.symbols.map((s) => [s.name, s]));
    expect(byName.get("Point")?.kind).toBe("struct");
    expect(byName.get("Shape")?.kind).toBe("enum");
    expect(byName.get("Draw")?.kind).toBe("interface");
    expect(byName.get("helper")?.kind).toBe("function");

    const callNames = parsed.refs.filter((r) => r.kind === "calls").map((r) => r.name);
    expect(callNames).toContain("helper");
  });
});

describe("parseFile — Java (V3-5)", () => {
  it("extracts classes, interfaces, methods + call refs", async () => {
    const src = `public class Greeter {
    private String name;

    public Greeter(String name) {
        this.name = name;
    }

    public String greet() {
        return format(name);
    }

    private String format(String s) {
        return "hi " + s;
    }
}

interface Speaker {
    String speak();
}
`;
    const parsed = await parseFile(mkFile("Greeter.java", src));
    expect(parsed.language).toBe("java");
    expect(parsed.degraded).toBe(false);

    // Note: the constructor shares the class name "Greeter", so match by
    // (name, kind) rather than name alone.
    const has = (name: string, kind: string) =>
      parsed.symbols.some((s) => s.name === name && s.kind === kind);
    expect(has("Greeter", "class")).toBe(true);
    expect(has("Speaker", "interface")).toBe(true);
    expect(has("greet", "method")).toBe(true);
    expect(has("format", "method")).toBe(true);

    const callNames = parsed.refs.filter((r) => r.kind === "calls").map((r) => r.name);
    expect(callNames).toContain("format");
  });

  it("produces chunks with non-empty bodies", async () => {
    const src = `class A { void one() {} void two() {} }\n`;
    const parsed = await parseFile(mkFile("A.java", src));
    expect(parsed.chunks.length).toBeGreaterThanOrEqual(1);
    expect(parsed.chunks.every((c) => c.body.length > 0)).toBe(true);
  });
});
