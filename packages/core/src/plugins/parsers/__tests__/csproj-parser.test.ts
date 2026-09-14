import { describe, it, expect } from "vitest";
import { CsprojParser } from "../csproj-parser.js";
import { PluginRegistry } from "../../registry.js";
import { registerAllParsers } from "../index.js";
import type { StructuralAnalysis } from "../../../types.js";

const parser = new CsprojParser();

// Line map (1-based):
// 1 <Project ...>
// 2   <PropertyGroup>
// 3     <TargetFrameworks>...
// 4     <UseMaui>true</UseMaui>
// 5   </PropertyGroup>
// 6   <ItemGroup>
// 7     <PackageReference Include="CommunityToolkit.Maui" Version="7.0.0" />
// 8     <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
// 9     <PackageReference Include="Serilog">
// 10      <Version>3.1.1</Version>
// 11    </PackageReference>
// 12    <PackageReference Include="SomePkg.NoVersion" />
// 13  </ItemGroup>
// 14 </Project>
const SAMPLE = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net8.0-android;net8.0-ios;net8.0</TargetFrameworks>
    <UseMaui>true</UseMaui>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="CommunityToolkit.Maui" Version="7.0.0" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog">
      <Version>3.1.1</Version>
    </PackageReference>
    <PackageReference Include="SomePkg.NoVersion" />
  </ItemGroup>
</Project>
`;

const deps = (a: StructuralAnalysis) =>
  (a.definitions ?? []).filter((d) => d.kind === "dependency");

describe("CsprojParser", () => {
  it("extracts each PackageReference as an anchored dependency", () => {
    const d = deps(parser.analyzeFile("UNMC.csproj", SAMPLE));
    const names = d.map((x) => x.name);
    expect(names).toContain("CommunityToolkit.Maui");
    expect(names).toContain("Newtonsoft.Json");
    const ctk = d.find((x) => x.name === "CommunityToolkit.Maui")!;
    expect(ctk.fields).toContain("version=7.0.0");
    expect(ctk.lineRange).toEqual([7, 7]);
  });

  it("captures a Version given as a child element", () => {
    const serilog = deps(parser.analyzeFile("x.csproj", SAMPLE)).find(
      (x) => x.name === "Serilog",
    );
    expect(serilog).toBeDefined();
    expect(serilog!.fields).toContain("version=3.1.1");
    expect(serilog!.lineRange).toEqual([9, 9]);
  });

  it("emits a dependency with no version when Version is absent (never guesses)", () => {
    const nov = deps(parser.analyzeFile("x.csproj", SAMPLE)).find(
      (x) => x.name === "SomePkg.NoVersion",
    );
    expect(nov).toBeDefined();
    expect(nov!.fields.some((f) => f.startsWith("version="))).toBe(false);
  });

  it("extracts TargetFrameworks and UseMaui with anchors", () => {
    const a = parser.analyzeFile("x.csproj", SAMPLE);
    const target = (a.definitions ?? []).find((d) => d.kind === "target");
    expect(target?.name).toBe("net8.0-android;net8.0-ios;net8.0");
    expect(target?.lineRange).toEqual([3, 3]);
    const useMaui = (a.definitions ?? []).find(
      (d) => d.kind === "property" && d.name === "UseMaui",
    );
    expect(useMaui).toBeDefined();
    expect(useMaui!.lineRange).toEqual([4, 4]);
  });

  it("does not misfire on a csproj with no PackageReference", () => {
    const a = parser.analyzeFile(
      "empty.csproj",
      `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup></PropertyGroup>\n</Project>\n`,
    );
    expect(deps(a).length).toBe(0);
  });

  it("is deterministic across runs", () => {
    const a = JSON.stringify(parser.analyzeFile("x.csproj", SAMPLE));
    const b = JSON.stringify(parser.analyzeFile("x.csproj", SAMPLE));
    expect(a).toBe(b);
  });

  it("is registered so .csproj resolves to the csproj parser", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);
    expect(registry.getLanguageForFile("UNMC.csproj")).toBe("csproj");
    const plugin = registry.getPluginForFile("UNMC.csproj");
    expect(plugin?.name).toBe("csproj-parser");
  });
});
