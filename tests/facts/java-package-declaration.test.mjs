// name-mention-facts, task 2.7(a): the package a Java file declares, read from
// the head of the file.
import { describe, expect, it } from 'vitest';
import { readJavaPackage } from '../../skills/excavator/java-package-declaration.mjs';

describe('readJavaPackage', () => {
  it('reads the declared package', () => {
    expect(readJavaPackage('package com.acme.web;\n\npublic class A {}\n')).toBe('com.acme.web');
    expect(readJavaPackage('package   a ;')).toBe('a');
  });

  it('skips a licence header and comments before the declaration', () => {
    const text = '/*\n * Licensed. package fake.one;\n */\n// package fake.two;\n\n/** doc */\npackage com.acme;\nclass A {}';
    expect(readJavaPackage(text)).toBe('com.acme');
    expect(readJavaPackage('﻿// bom\npackage com.acme;')).toBe('com.acme');
  });

  it('reads a name wrapped across lines as one name', () => {
    expect(readJavaPackage('package com\n    .acme\n    .web;\nclass A {}')).toBe('com.acme.web');
  });

  it('says none for the default package', () => {
    expect(readJavaPackage('public class A {}\n')).toBeNull();
    expect(readJavaPackage('')).toBeNull();
    expect(readJavaPackage('/* only a comment */')).toBeNull();
    expect(readJavaPackage('import java.util.List;\npackage com.acme;')).toBeNull(); // not the first statement: not a declaration
  });

  it('never takes a package word in code or a string for the declaration', () => {
    expect(readJavaPackage('class A { String s = "package com.acme;"; }')).toBeNull();
    expect(readJavaPackage('class A {}\n// package com.acme;\n')).toBeNull();
  });

  it('refuses what is not a qualified name, and an unterminated comment', () => {
    expect(readJavaPackage('package 1com.acme;')).toBeNull();
    expect(readJavaPackage('package com..acme;')).toBeNull();
    expect(readJavaPackage('package com.acme')).toBeNull();
    expect(readJavaPackage('/* never closed\npackage com.acme;')).toBeNull();
  });

  it('costs the header, not the file', () => {
    const body = 'x'.repeat(20_000_000);
    const started = Date.now();
    expect(readJavaPackage(`package com.acme;\n${body}`)).toBe('com.acme');
    expect(readJavaPackage(`/* header */\n${body}`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
  });
});
