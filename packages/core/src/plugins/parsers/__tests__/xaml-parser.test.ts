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

const COMMENTED_MARKUP = [
  '<!-- <ContentPage x:Class="Demo.GhostPage" x:DataType="vm:Ghost" /> -->',
  '<ContentPage x:Class="Demo.LivePage" x:DataType="vm:Page">',
  '  <!-- <Button x:Name="GhostButton" Command="{Binding GhostCommand}" /> -->',
  '  <Label x:Name="LiveLabel" Text="{Binding LiveTitle}" /> <!-- <Label Text="{Binding InlineGhost}" /> -->',
  '  <!--',
  '  <DataTemplate x:DataType="vm:GhostRow">',
  '    <Label Text="{Binding GhostRowTitle}" />',
  '  </DataTemplate>',
  '  -->',
  '  <Button Command="{Binding LiveCommand}" />',
  '</ContentPage>',
].join("\n");

const SCOPED_MARKUP = [
  '<ContentPage x:Class="Demo.ScopedPage" x:DataType="vm:Page">',
  '  <Label Text="{Binding OuterTitle}" />',
  '  <DataTemplate x:DataType="vm:Row">',
  '    <Label Text="{Binding RowTitle}" />',
  '  </DataTemplate>',
  '  <Label Text="{Binding AfterTitle}" />',
  '</ContentPage>',
].join("\n");

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

  it("sees live facts but never turns inline or multiline comments into facts", () => {
    const a = parser.analyzeFile("LivePage.xaml", COMMENTED_MARKUP);
    expect(a.sections).toEqual([{ name: "LivePage", level: 1, lineRange: [2, 2] }]);
    expect(defsOf(a, "code-behind")).toEqual([
      { name: "Demo.LivePage", kind: "code-behind", lineRange: [2, 2], fields: [] },
    ]);
    expect(defsOf(a, "datatype").map((d) => d.name)).toEqual(["vm:Page"]);
    expect(defsOf(a, "element").map((d) => d.name)).toEqual(["LiveLabel"]);
    expect(defsOf(a, "binding")).toEqual([
      { name: "LiveTitle", kind: "binding", lineRange: [4, 4], fields: ["context=vm:Page"] },
    ]);
    expect(defsOf(a, "command")).toEqual([
      { name: "LiveCommand", kind: "command", lineRange: [10, 10], fields: ["context=vm:Page"] },
    ]);
  });

  it("ignores declarations, processing instructions, and CDATA as non-element content", () => {
    const markup = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE ContentPage>',
      '<![CDATA[<ContentPage x:Class="Demo.Ghost" Text="{Binding Ghost}" />]]>',
      '<ContentPage x:Class="Demo.Live">',
      '  <Label Text="{Binding Live}" />',
      '</ContentPage>',
    ].join("\n");
    const a = parser.analyzeFile("Live.xaml", markup);
    expect(a.sections).toEqual([{ name: "Live", level: 1, lineRange: [4, 4] }]);
    expect(defsOf(a, "code-behind").map((d) => d.name)).toEqual(["Demo.Live"]);
    expect(defsOf(a, "binding").map((d) => [d.name, d.lineRange])).toEqual([["Live", [5, 5]]]);
  });

  it("inherits the nearest x:DataType and restores the page type after a template", () => {
    const bindings = defsOf(parser.analyzeFile("ScopedPage.xaml", SCOPED_MARKUP), "binding");
    expect(bindings.map((d) => [d.name, d.fields, d.lineRange])).toEqual([
      ["OuterTitle", ["context=vm:Page"], [2, 2]],
      ["RowTitle", ["context=vm:Row"], [4, 4]],
      ["AfterTitle", ["context=vm:Page"], [6, 6]],
    ]);
  });

  it("does not apply a template-only type to bindings outside that template", () => {
    const markup = [
      '<ContentPage x:Class="Demo.UntypedPage">',
      '  <Label Text="{Binding OuterTitle}" />',
      '  <DataTemplate x:DataType="vm:Row">',
      '    <Label Text="{Binding RowTitle}" />',
      '  </DataTemplate>',
      '</ContentPage>',
    ].join("\n");
    const bindings = defsOf(parser.analyzeFile("UntypedPage.xaml", markup), "binding");
    expect(bindings.map((d) => [d.name, d.fields])).toEqual([
      ["OuterTitle", ["context=none"]],
      ["RowTitle", ["context=vm:Row"]],
    ]);
  });

  it("marks Source and RelativeSource bindings unresolved without losing paths or anchors", () => {
    const markup = [
      '<ContentPage x:Name="Root">',
      '  <DataTemplate x:DataType="vm:Row">',
      '    <Button Command="{Binding Path=BindingContext.OpenCommand, Source={x:Reference Root}}" />',
      '    <Label Text="{Binding Path=Title, RelativeSource={RelativeSource AncestorType=ContentPage}}" />',
      '  </DataTemplate>',
      '</ContentPage>',
    ].join("\n");
    const a = parser.analyzeFile("ExplicitSource.xaml", markup);
    expect(defsOf(a, "command")).toEqual([
      { name: "BindingContext.OpenCommand", kind: "command", lineRange: [3, 3], fields: ["context=none"] },
    ]);
    expect(defsOf(a, "binding")).toEqual([
      { name: "Title", kind: "binding", lineRange: [4, 4], fields: ["context=none"] },
    ]);
    expect(a.definitions?.some((d) => d.fields.some((f) => f.startsWith("member=")))).toBe(false);
  });

  it("handles attribute order, multiline tags, quoted >, and explicit null context", () => {
    const markup = [
      '<ContentPage x:DataType="vm:Page">',
      '  <Label Text="{Binding SameTag}" x:DataType="vm:Label" />',
      '  <Label Text="{Binding Quoted}" ToolTip="a > b" />',
      '  <Label',
      '    Text="{Binding Multiline}"',
      '    x:DataType="{x:Null}" />',
      '</ContentPage>',
    ].join("\n");
    const a = parser.analyzeFile("AttributeOrder.xaml", markup);
    expect(defsOf(a, "binding").map((d) => [d.name, d.fields, d.lineRange])).toEqual([
      ["SameTag", ["context=vm:Label"], [2, 2]],
      ["Quoted", ["context=vm:Page"], [3, 3]],
      ["Multiline", ["context=none"], [5, 5]],
    ]);
    expect(JSON.stringify(parser.analyzeFile("AttributeOrder.xaml", markup))).toBe(JSON.stringify(a));
  });
});
