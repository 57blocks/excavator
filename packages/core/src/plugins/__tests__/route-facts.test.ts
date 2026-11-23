import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TreeSitterPlugin } from "../tree-sitter-plugin.js";
import { builtinLanguageConfigs } from "../../languages/configs/index.js";
import { FrameworkRegistry } from "../../languages/framework-registry.js";
import { ginConfig } from "../../languages/frameworks/gin.js";
import { expressConfig } from "../../languages/frameworks/express.js";
import { reactConfig } from "../../languages/frameworks/react.js";
import type { RouteFacts, RouteSite } from "../../types.js";

let plugin: TreeSitterPlugin;
beforeAll(async () => {
  plugin = new TreeSitterPlugin(builtinLanguageConfigs);
  await plugin.init();
});

function routes(file: string, code: string): RouteFacts | undefined {
  return plugin.analyzeFile(file, code).routes;
}
function sites(file: string, code: string): RouteSite[] {
  return routes(file, code)?.sites ?? [];
}
const brief = (s: RouteSite) => ({
  method: s.method,
  path: "literal" in s.path ? s.path.literal : `?${s.path.unresolved}:${s.path.text}`,
  anchor: s.anchor.kind === "local" ? `local:${s.anchor.name}` : s.anchor.kind === "parameter" ? `param:${s.anchor.name}:${s.anchor.type}` : "root",
});

describe("schema", () => {
  it("rejects an unknown key inside routes", () => {
    const reg = new FrameworkRegistry();
    expect(() => reg.register({ ...ginConfig, routes: { ...ginConfig.routes, bogus: 1 } } as never)).toThrow();
    expect(() => reg.register({ ...expressConfig, id: "e2", routes: { ...expressConfig.routes, calls: { verbs: {}, pathArgument: 0, extra: true } } } as never)).toThrow();
  });
  it("rejects a missing importSources", () => {
    const reg = new FrameworkRegistry();
    const { importSources: _drop, ...rest } = ginConfig.routes;
    expect(() => reg.register({ ...ginConfig, routes: rest } as never)).toThrow();
  });
  it("accepts the three builtin rule sets", () => {
    const reg = new FrameworkRegistry();
    for (const c of [ginConfig, expressConfig, reactConfig]) expect(() => reg.register(c)).not.toThrow();
  });
});

describe("gin", () => {
  const code = `package svc
import (
	"github.com/gin-gonic/gin"
	"example.com/app/pkg"
)
func Setup() {
	r := gin.Default()
	r.GET("/a", h)
	v := r.Group("/v1")
	w := v.Group("/w")
	w.POST("", pkg.F)
	r.Any("/x", func(c *gin.Context) {})
	r.GET("/c", r.CatchError(pkg.F))
	r.GET(base+"/y", h)
	axios.GET("/z", h)
	r.GET("/only")
}
func Reg(g *gin.RouterGroup, e *gin.Engine) {
	g.GET("/p", h)
	e.DELETE("/q", pkg.Q)
}
`;
  it("extracts sites, groups, wrapping and anchors", () => {
    const f = routes("svc.go", code)!;
    expect(f.sites.map(brief)).toEqual([
      { method: "GET", path: "/a", anchor: "root" },
      { method: "POST", path: "/v1/w", anchor: "root" },
      { method: "ANY", path: "/x", anchor: "root" },
      { method: "GET", path: "/c", anchor: "root" },
      { method: "GET", path: "?own:base+\"/y\"", anchor: "root" },
      { method: "GET", path: "/p", anchor: "param:g:*gin.RouterGroup" },
      { method: "DELETE", path: "/q", anchor: "root" },
    ]);
    expect(f.sites.every((s) => s.framework === "gin" && s.form === "call")).toBe(true);
    expect(f.sites[1].handler).toMatchObject({ kind: "name", text: "pkg.F" });
    expect(f.sites[2].handler).toMatchObject({ kind: "inline" });
    expect(f.sites[3].handler).toMatchObject({ kind: "name", text: "pkg.F", wrappedBy: "r.CatchError" });
    expect(f.mounts).toEqual([]);
    expect(f.rules).toEqual({ gin: { kind: "http", join: "append" } });
  });
  it("tracks an unresolved group prefix", () => {
    const s = sites("g.go", `package s
import "github.com/gin-gonic/gin"
func F() { r := gin.New(); g := r.Group(prefix); g.GET("/a", h) }
`);
    expect(s.map(brief)).toEqual([{ method: "GET", path: "?prefix:prefix", anchor: "root" }]);
  });
  it("ignores a file that does not import the framework", () => {
    expect(routes("o.go", `package s
func F(r *gin.Engine) { r.GET("/a", h) }
`)).toBeUndefined();
  });
});

describe("express", () => {
  it("extracts app and router sites, mounts and exports", () => {
    const code = `import express from 'express';
const usersRouter = require('./users');
const mk = require('./mk')(passport);
const app = express();
const router = express.Router();
app.get('/a', h);
app.get('env');
router.post('/', wrapAsync(async (req, res) => {}));
app.use('/users', usersRouter);
app.use('/mk', mk);
app.use(router);
app.use(cors());
app.use(function f() {});
app.use('/p', express.static('p'));
axios.get('/x', cb);
router.get(\`/t/\${id}\`, h);
module.exports = router;
`;
    const f = routes("app.js", code)!;
    expect(f.sites.map(brief)).toEqual([
      { method: "GET", path: "/a", anchor: "root" },
      { method: "POST", path: "/", anchor: "local:router" },
      { method: "GET", path: "?own:`/t/${id}`", anchor: "local:router" },
    ]);
    expect(f.sites[1].handler).toEqual({ kind: "inline", line: 8, endLine: 8, wrappedBy: "wrapAsync" });
    expect(f.mounts).toEqual([
      { framework: "express", line: 9, path: { literal: "/users" }, anchor: { kind: "root" }, target: { kind: "require", source: "./users", called: false } },
      { framework: "express", line: 10, path: { literal: "/mk" }, anchor: { kind: "root" }, target: { kind: "require", source: "./mk", called: true } },
      { framework: "express", line: 11, path: { literal: "" }, anchor: { kind: "root" }, target: { kind: "local", name: "router" } },
    ]);
    expect(f.ignoredMounts).toEqual([
      { framework: "express", line: 12, text: "cors()" },
      { framework: "express", line: 13, text: "function f() {}" },
      { framework: "express", line: 14, text: "express.static('p')" },
    ]);
    expect(f.exportsValue).toEqual({ local: "router", factory: false, line: 17 });
  });
  it("classifies an inline require mount target, called or not, and ignores other calls", () => {
    const f = routes("a.js", `const express = require('express');
const app = express();
app.use('/api', require('./api'));
app.use('/w', require('./w')(passport, 1));
app.use('/z', other('./z'));
app.use();
`)!;
    expect(f.mounts.map((m) => [m.line, m.path, m.target])).toEqual([
      [3, { literal: "/api" }, { kind: "require", source: "./api", called: false }],
      [4, { literal: "/w" }, { kind: "require", source: "./w", called: true }],
    ]);
    expect(f.ignoredMounts).toEqual([
      { framework: "express", line: 5, text: "other('./z')" },
      { framework: "express", line: 6, text: "" },
    ]);
  });
  it("keeps a rules entry for a framework that has only ignored mounts", () => {
    const f = routes("b.js", `const express = require('express');
const app = express();
app.use(cors());
`)!;
    expect(f.sites).toEqual([]);
    expect(f.mounts).toEqual([]);
    expect(f.rules).toEqual({ express: { kind: "http", join: "append" } });
  });
  it("records a factory export and an ES-import mount target", () => {
    const f = routes("r.js", `const express = require('express');
import other from './other';
const router = express.Router();
router.use('/o', other);
module.exports = passport => {
  router.get('/g', h);
  return router;
};
`)!;
    expect(f.exportsValue).toEqual({ local: "router", factory: true, line: 5 });
    expect(f.mounts[0].target).toEqual({ kind: "binding", name: "other" });
    expect(f.mounts[0].anchor).toEqual({ kind: "local", name: "router" });
    expect(f.sites.map(brief)).toEqual([{ method: "GET", path: "/g", anchor: "local:router" }]);
  });
  it("nests a group-like router path through a prefixed mount parent", () => {
    // an own path joins the receiver prefix of a TS file too
    const s = sites("x.ts", `import express from 'express';
const app = express();
app.post('/orders/', h);
`);
    expect(s.map(brief)).toEqual([{ method: "POST", path: "/orders", anchor: "root" }]);
  });
  it("gives no routes to a file that matches no rule", () => {
    const out = plugin.analyzeFile("plain.ts", "export const a = 1;\n");
    expect("routes" in out).toBe(false);
  });
  it("gives no routes to an express file with only settings reads and no exports", () => {
    expect(routes("s.js", `const express = require('express');
const app = express();
app.get('env');
`)).toBeUndefined();
  });
});

describe("react-router", () => {
  it("reads JSX routes, nesting and anchors", () => {
    const code = `import { BrowserRouter, Routes, Route } from 'react-router-dom';
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/a" element={<A/>}>
          <Route path="b" Component={B}/>
          <Route index element={<C/>}/>
          {cond && <Route path={'c'} element={<D/>}/>}
          <Route path={dyn} element={<E/>}/>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
export function Profile() {
  return <Routes><Route path="profile" Component={P}/></Routes>;
}
`;
    const f = routes("App.tsx", code)!;
    expect(f.sites.map(brief)).toEqual([
      { method: null, path: "/a", anchor: "root" },
      { method: null, path: "/a/b", anchor: "root" },
      { method: null, path: "/a", anchor: "root" },
      { method: null, path: "/a/c", anchor: "root" },
      { method: null, path: "?own:{dyn}", anchor: "root" },
      { method: null, path: "/profile", anchor: "local:Profile" },
    ]);
    expect(f.sites[0].handler).toMatchObject({ kind: "name", text: "A" });
    expect(f.sites[1].handler).toMatchObject({ kind: "name", text: "B" });
    expect(f.sites[0].form).toBe("element");
    expect(f.rules).toEqual({ react: { kind: "ui", join: "nested" } });
  });
  it("reads route objects, lazy modules and mounts", () => {
    const code = `import { createBrowserRouter, RouteObject } from 'react-router-dom';
import { imported, importedRoutes } from './x';
export const routes: Array<RouteObject> = [
  { path: '/', element: <Layout/>, children: [
    { path: 'x', lazy: wrap(() => import('./X')) },
    { index: true, Component: Home },
    ...more,
    imported,
  ] },
  { path: '/y', children: importedRoutes },
  ...publicRoutes,
];
const other: RouteObject[] = [{ path: 'z', element: <Z/> }];
export const router = createBrowserRouter(routes);
const r2 = createBrowserRouter([{ path: '/q', lazy: () => import('./Q') }, ...rest]);
`;
    const f = routes("routes.tsx", code)!;
    expect(f.sites.map(brief)).toEqual([
      { method: null, path: "/", anchor: "local:routes" },
      { method: null, path: "/x", anchor: "local:routes" },
      { method: null, path: "/", anchor: "local:routes" },
      { method: null, path: "/y", anchor: "local:routes" },
      { method: null, path: "/z", anchor: "local:other" },
      { method: null, path: "/q", anchor: "root" },
    ]);
    expect(f.sites[0].handler).toMatchObject({ kind: "name", text: "Layout" });
    expect(f.sites[1].handler).toMatchObject({ kind: "module", source: "./X" });
    expect(f.sites[2].handler).toMatchObject({ kind: "name", text: "Home" });
    expect(f.sites[5].handler).toMatchObject({ kind: "module", source: "./Q" });
    const m = f.mounts.map((x) => ({
      target: x.target,
      path: "literal" in x.path ? x.path.literal : "?",
      anchor: x.anchor.kind === "local" ? `local:${x.anchor.name}` : x.anchor.kind,
    }));
    expect(m).toEqual([
      { target: { kind: "other", text: "more" }, path: "/", anchor: "local:routes" },
      { target: { kind: "binding", name: "imported" }, path: "/", anchor: "local:routes" },
      { target: { kind: "binding", name: "importedRoutes" }, path: "/y", anchor: "local:routes" },
      { target: { kind: "other", text: "publicRoutes" }, path: "", anchor: "local:routes" },
      { target: { kind: "local", name: "routes" }, path: "", anchor: "root" },
      { target: { kind: "other", text: "rest" }, path: "", anchor: "root" },
    ]);
  });
  it("gives no routes for react-router files without route shapes", () => {
    expect(routes("U.tsx", `import { useNavigate } from 'react-router-dom';
export const f = () => { const n = useNavigate(); n('/a'); };
`)).toBeUndefined();
  });
  it("ignores same-shaped objects in a file that does not import react-router", () => {
    expect(routes("N.tsx", `export const routes: Array<RouteObject> = [{ path: '/a', element: <A/> }];
`)).toBeUndefined();
  });
});

describe("plugin paths", () => {
  it("analyzeFile and analyzeFileFull give equal routes", () => {
    const cases: Array<[string, string]> = [
      ["a.js", "const express = require('express');\nconst app = express();\napp.get('/a', h);\n"],
      ["b.go", "package s\nimport \"github.com/gin-gonic/gin\"\nfunc F(){ r := gin.New(); r.GET(\"/a\", h) }\n"],
      ["c.tsx", "import { Route } from 'react-router';\nexport const A = () => <Route path=\"/a\" element={<X/>}/>;\n"],
    ];
    for (const [file, code] of cases) {
      const a = plugin.analyzeFile(file, code).routes;
      const b = plugin.analyzeFileFull(file, code).structure.routes;
      expect(a).toBeDefined();
      expect(b).toEqual(a);
    }
  });
});

describe("route-facts.ts is framework-neutral", () => {
  it("names no framework id or factory", () => {
    const src = readFileSync(fileURLToPath(new URL("../route-facts.ts", import.meta.url)), "utf8");
    for (const word of ["gin", "express", "react", "Router", "Default", "createBrowserRouter", "Engine", "RouteObject"]) {
      expect(src.includes(`"${word}`), word).toBe(false);
      expect(src.includes(`'${word}`), word).toBe(false);
    }
  });
});
