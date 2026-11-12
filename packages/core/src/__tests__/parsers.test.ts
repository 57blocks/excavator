import { describe, it, expect } from "vitest";
import { MarkdownParser } from "../plugins/parsers/markdown-parser.js";
import { YAMLConfigParser } from "../plugins/parsers/yaml-parser.js";
import { JSONConfigParser, stripJsoncSyntax } from "../plugins/parsers/json-parser.js";
import { TOMLParser } from "../plugins/parsers/toml-parser.js";
import { EnvParser } from "../plugins/parsers/env-parser.js";
import { DockerfileParser } from "../plugins/parsers/dockerfile-parser.js";
import { SQLParser } from "../plugins/parsers/sql-parser.js";
import { GraphQLParser } from "../plugins/parsers/graphql-parser.js";
import { ProtobufParser } from "../plugins/parsers/protobuf-parser.js";
import { TerraformParser } from "../plugins/parsers/terraform-parser.js";
import { MakefileParser } from "../plugins/parsers/makefile-parser.js";
import { ShellParser } from "../plugins/parsers/shell-parser.js";
import { registerAllParsers } from "../plugins/parsers/index.js";
import { PluginRegistry } from "../plugins/registry.js";

describe("MarkdownParser", () => {
  const parser = new MarkdownParser();

  it("extracts heading sections", () => {
    const content = "# Title\n\nIntro\n\n## Section A\n\nContent A\n\n### Subsection\n\nContent B";
    const result = parser.analyzeFile("README.md", content);
    expect(result.sections).toHaveLength(3);
    expect(result.sections![0]).toMatchObject({ name: "Title", level: 1 });
    expect(result.sections![1]).toMatchObject({ name: "Section A", level: 2 });
    expect(result.sections![2]).toMatchObject({ name: "Subsection", level: 3 });
  });

  it("extracts YAML front matter as imports", () => {
    const content = "---\ntitle: Test\ntags: [a, b]\n---\n# Content";
    const result = parser.analyzeFile("post.md", content);
    expect(result.imports).toHaveLength(0);
  });

  it("extracts file references", () => {
    const content = "See [guide](./docs/guide.md) and ![img](./assets/logo.png)";
    const refs = parser.extractReferences!("README.md", content);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ target: "./docs/guide.md", referenceType: "file" });
    expect(refs[1]).toMatchObject({ target: "./assets/logo.png", referenceType: "image" });
  });

  it("skips external URLs in references", () => {
    const content = "[link](https://example.com) and [local](./file.md)";
    const refs = parser.extractReferences!("README.md", content);
    expect(refs).toHaveLength(1);
    expect(refs[0].target).toBe("./file.md");
  });

  it("returns empty sections for empty content", () => {
    const result = parser.analyzeFile("empty.md", "");
    expect(result.sections).toHaveLength(0);
  });

  it("ignores headings inside fenced code blocks", () => {
    // Regression: lines inside ``` blocks that look like shell comments
    // (`# install`, `# build`) used to register as level-1 sections.
    const content = [
      "# Real Title",
      "",
      "Some intro.",
      "",
      "```bash",
      "# install",
      "npm install",
      "# build",
      "npm run build",
      "```",
      "",
      "## Real Section",
    ].join("\n");
    const result = parser.analyzeFile("README.md", content);
    expect(result.sections!.map((s) => s.name)).toEqual(["Real Title", "Real Section"]);
  });

  it("re-enters heading detection after the fence closes", () => {
    const content = [
      "```",
      "# fake",
      "```",
      "# After fence",
    ].join("\n");
    const result = parser.analyzeFile("doc.md", content);
    expect(result.sections!.map((s) => s.name)).toEqual(["After fence"]);
  });
});

describe("YAMLConfigParser", () => {
  const parser = new YAMLConfigParser();

  it("extracts top-level key sections", () => {
    const content = "name: my-app\nversion: 1.0\nservices:\n  web:\n    image: node\n  db:\n    image: postgres";
    const result = parser.analyzeFile("config.yaml", content);
    expect(result.sections).toBeDefined();
    expect(result.sections!.length).toBeGreaterThanOrEqual(3);
    expect(result.sections!.map(s => s.name)).toContain("name");
    expect(result.sections!.map(s => s.name)).toContain("services");
  });

  it("handles invalid YAML gracefully", () => {
    const content = "invalid: yaml: content: [[[";
    const result = parser.analyzeFile("broken.yaml", content);
    expect(result.sections).toBeDefined();
  });

  it("declares yaml-flavored special formats so the registry can route them here", () => {
    // Regression: docker-compose / kubernetes / github-actions / openapi
    // were tagged with non-`yaml` ids by LanguageRegistry, so the parser
    // never matched and the file got zero structural extraction.
    expect(parser.languages).toEqual(expect.arrayContaining([
      "yaml", "kubernetes", "docker-compose", "github-actions", "openapi",
    ]));
  });

  it("recognizes quoted top-level keys (e.g. GitHub Actions `\"on\"`)", () => {
    const content = '"on":\n  push:\n    branches: [main]\nname: ci\n';
    const result = parser.analyzeFile(".github/workflows/ci.yml", content);
    expect(result.sections!.map((s) => s.name)).toEqual(expect.arrayContaining(["on", "name"]));
  });

  it("emits one section per entry for array-root YAML documents", () => {
    const content = "- name: alpha\n  port: 80\n- name: beta\n  port: 443\n";
    const result = parser.analyzeFile("list.yaml", content);
    expect(result.sections!.map((s) => s.name)).toEqual(["alpha", "beta"]);
  });
});

describe("JSONConfigParser", () => {
  const parser = new JSONConfigParser();

  it("extracts top-level key sections", () => {
    const content = '{\n  "name": "my-app",\n  "version": "1.0",\n  "dependencies": {}\n}';
    const result = parser.analyzeFile("package.json", content);
    expect(result.sections).toBeDefined();
    expect(result.sections!.map(s => s.name)).toContain("name");
    expect(result.sections!.map(s => s.name)).toContain("dependencies");
  });

  it("extracts $ref references", () => {
    const content = '{\n  "$ref": "./common.json#/defs/User"\n}';
    const refs = parser.extractReferences!("schema.json", content);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ target: "./common.json#/defs/User", referenceType: "schema" });
  });

  it("skips internal $ref references", () => {
    const content = '{\n  "$ref": "#/definitions/User"\n}';
    const refs = parser.extractReferences!("schema.json", content);
    expect(refs).toHaveLength(0);
  });

  it("handles invalid JSON gracefully", () => {
    const content = "not json at all";
    const result = parser.analyzeFile("broken.json", content);
    expect(result.sections).toHaveLength(0);
  });

  it("declares json plus the JSON-flavored special formats as supported languages", () => {
    expect(parser.languages).toEqual(["json", "jsonc", "json-schema", "openapi"]);
  });

  it("parses .jsonc files with line and block comments", () => {
    const content = [
      "{",
      "  // top-level comment",
      '  "name": "wrangler",',
      "  /* block",
      "     comment */",
      '  "main": "src/index.ts",',
      '  "compatibility_date": "2024-01-01",',
      "}", // trailing comma above
    ].join("\n");
    const result = parser.analyzeFile("wrangler.jsonc", content);
    const names = result.sections!.map((s) => s.name);
    expect(names).toEqual(["name", "main", "compatibility_date"]);
  });

  it("preserves comment-like sequences inside string values", () => {
    const content = '{\n  "url": "https://example.com//path",\n  "note": "/* not a comment */"\n}';
    const result = parser.analyzeFile("config.jsonc", content);
    expect(result.sections!.map((s) => s.name)).toEqual(["url", "note"]);
  });
});

describe("stripJsoncSyntax", () => {
  it("strips line comments", () => {
    expect(stripJsoncSyntax('{"a": 1} // tail')).toBe('{"a": 1} ');
  });

  it("strips block comments", () => {
    expect(stripJsoncSyntax('{/* x */ "a": 1}')).toBe('{ "a": 1}');
  });

  it("strips trailing commas before } and ]", () => {
    expect(stripJsoncSyntax('{"a": 1,}')).toBe('{"a": 1}');
    expect(stripJsoncSyntax('[1, 2,]')).toBe('[1, 2]');
  });

  it("does not strip // inside strings", () => {
    expect(stripJsoncSyntax('{"u": "http://x"}')).toBe('{"u": "http://x"}');
  });

  it("handles escaped quotes inside strings", () => {
    expect(stripJsoncSyntax('{"q": "say \\"hi\\""}')).toBe('{"q": "say \\"hi\\""}');
  });

  it("leaves plain JSON unchanged", () => {
    const plain = '{"a": 1, "b": [2, 3]}';
    expect(stripJsoncSyntax(plain)).toBe(plain);
  });
});

describe("TOMLParser", () => {
  const parser = new TOMLParser();

  it("extracts section headers", () => {
    const content = "[package]\nname = \"my-app\"\n\n[dependencies]\nfoo = \"1.0\"\n\n[[bin]]\nname = \"cli\"";
    const result = parser.analyzeFile("Cargo.toml", content);
    expect(result.sections).toBeDefined();
    expect(result.sections!.length).toBe(3);
    expect(result.sections![0].name).toBe("package");
    expect(result.sections![1].name).toBe("dependencies");
    expect(result.sections![2].name).toBe("[[bin]]");
  });
});

describe("EnvParser", () => {
  const parser = new EnvParser();

  it("extracts variable names", () => {
    const content = "# Database config\nDB_HOST=localhost\nDB_PORT=5432\n\n# API\nAPI_KEY=secret123";
    const result = parser.analyzeFile(".env", content);
    expect(result.definitions).toBeDefined();
    expect(result.definitions!).toHaveLength(3);
    expect(result.definitions!.map(d => d.name)).toEqual(["DB_HOST", "DB_PORT", "API_KEY"]);
  });

  it("skips comments and empty lines", () => {
    const content = "# comment\n\nVAR=value";
    const result = parser.analyzeFile(".env", content);
    expect(result.definitions!).toHaveLength(1);
  });
});

describe("DockerfileParser", () => {
  const parser = new DockerfileParser();

  it("extracts FROM stages", () => {
    const content = "FROM node:22-slim AS builder\nRUN npm install\n\nFROM node:22-slim AS runner\nCOPY --from=builder /app /app\nEXPOSE 3000";
    const result = parser.analyzeFile("Dockerfile", content);
    expect(result.services).toBeDefined();
    expect(result.services!).toHaveLength(2);
    expect(result.services![0]).toMatchObject({ name: "builder", image: "node:22-slim" });
    expect(result.services![1]).toMatchObject({ name: "runner", image: "node:22-slim" });
  });

  it("extracts EXPOSE ports", () => {
    const content = "FROM node:22\nEXPOSE 3000 8080\nCMD [\"node\", \"server.js\"]";
    const result = parser.analyzeFile("Dockerfile", content);
    expect(result.services![0].ports).toContain(3000);
    expect(result.services![0].ports).toContain(8080);
  });

  it("extracts steps", () => {
    const content = "FROM node:22\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD [\"node\", \"start\"]";
    const result = parser.analyzeFile("Dockerfile", content);
    expect(result.steps).toBeDefined();
    expect(result.steps!.length).toBe(5);
  });
});

describe("SQLParser", () => {
  const parser = new SQLParser();

  it("extracts CREATE TABLE definitions with columns", () => {
    const content = `CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  title TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);`;
    const result = parser.analyzeFile("schema.sql", content);
    expect(result.definitions).toBeDefined();
    expect(result.definitions!).toHaveLength(2);
    expect(result.definitions![0]).toMatchObject({ name: "users", kind: "table" });
    expect(result.definitions![0].fields).toContain("id");
    expect(result.definitions![0].fields).toContain("name");
    expect(result.definitions![0].fields).toContain("email");
    expect(result.definitions![1]).toMatchObject({ name: "posts", kind: "table" });
  });

  it("extracts CREATE VIEW", () => {
    const content = "CREATE VIEW active_users AS SELECT * FROM users WHERE active = true;";
    const result = parser.analyzeFile("views.sql", content);
    expect(result.definitions!.some(d => d.name === "active_users" && d.kind === "view")).toBe(true);
  });

  it("extracts CREATE INDEX", () => {
    const content = "CREATE UNIQUE INDEX idx_users_email ON users(email);";
    const result = parser.analyzeFile("indexes.sql", content);
    expect(result.definitions!.some(d => d.name === "idx_users_email" && d.kind === "index")).toBe(true);
  });
});

describe("GraphQLParser", () => {
  const parser = new GraphQLParser();

  it("extracts type definitions", () => {
    const content = `type User {
  id: ID!
  name: String!
  email: String!
}

type Post {
  id: ID!
  title: String!
  author: User!
}`;
    const result = parser.analyzeFile("schema.graphql", content);
    expect(result.definitions).toBeDefined();
    expect(result.definitions!).toHaveLength(2);
    expect(result.definitions![0]).toMatchObject({ name: "User", kind: "type" });
    expect(result.definitions![0].fields).toContain("id");
    expect(result.definitions![0].fields).toContain("name");
    expect(result.definitions![1]).toMatchObject({ name: "Post", kind: "type" });
  });

  it("extracts Query/Mutation endpoints", () => {
    const content = `type Query {
  users: [User!]!
  user(id: ID!): User
}

type Mutation {
  createUser(name: String!): User!
}`;
    const result = parser.analyzeFile("schema.graphql", content);
    expect(result.endpoints).toBeDefined();
    expect(result.endpoints!.length).toBeGreaterThanOrEqual(3);
    expect(result.endpoints!.some(e => e.method === "Query" && e.path === "users")).toBe(true);
    expect(result.endpoints!.some(e => e.method === "Mutation" && e.path === "createUser")).toBe(true);
  });

  it("extracts enum definitions", () => {
    const content = "enum Role {\n  ADMIN\n  USER\n  GUEST\n}";
    const result = parser.analyzeFile("schema.graphql", content);
    expect(result.definitions!.some(d => d.name === "Role" && d.kind === "enum")).toBe(true);
  });
});

describe("ProtobufParser", () => {
  const parser = new ProtobufParser();

  it("extracts message definitions with fields", () => {
    const content = `message User {
  string name = 1;
  int32 age = 2;
  repeated string emails = 3;
}`;
    const result = parser.analyzeFile("user.proto", content);
    expect(result.definitions).toBeDefined();
    expect(result.definitions!).toHaveLength(1);
    expect(result.definitions![0]).toMatchObject({ name: "User", kind: "message" });
    expect(result.definitions![0].fields).toContain("name");
    expect(result.definitions![0].fields).toContain("age");
    expect(result.definitions![0].fields).toContain("emails");
  });

  it("extracts enum definitions", () => {
    const content = "enum Status {\n  UNKNOWN = 0;\n  ACTIVE = 1;\n  INACTIVE = 2;\n}";
    const result = parser.analyzeFile("status.proto", content);
    expect(result.definitions!.some(d => d.name === "Status" && d.kind === "enum")).toBe(true);
    expect(result.definitions![0].fields).toContain("UNKNOWN");
    expect(result.definitions![0].fields).toContain("ACTIVE");
  });

  it("extracts service RPC methods", () => {
    const content = `service UserService {
  rpc GetUser (GetUserRequest) returns (User);
  rpc CreateUser (CreateUserRequest) returns (User);
}`;
    const result = parser.analyzeFile("service.proto", content);
    expect(result.endpoints).toBeDefined();
    expect(result.endpoints!).toHaveLength(2);
    expect(result.endpoints![0]).toMatchObject({ method: "rpc", path: "UserService.GetUser" });
    expect(result.endpoints![1]).toMatchObject({ method: "rpc", path: "UserService.CreateUser" });
  });
});

describe("TerraformParser", () => {
  const parser = new TerraformParser();

  it("extracts resource blocks", () => {
    const content = `resource "aws_s3_bucket" "main" {
  bucket = "my-bucket"
}

resource "aws_iam_role" "lambda" {
  name = "lambda-role"
}`;
    const result = parser.analyzeFile("main.tf", content);
    expect(result.resources).toBeDefined();
    expect(result.resources!).toHaveLength(2);
    expect(result.resources![0]).toMatchObject({ name: "aws_s3_bucket.main", kind: "aws_s3_bucket" });
    expect(result.resources![1]).toMatchObject({ name: "aws_iam_role.lambda", kind: "aws_iam_role" });
  });

  it("extracts data blocks", () => {
    const content = 'data "aws_ami" "ubuntu" {\n  most_recent = true\n}';
    const result = parser.analyzeFile("data.tf", content);
    expect(result.resources!.some(r => r.name === "data.aws_ami.ubuntu")).toBe(true);
  });

  it("extracts module blocks", () => {
    const content = 'module "vpc" {\n  source = "./modules/vpc"\n}';
    const result = parser.analyzeFile("modules.tf", content);
    expect(result.resources!.some(r => r.name === "module.vpc" && r.kind === "module")).toBe(true);
  });

  it("extracts variables and outputs", () => {
    const content = 'variable "region" {\n  default = "us-east-1"\n}\n\noutput "bucket_arn" {\n  value = aws_s3_bucket.main.arn\n}';
    const result = parser.analyzeFile("variables.tf", content);
    expect(result.definitions).toBeDefined();
    expect(result.definitions!.some(d => d.name === "region" && d.kind === "variable")).toBe(true);
    expect(result.definitions!.some(d => d.name === "bucket_arn" && d.kind === "output")).toBe(true);
  });
});

describe("MakefileParser", () => {
  const parser = new MakefileParser();

  it("extracts make targets", () => {
    const content = "build:\n\tgo build -o bin/app\n\ntest:\n\tgo test ./...\n\nclean:\n\trm -rf bin/";
    const result = parser.analyzeFile("Makefile", content);
    expect(result.steps).toBeDefined();
    expect(result.steps!).toHaveLength(3);
    expect(result.steps!.map(s => s.name)).toEqual(["build", "test", "clean"]);
  });

  it("does not confuse variable assignments with targets", () => {
    const content = "CC := gcc\nCFLAGS := -Wall\n\nbuild:\n\t$(CC) $(CFLAGS) main.c";
    const result = parser.analyzeFile("Makefile", content);
    expect(result.steps!).toHaveLength(1);
    expect(result.steps![0].name).toBe("build");
  });
});

describe("ShellParser", () => {
  const parser = new ShellParser();

  it("extracts function definitions", () => {
    const content = "#!/bin/bash\n\ngreet() {\n  echo \"Hello $1\"\n}\n\nfunction cleanup {\n  rm -rf tmp/\n}";
    const result = parser.analyzeFile("script.sh", content);
    expect(result.functions).toHaveLength(2);
    expect(result.functions[0].name).toBe("greet");
    expect(result.functions[1].name).toBe("cleanup");
  });

  it("extracts source references", () => {
    const content = "#!/bin/bash\nsource ./lib/utils.sh\n. ./lib/config.sh";
    const refs = parser.extractReferences!("script.sh", content);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ target: "./lib/utils.sh", referenceType: "file" });
    expect(refs[1]).toMatchObject({ target: "./lib/config.sh", referenceType: "file" });
  });
});

// --- Edge case tests ---

describe("SQLParser edge cases", () => {
  const parser = new SQLParser();

  it("handles CREATE TABLE IF NOT EXISTS", () => {
    const content = "CREATE TABLE IF NOT EXISTS users (id INT);";
    const result = parser.analyzeFile("schema.sql", content);
    expect(result.definitions).toBeDefined();
    expect(result.definitions!).toHaveLength(1);
    expect(result.definitions![0]).toMatchObject({ name: "users", kind: "table" });
    expect(result.definitions![0].fields).toContain("id");
  });

  it("handles CREATE OR REPLACE VIEW", () => {
    const content = "CREATE OR REPLACE VIEW active AS SELECT * FROM users;";
    const result = parser.analyzeFile("views.sql", content);
    expect(result.definitions).toBeDefined();
    expect(result.definitions!.some(d => d.name === "active" && d.kind === "view")).toBe(true);
  });
});

describe("SQLParser statements and stored code", () => {
  const parser = new SQLParser();

  it("does not extract CREATE statements that sit in comments", () => {
    const content = [
      "-- CREATE TABLE ghost (id INT);",
      "/* CREATE PROCEDURE ghost_proc IS BEGIN NULL; END;",
      "   CREATE TABLE ghost2 (id INT); */",
      "CREATE TABLE real_t (id INT);",
    ].join("\n");
    const r = parser.analyzeFile("c.sql", content);
    expect(r.definitions!.map((d) => d.name)).toEqual(["real_t"]);
    expect(r.definitions![0].lineRange).toEqual([4, 4]);
    expect(r.functions).toEqual([]);
    expect(r.unplaced).toBeUndefined();
  });

  it("keeps statements inside a $$ function body out of the result", () => {
    const content = [
      "CREATE FUNCTION make_it() RETURNS void AS $$",
      "BEGIN",
      "  CREATE TABLE inner_t (id INT);",
      "END;",
      "$$ LANGUAGE plpgsql;",
      "CREATE TABLE after_t (id INT);",
    ].join("\n");
    const r = parser.analyzeFile("pg.sql", content);
    expect(r.functions.map((f) => f.name)).toEqual(["make_it"]);
    expect(r.functions[0].lineRange).toEqual([1, 5]);
    expect(r.functions[0].returnType).toBe("void");
    expect(r.definitions!.map((d) => d.name)).toEqual(["after_t"]);
    expect(r.definitions![0].lineRange).toEqual([6, 6]);
  });

  it("takes the last segment of a schema-qualified table name", () => {
    const r = parser.analyzeFile("s.sql", "CREATE TABLE app.users (id NUMBER, name VARCHAR2(10));");
    expect(r.definitions).toHaveLength(1);
    expect(r.definitions![0]).toMatchObject({ name: "users", kind: "table", fields: ["id", "name"] });
  });

  it("takes the last segment of a quoted qualified name", () => {
    const r = parser.analyzeFile("q.sql", 'CREATE TABLE "APP"."ORDERS" (id NUMBER);');
    expect(r.definitions!.map((d) => d.name)).toEqual(["ORDERS"]);
  });

  it("extracts an Oracle procedure ended by a lone slash", () => {
    const content = [
      "CREATE OR REPLACE PROCEDURE app.close_order(p_id IN NUMBER) IS",
      "BEGIN",
      "  UPDATE orders SET s = 1 WHERE id = p_id;",
      "END;",
      "/",
      "",
    ].join("\n");
    const r = parser.analyzeFile("p.sql", content);
    expect(r.functions).toHaveLength(1);
    expect(r.functions[0]).toMatchObject({ name: "close_order", params: ["p_id"], owner: "", lineRange: [1, 4] });
  });

  it("extracts a function with its return type", () => {
    const content = "CREATE OR REPLACE FUNCTION order_total(p_id NUMBER) RETURN NUMBER IS\nBEGIN\n  RETURN 1;\nEND;\n/";
    const r = parser.analyzeFile("f.sql", content);
    expect(r.functions[0]).toMatchObject({ name: "order_total", returnType: "NUMBER", params: ["p_id"] });
  });

  it("extracts a trigger as a function without params", () => {
    const content = "CREATE OR REPLACE TRIGGER trg_orders_bi BEFORE INSERT ON orders\nFOR EACH ROW\nBEGIN\n  NULL;\nEND;\n/";
    const r = parser.analyzeFile("t.sql", content);
    expect(r.functions).toHaveLength(1);
    expect(r.functions[0]).toMatchObject({ name: "trg_orders_bi", params: [], owner: "", lineRange: [1, 5] });
  });

  it("accepts EDITIONABLE between OR REPLACE and the object kind", () => {
    const r = parser.analyzeFile("e.sql", "CREATE OR REPLACE EDITIONABLE PROCEDURE p1 IS\nBEGIN\n  NULL;\nEND;\n/");
    expect(r.functions.map((f) => f.name)).toEqual(["p1"]);
  });

  it("makes one class per package and gives body subprograms the package as owner", () => {
    const content = [
      "CREATE OR REPLACE PACKAGE order_pkg AS",
      "  PROCEDURE a;",
      "  PROCEDURE b;",
      "END order_pkg;",
      "/",
      "CREATE OR REPLACE PACKAGE BODY order_pkg AS",
      "  PROCEDURE a IS",
      "  BEGIN",
      "    NULL;",
      "  END a;",
      "  FUNCTION b(x NUMBER) RETURN NUMBER IS",
      "    v NUMBER;",
      "  BEGIN",
      "    v := CASE WHEN x > 0 THEN 1 ELSE 2 END;",
      "    RETURN v;",
      "  END b;",
      "END order_pkg;",
      "/",
    ].join("\n");
    const r = parser.analyzeFile("pkg.sql", content);
    expect(r.classes).toHaveLength(1);
    expect(r.classes[0]).toMatchObject({ name: "order_pkg", methods: ["a", "b"], lineRange: [1, 17] });
    expect(r.functions.map((f) => [f.name, f.owner, f.lineRange])).toEqual([
      ["a", "order_pkg", [7, 10]],
      ["b", "order_pkg", [11, 16]],
    ]);
    expect(r.functions[1]).toMatchObject({ params: ["x"], returnType: "NUMBER" });
  });

  it("does not turn spec signatures or nested subprograms into functions", () => {
    const content = [
      "CREATE PACKAGE spec_only AS",
      "  PROCEDURE a;",
      "END;",
      "/",
      "CREATE PACKAGE BODY nest AS",
      "  PROCEDURE outer_p IS",
      "    PROCEDURE inner_p IS BEGIN NULL; END;",
      "  BEGIN",
      "    inner_p;",
      "  END;",
      "END;",
      "/",
    ].join("\n");
    const r = parser.analyzeFile("n.sql", content);
    expect(r.classes.map((c) => c.name)).toEqual(["spec_only", "nest"]);
    expect(r.classes[0].methods).toEqual([]);
    expect(r.functions.map((f) => f.name)).toEqual(["outer_p"]);
    expect(r.functions[0].lineRange).toEqual([6, 10]);
  });

  it("reports CREATE SEQUENCE as unplaced", () => {
    const r = parser.analyzeFile("seq.sql", "CREATE SEQUENCE seq_orders START WITH 1;");
    expect(r.definitions).toEqual([]);
    expect(r.functions).toEqual([]);
    expect(r.classes).toEqual([]);
    expect(r.unplaced).toEqual([{ reason: "unextracted-sql-object:sequence", lineRange: [1, 1] }]);
  });

  it("names the kind of other unextracted CREATE statements", () => {
    const r = parser.analyzeFile(
      "o.sql",
      "CREATE OR REPLACE PUBLIC SYNONYM s FOR app.t;\nCREATE MATERIALIZED VIEW mv AS SELECT 1 FROM dual;",
    );
    expect(r.unplaced!.map((u) => u.reason)).toEqual([
      "unextracted-sql-object:synonym",
      "unextracted-sql-object:materialized view",
    ]);
  });

  it("produces nothing for DML, GRANT and ALTER", () => {
    const content = "INSERT INTO t VALUES (1);\nGRANT SELECT ON t TO u;\nALTER TABLE t ADD c INT;\nSELECT 1 FROM dual;";
    const r = parser.analyzeFile("d.sql", content);
    expect(r.definitions).toEqual([]);
    expect(r.functions).toEqual([]);
    expect(r.unplaced).toBeUndefined();
  });

  it("covers every line of a multi-line view", () => {
    const content = "CREATE OR REPLACE VIEW v_orders AS\nSELECT o.id,\n       o.total\nFROM orders o;";
    const r = parser.analyzeFile("v.sql", content);
    expect(r.definitions![0]).toMatchObject({ name: "v_orders", kind: "view", lineRange: [1, 4] });
  });
});

describe("SQLParser dialect quirks", () => {
  const parser = new SQLParser();
  const names = (c: string) => parser.analyzeFile("x.sql", c).definitions!.map((d) => d.name);

  it("treats a backslash as escaping the next character in a string", () => {
    const c = "INSERT INTO t VALUES ('Tonga Pa\\'anga');\nCREATE TABLE after_t (id INT);";
    expect(names(c)).toEqual(["after_t"]);
  });

  it("ignores PostgreSQL COPY data rows up to the backslash-dot line", () => {
    const c = [
      "COPY t (a) FROM stdin;",
      "it's a row",
      "another 'odd one",
      "\\.",
      "CREATE TABLE after_copy (id INT);",
    ].join("\n");
    const r = parser.analyzeFile("c.sql", c);
    expect(r.definitions!.map((d) => [d.name, d.lineRange])).toEqual([["after_copy", [5, 5]]]);
  });

  it("ends a statement without a semicolon before the next CREATE line", () => {
    const c = "drop table a if exists\ndrop sequence s_a\ncreate table a (id int)\ncreate table b (id int)\n";
    const r = parser.analyzeFile("h.sql", c);
    expect(r.definitions!.map((d) => [d.name, d.lineRange])).toEqual([
      ["a", [3, 3]],
      ["b", [4, 4]],
    ]);
  });

  it("extracts procedures inside a DELIMITER block and does not read $$ as a dollar quote", () => {
    const c = [
      "DELIMITER $$",
      "CREATE PROCEDURE p1(IN x INT)",
      "BEGIN",
      "  SELECT 1;",
      "  SELECT 2;",
      "END $$",
      "CREATE TABLE in_block (id INT) $$",
      "DELIMITER ;",
      "CREATE TABLE after_block (id INT);",
    ].join("\n");
    const r = parser.analyzeFile("d.sql", c);
    expect(r.functions.map((f) => [f.name, f.lineRange])).toEqual([["p1", [2, 6]]]);
    expect(r.definitions!.map((d) => d.name)).toEqual(["in_block", "after_block"]);
  });

  it("ends a procedure at the line before a // delimiter that sits on its own line", () => {
    const c = [
      "delimiter //",
      "CREATE PROCEDURE diff_p ()",
      "BEGIN",
      "  SELECT 1;",
      "END;",
      "//",
      "",
      "delimiter ;",
      "call diff_p();",
      "CREATE TABLE after_t (id INT);",
    ].join("\n");
    const r = parser.analyzeFile("d.sql", c);
    expect(r.functions.map((f) => [f.name, f.lineRange])).toEqual([["diff_p", [2, 5]]]);
    expect(r.definitions!.map((d) => d.name)).toEqual(["after_t"]);
  });

  it("treats a line-leading # as a comment but keeps # inside identifiers", () => {
    const c = "#CREATE TABLE ghost (id INT);\n  # CREATE TABLE ghost2 (id INT);\nCREATE TABLE t#1 (id INT);";
    expect(names(c)).toEqual(["t#1"]);
  });
});

describe("GraphQLParser edge cases", () => {
  const parser = new GraphQLParser();

  it("extracts input type definitions", () => {
    const content = "input CreateUserInput {\n  name: String!\n  email: String!\n}";
    const result = parser.analyzeFile("schema.graphql", content);
    expect(result.definitions).toBeDefined();
    const inputDef = result.definitions!.find(d => d.name === "CreateUserInput");
    expect(inputDef).toBeDefined();
    expect(inputDef!.kind).toBe("input");
    expect(inputDef!.fields).toContain("name");
  });
});

describe("MakefileParser edge cases", () => {
  const parser = new MakefileParser();

  it("does not extract .PHONY as a target", () => {
    const content = ".PHONY: build test\n\nbuild:\n\tgo build\n\ntest:\n\tgo test";
    const result = parser.analyzeFile("Makefile", content);
    expect(result.steps).toBeDefined();
    const targetNames = result.steps!.map(s => s.name);
    expect(targetNames).not.toContain(".PHONY");
    expect(targetNames).toContain("build");
    expect(targetNames).toContain("test");
  });
});

describe("ShellParser edge cases", () => {
  const parser = new ShellParser();

  it("handles function with opening brace on next line", () => {
    const content = "greet()\n{\n  echo \"Hello\"\n}";
    const result = parser.analyzeFile("script.sh", content);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0].name).toBe("greet");
    expect(result.functions[0].lineRange[1]).toBeGreaterThan(result.functions[0].lineRange[0]);
  });

  it("rejects function-like patterns that lack an opening brace", () => {
    // Regression: pre-2.6.2 the regex matched `name() echo hi` (POSIX
    // one-liner) and `usage()` strings appearing in heredocs as if they
    // were function definitions.
    const content = [
      "name() echo hi",
      "say_usage() # comment, no brace",
      "real_func() {",
      "  echo real",
      "}",
    ].join("\n");
    const result = parser.analyzeFile("script.sh", content);
    expect(result.functions.map((f) => f.name)).toEqual(["real_func"]);
  });

  it("declares jenkinsfile so Groovy-flavored CI configs are routed here", () => {
    expect(parser.languages).toEqual(expect.arrayContaining(["shell", "jenkinsfile"]));
  });
});

describe("TOMLParser edge cases", () => {
  const parser = new TOMLParser();

  it("returns empty sections for empty string", () => {
    const result = parser.analyzeFile("empty.toml", "");
    expect(result.sections).toBeDefined();
    expect(result.sections).toHaveLength(0);
  });

  it("returns empty sections for garbage text", () => {
    const result = parser.analyzeFile("garbage.toml", "this is not toml at all\nrandom garbage 123");
    expect(result.sections).toBeDefined();
    expect(result.sections).toHaveLength(0);
  });
});

describe("DockerfileParser edge cases", () => {
  const parser = new DockerfileParser();

  it("assigns EXPOSE ports to the correct stage in multi-stage build", () => {
    const content = "FROM node:22 AS builder\nRUN npm install\n\nFROM node:22-slim AS runner\nCOPY --from=builder /app /app\nEXPOSE 3000 8080\nCMD [\"node\", \"server.js\"]";
    const result = parser.analyzeFile("Dockerfile", content);
    expect(result.services).toBeDefined();
    expect(result.services!).toHaveLength(2);
    // Ports should be on the runner stage (second stage), not the builder
    expect(result.services![0].ports).toHaveLength(0); // builder has no EXPOSE
    expect(result.services![1].ports).toContain(3000);
    expect(result.services![1].ports).toContain(8080);
  });

  it("includes lineRange for each stage", () => {
    const content = "FROM node:22 AS builder\nRUN npm install\n\nFROM node:22-slim AS runner\nCOPY . .\nCMD [\"node\", \"start\"]";
    const result = parser.analyzeFile("Dockerfile", content);
    expect(result.services).toBeDefined();
    expect(result.services!).toHaveLength(2);
    expect(result.services![0].lineRange).toBeDefined();
    expect(result.services![0].lineRange![0]).toBe(1);
    expect(result.services![1].lineRange).toBeDefined();
    expect(result.services![1].lineRange![0]).toBe(4);
  });
});

describe("EnvParser edge cases", () => {
  const parser = new EnvParser();

  it("does not handle export VAR=value syntax", () => {
    const content = "export DB_HOST=localhost\nAPI_KEY=secret";
    const result = parser.analyzeFile(".env", content);
    // The `export` prefix is not handled — only plain KEY=value is parsed
    const names = result.definitions!.map(d => d.name);
    expect(names).toContain("API_KEY");
    expect(names).not.toContain("DB_HOST");
  });
});

describe("registerAllParsers", () => {
  it("registers all 15 parsers with a PluginRegistry", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);
    expect(registry.getPlugins()).toHaveLength(15);
    expect(registry.getSupportedLanguages()).toContain("csproj");
    expect(registry.getSupportedLanguages()).toContain("feature");
    expect(registry.getSupportedLanguages()).toContain("xaml");
    expect(registry.getSupportedLanguages()).toContain("markdown");
    expect(registry.getSupportedLanguages()).toContain("yaml");
    expect(registry.getSupportedLanguages()).toContain("json");
    expect(registry.getSupportedLanguages()).toContain("toml");
    expect(registry.getSupportedLanguages()).toContain("env");
    expect(registry.getSupportedLanguages()).toContain("dockerfile");
    expect(registry.getSupportedLanguages()).toContain("sql");
    expect(registry.getSupportedLanguages()).toContain("graphql");
    expect(registry.getSupportedLanguages()).toContain("protobuf");
    expect(registry.getSupportedLanguages()).toContain("terraform");
    expect(registry.getSupportedLanguages()).toContain("makefile");
    expect(registry.getSupportedLanguages()).toContain("shell");
  });
});
