import { describe, it, expect } from "vitest";
import { XamlParser } from "../xaml-parser.js";
import { PluginRegistry } from "../../registry.js";
import { registerAllParsers } from "../index.js";
import type { StructuralAnalysis } from "../../../types.js";

const parser = new XamlParser();

// Line map (1-based):
// 1  <?xml ...?>
// 2  <ContentPage ...                (root element)
// 3    xmlns:x=...
// 4    xmlns:vm=...
// 5    x:Class="UNMC.Views.ParticipantsPage"
// 6    x:DataType="vm:ParticipantsViewModel">
// 7    <StackLayout>
// 8      <Label x:Name="TitleLabel" Text="{Binding Title}" />
// 9      <Button x:Name="PairButton"
// 10           Text="Pair App"
// 11           Command="{Binding PairAppCommand}" />
// 12     <Entry Text="{Binding Path=SearchText, Mode=TwoWay}" />
// 13   </StackLayout>
// 14 </ContentPage>
const SAMPLE = `<?xml version="1.0" encoding="utf-8" ?>
<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             xmlns:vm="clr-namespace:UNMC.ViewModels"
             x:Class="UNMC.Views.ParticipantsPage"
             x:DataType="vm:ParticipantsViewModel">
  <StackLayout>
    <Label x:Name="TitleLabel" Text="{Binding Title}" />
    <Button x:Name="PairButton"
            Text="Pair App"
            Command="{Binding PairAppCommand}" />
    <Entry Text="{Binding Path=SearchText, Mode=TwoWay}" />
  </StackLayout>
</ContentPage>
`;

const SAMPLE_NO_DT = `<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             x:Class="UNMC.Views.HomePage">
  <Label Text="{Binding Greeting}" />
</ContentPage>
`;

const defsOf = (a: StructuralAnalysis, kind: string) =>
  (a.definitions ?? []).filter((d) => d.kind === kind);

describe("XamlParser", () => {
  it("captures the view as a section named from x:Class", () => {
    const s = parser.analyzeFile("ParticipantsPage.xaml", SAMPLE).sections ?? [];
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ name: "ParticipantsPage", level: 1, lineRange: [2, 2] });
  });

  it("captures x:Class as an anchored code-behind definition", () => {
    const cb = defsOf(parser.analyzeFile("x.xaml", SAMPLE), "code-behind");
    expect(cb).toHaveLength(1);
    expect(cb[0]).toMatchObject({ name: "UNMC.Views.ParticipantsPage", lineRange: [5, 5] });
  });

  it("captures x:DataType and x:Name definitions with anchors", () => {
    const a = parser.analyzeFile("x.xaml", SAMPLE);
    expect(defsOf(a, "datatype")[0]).toMatchObject({
      name: "vm:ParticipantsViewModel",
      lineRange: [6, 6],
    });
    const names = defsOf(a, "element").map((d) => d.name);
    expect(names).toEqual(["TitleLabel", "PairButton"]);
  });

  it("captures bindings and commands with the file DataType context, never a member edge", () => {
    const a = parser.analyzeFile("x.xaml", SAMPLE);
    const bindings = defsOf(a, "binding");
    const title = bindings.find((d) => d.name === "Title")!;
    expect(title.lineRange).toEqual([8, 8]);
    expect(title.fields).toContain("context=vm:ParticipantsViewModel");
    const search = bindings.find((d) => d.name === "SearchText")!;
    expect(search.lineRange).toEqual([12, 12]);
    const command = defsOf(a, "command").find((d) => d.name === "PairAppCommand")!;
    expect(command).toBeDefined();
    expect(command.lineRange).toEqual([11, 11]);
    expect(command.fields).toContain("context=vm:ParticipantsViewModel");
    // honest boundary: no member-resolution field is ever emitted
    for (const d of [...bindings, command]) {
      expect(d.fields.some((f) => f.startsWith("member="))).toBe(false);
    }
  });

  it("marks context=none when the file has no x:DataType (never guesses a target)", () => {
    const a = parser.analyzeFile("HomePage.xaml", SAMPLE_NO_DT);
    const greeting = defsOf(a, "binding").find((d) => d.name === "Greeting")!;
    expect(greeting).toBeDefined();
    expect(greeting.fields).toContain("context=none");
    expect(a.sections?.[0]).toMatchObject({ name: "HomePage", lineRange: [1, 1] });
  });

  it("returns empty for content with no elements", () => {
    const a = parser.analyzeFile("empty.xaml", "");
    expect(a.sections ?? []).toHaveLength(0);
    expect(a.definitions ?? []).toHaveLength(0);
  });

  it("is deterministic across runs", () => {
    const a = JSON.stringify(parser.analyzeFile("x.xaml", SAMPLE));
    const b = JSON.stringify(parser.analyzeFile("x.xaml", SAMPLE));
    expect(a).toBe(b);
  });

  it("is registered so .xaml resolves to the xaml parser (not xml)", () => {
    const registry = new PluginRegistry();
    registerAllParsers(registry);
    expect(registry.getLanguageForFile("Views/Foo.xaml")).toBe("xaml");
    expect(registry.getPluginForFile("Views/Foo.xaml")?.name).toBe("xaml-parser");
  });
});
