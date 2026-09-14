import { describe, it, expect } from "vitest";

import { PluginRegistry, registerAllParsers } from "../../../packages/core/dist/index.js";
import {
  analyzeFileWithOutcomes,
  deriveStatus,
} from "../../../skills/excavator/extract-structure-result.mjs";

// End-to-end: the three MAUI readers added by this change must dispatch through
// the *real* PluginRegistry (extension -> language -> plugin) and land as
// `parsed`, not `no-extractor`, when run through the same entry point the
// structure-all pipeline uses.
function realRegistry() {
  const registry = new PluginRegistry();
  registerAllParsers(registry);
  return registry;
}

const FIXTURES = [
  {
    label: "csproj",
    path: "src/App/App.csproj",
    fileCategory: "config",
    content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net8.0-android;net8.0-ios</TargetFrameworks>
    <UseMaui>true</UseMaui>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="CommunityToolkit.Maui" Version="7.0.0" />
  </ItemGroup>
</Project>
`,
    check: (a) => {
      const deps = (a.definitions ?? []).filter((d) => d.kind === "dependency");
      expect(deps.map((d) => d.name)).toContain("CommunityToolkit.Maui");
    },
  },
  {
    label: "feature",
    path: "src/App/Features/Pair.feature",
    fileCategory: "code",
    content: `Feature: Pairing
  Scenario: Pair the app
    Given a participant exists
    When the user taps "Pair App"
    Then a QR code is shown
`,
    check: (a) => {
      expect((a.sections ?? []).map((s) => s.name)).toContain("Pairing");
      expect((a.steps ?? []).length).toBeGreaterThanOrEqual(3);
    },
  },
  {
    label: "xaml",
    path: "src/App/Views/ParticipantsPage.xaml",
    fileCategory: "markup",
    content: `<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             x:Class="App.Views.ParticipantsPage"
             x:DataType="vm:ParticipantsViewModel">
  <Label Text="{Binding Title}" />
</ContentPage>
`,
    check: (a) => {
      const defs = a.definitions ?? [];
      expect(defs.some((d) => d.kind === "code-behind" && d.name === "App.Views.ParticipantsPage")).toBe(true);
      expect(defs.some((d) => d.kind === "binding" && d.name === "Title")).toBe(true);
    },
  },
];

describe("MAUI readers e2e (real registry dispatch)", () => {
  for (const fx of FIXTURES) {
    it(`parses .${fx.label} through the real pipeline (was no-extractor)`, () => {
      const registry = realRegistry();
      const res = analyzeFileWithOutcomes(
        registry,
        { path: fx.path, fileCategory: fx.fileCategory },
        fx.content,
      );
      expect(res.structureOutcome).toBe("succeeded");
      expect(res.analysis).not.toBeNull();
      expect(deriveStatus(res.analysis, res.structureOutcome).status).toBe("parsed");
      fx.check(res.analysis);
    });
  }

  it("a genuinely unknown extension still reports skipped/no-extractor (no false parse)", () => {
    const registry = realRegistry();
    const res = analyzeFileWithOutcomes(
      registry,
      { path: "src/App/notes.unknownext", fileCategory: "code" },
      "just some text\n",
    );
    expect(res.structureOutcome).toBe("skipped");
    expect(deriveStatus(res.analysis, res.structureOutcome).status).toBe("no-extractor");
  });
});
